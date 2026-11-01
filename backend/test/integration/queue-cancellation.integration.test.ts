import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createApp } from '../../src/app.js';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { PrismaAccountsRepository } from '../../src/accounts/prisma-accounts.repository.js';
import { QueueRepository } from '../../src/circulation/queue-repository.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';
import { CirculationRepository } from '../../src/circulation/circulation-repository.js';
import { circulationTransaction } from '../../src/circulation/circulation-transaction.js';
import { reconcileBooks } from '../../src/circulation/reconcile-books.js';
import { openQueuePostgresFixture, withConcurrentTransactions } from './queue-postgres-fixture.js';
import type { QueuePostgresFixture } from './queue-postgres-fixture.js';

type Database = Pick<PrismaClient, '$transaction'>;
type FaultTable = 'reservations' | 'notification_outbox';
type FaultMode = 'rollback' | 'once' | 'always';

// Importar registra pruebas; no construye clientes ni abre conexiones.
// El before exige las barreras de la fixture: SCRUM23_ALLOW_INTEGRATION_WRITES=1
// y TEST_DATABASE_URL exclusivamente local. Sin dotenv ni configuración productiva.
describe('SCRUM-24: cancelación y reasignación en PostgreSQL 17 exclusivo', { concurrency: false, timeout: 600_000 }, () => {
  let fixture: QueuePostgresFixture;
  let data: Awaited<ReturnType<QueuePostgresFixture['seed']>>;
  let faultTable: FaultTable | undefined;

  before(async () => { fixture = await openQueuePostgresFixture(); });
  beforeEach(async () => {
    await removeFault();
    await fixture.reset();
    data = await fixture.seed();
  });
  after(async () => {
    if (!fixture) return;
    try { await removeFault(); } finally { await fixture.close(); }
  });

  async function http(t: TestContext, database: Database = fixture.database) {
    const unexpected = async (): Promise<never> => { throw new Error('Servicio externo no permitido en integración'); };
    const server = createApp({ checkDatabase: unexpected, checkStorage: unexpected,
      accounts: new AccountsService(new PrismaAccountsRepository(fixture.database)),
      queue: new QueueRepository(database), loans: new LoanRepository(database),
    }).listen(0, '127.0.0.1');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    async function post(student: number, path: string, body: object) {
      // Tres intentos pueden consumir hasta 3 * (maxWait 10s + timeout 30s).
      // Deadline de fallo, no una pausa usada para provocar concurrencia.
      const response = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body),
        headers: { Cookie: data.students[student]!.cookie, 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' },
        signal: AbortSignal.timeout(150_000),
      });
      const text = await response.text();
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      if (response.status === 204) assert.equal(text, ''); // No identidad del sucesor ni otro DTO.
      return { status: response.status, text };
    }
    return {
      cancel: (student: number, entryId: string) => post(student, `/api/queue-entries/${entryId}/cancel`, {}),
      loan: (student: number, bookId: string) => post(student, '/api/loans', { bookId }),
    };
  }

  function errorCode(response: { text: string }): string {
    const body: unknown = JSON.parse(response.text);
    assert.ok(body && typeof body === 'object' && 'error' in body);
    const error = body.error;
    assert.ok(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string');
    assert.equal(response.text.includes('SCRUM24_TEST_FAULT'), false);
    return error.code;
  }

  async function offered() {
    const bookId = await fixture.createBook(0);
    const entries = [];
    for (const student of data.students.slice(0, 3)) {
      entries.push(await fixture.database.queueEntry.create({ data: { userId: student.id, bookId } }));
    }
    await fixture.database.book.update({ where: { id: bookId }, data: { totalCopies: 1 } });
    await circulationTransaction(fixture.database, tx => reconcileBooks(tx, [bookId]));
    const held = await fixture.database.reservation.findUniqueOrThrow({ where: { queueEntryId: entries[0]!.id } });
    assert.equal(held.state, 'HELD'); assert.equal(held.userId, data.students[0]!.id);
    assert.ok(entries[0]!.orderSeq < entries[1]!.orderSeq && entries[1]!.orderSeq < entries[2]!.orderSeq);
    assert.equal(await fixture.database.notificationOutbox.count({ where: { reservationId: held.id, kind: 'TURN_AVAILABLE' } }), 1);
    return { bookId, entries, held };
  }
  type Offered = Awaited<ReturnType<typeof offered>>;

  async function reassigned(target: Offered, successor = 1) {
    const db = fixture.database;
    const old = await db.reservation.findUniqueOrThrow({ where: { id: target.held.id } });
    assert.equal(old.state, 'CANCELLED'); assert.ok(old.closedAt);
    const cancelled = await db.queueEntry.findUniqueOrThrow({ where: { id: target.entries[0]!.id } });
    assert.equal(cancelled.state, 'CANCELLED'); assert.deepEqual(cancelled.closedAt, old.closedAt);
    const held = await db.reservation.findMany({ where: { bookId: target.bookId, state: 'HELD', closedAt: null } });
    assert.equal(held.length, 1);
    assert.equal(held[0]!.queueEntryId, target.entries[successor]!.id);
    assert.equal(held[0]!.userId, data.students[successor]!.id);
    assert.equal(held[0]!.expiresAt.getTime() - held[0]!.offeredAt.getTime(), 24 * 3_600_000);
    assert.equal(await db.reservation.count({ where: { bookId: target.bookId } }), 2);
    assert.equal(await db.queueEntry.count({ where: { bookId: target.bookId, state: 'OFFERED', closedAt: null } }), 1);
    assert.equal(await db.notificationOutbox.count({ where: { reservationId: held[0]!.id, kind: 'TURN_AVAILABLE' } }), 1);
    // El aviso histórico del turno cancelado se conserva; no se exige su borrado.
    assert.equal(await db.notificationOutbox.count({ where: { reservationId: target.held.id } }), 1);
    assert.equal(await db.notificationOutbox.count({ where: { kind: 'TURN_AVAILABLE', reservation: { bookId: target.bookId } } }), 2);
    assert.equal(await db.loan.count({ where: { bookId: target.bookId } }), 0);
    return held[0]!;
  }

  async function concurrent<T>(run: (database: Database) => Promise<T>) {
    const pids = new Set<number>();
    return withConcurrentTransactions(fixture.database, async (database, attempts) => {
      // Observa conexiones REALES del pool, después de la barrera compartida.
      // No sustituye resultados, bloqueos ni errores de PostgreSQL.
      const observed = new Proxy(database, { get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver);
        return <R>(work: (tx: Prisma.TransactionClient) => Promise<R>, options?: Parameters<PrismaClient['$transaction']>[1]) =>
          target.$transaction(async tx => {
            const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            assert.ok(connection); pids.add(connection.pid);
            return work(tx);
          }, options);
      } });
      const result = await run(observed);
      assert.ok(pids.size >= 2, 'la carrera debe usar conexiones PostgreSQL distintas');
      assert.ok(attempts() >= 2 && attempts() <= 6, 'dos operaciones con hasta tres intentos completos cada una');
      return result;
    });
  }

  async function removeFault() {
    if (!faultTable) return;
    await fixture.query(`DROP TRIGGER IF EXISTS scrum24_cancel_fault ON public.${faultTable}`);
    await fixture.query('DROP FUNCTION IF EXISTS public.scrum24_cancel_fault()');
    await fixture.query('DROP SEQUENCE IF EXISTS public.scrum24_cancel_attempts');
    faultTable = undefined;
  }
  async function installFault(table: FaultTable, mode: FaultMode) {
    assert.equal(faultTable, undefined);
    faultTable = table; // Permite limpiar también una instalación incompleta.
    await fixture.query('CREATE SEQUENCE public.scrum24_cancel_attempts');
    // Tabla y modo proceden de literales cerrados de esta suite, nunca del cliente HTTP.
    await fixture.query(`CREATE FUNCTION public.scrum24_cancel_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE attempt bigint;
      BEGIN
        attempt := nextval('public.scrum24_cancel_attempts');
        ${mode === 'once' ? 'IF attempt > 1 THEN RETURN NEW; END IF;' : ''}
        RAISE EXCEPTION USING ERRCODE = '${mode === 'rollback' ? 'P0001' : '40001'}', MESSAGE = 'SCRUM24_TEST_FAULT';
      END; $$`);
    await fixture.query(`CREATE TRIGGER scrum24_cancel_fault BEFORE INSERT ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION public.scrum24_cancel_fault()`);
  }
  async function faultAttempts() {
    const [sequence] = await fixture.query<{ value: string; called: boolean }>(
      'SELECT last_value::text AS value, is_called AS called FROM public.scrum24_cancel_attempts');
    assert.ok(sequence); return sequence.called ? Number(sequence.value) : 0;
  }

  it('dos cancelaciones HTTP simultáneas: un cierre, una reserva sucesora y un aviso nuevo', async t => {
    const target = await offered();
    await concurrent(async database => {
      const api = await http(t, database);
      const results = await Promise.all([api.cancel(0, target.entries[0]!.id), api.cancel(0, target.entries[0]!.id)]);
      assert.deepEqual(results.map(result => result.status), [204, 204]);
    });
    await reassigned(target);
  });

  it('cancelación concurrente con conciliación conserva una única oferta FIFO', async t => {
    const target = await offered();
    await concurrent(async database => {
      const api = await http(t, database);
      const [response] = await Promise.all([api.cancel(0, target.entries[0]!.id),
        new CirculationRepository(database).findOccupancy([target.bookId])]);
      assert.equal(response.status, 204);
    });
    await reassigned(target);
  });

  it('cancelación frente a préstamo HTTP no concede el cupo saltándose la cola', async t => {
    const target = await offered();
    await concurrent(async database => {
      const api = await http(t, database);
      const [cancel, loan] = await Promise.all([api.cancel(0, target.entries[0]!.id), api.loan(3, target.bookId)]);
      assert.equal(cancel.status, 204); assert.equal(loan.status, 409);
      assert.equal(errorCode(loan), 'NO_AVAILABLE_COPIES');
    });
    await reassigned(target);
  });

  it('cancelación frente al propio sucesor: recupera conflictos entre bloqueo de usuario y oferta', async t => {
    const target = await offered();
    await concurrent(async database => {
      const api = await http(t, database);
      const [cancel, loan] = await Promise.all([api.cancel(0, target.entries[0]!.id), api.loan(1, target.bookId)]);
      assert.equal(cancel.status, 204); assert.equal(loan.status, 409);
      assert.equal(errorCode(loan), 'OPEN_QUEUE_ENTRY');
    });
    await reassigned(target);
  });

  it('FIFO y elegibilidad: rechaza al sucesor con cinco préstamos y ofrece al siguiente', async t => {
    const target = await offered(); const db = fixture.database;
    for (let i = 0; i < 5; i++) await fixture.addLoan(data.students[1]!.id, await fixture.createBook());
    const api = await http(t);
    assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
    await reassigned(target, 2);
    assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: target.entries[1]!.id } })).state, 'REJECTED_LIMIT');
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: target.entries[1]!.id, kind: 'QUEUE_LIMIT_REJECTED' } }), 1);
  });

  it('sin sucesores elegibles libera el cupo sin inventar una oferta', async t => {
    const target = await offered(); const db = fixture.database;
    for (const student of [1, 2]) {
      for (let i = 0; i < 5; i++) await fixture.addLoan(data.students[student]!.id, await fixture.createBook());
    }
    const api = await http(t);
    assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: target.held.id } })).state, 'CANCELLED');
    assert.equal(await db.reservation.count({ where: { bookId: target.bookId } }), 1);
    assert.equal(await db.reservation.count({ where: { bookId: target.bookId, state: 'HELD' } }), 0);
    assert.equal(await db.queueEntry.count({ where: { bookId: target.bookId, state: 'REJECTED_LIMIT' } }), 2);
    assert.equal(await db.notificationOutbox.count({ where: { kind: 'TURN_AVAILABLE', reservation: { bookId: target.bookId } } }), 1);
    const [occupancy] = await new CirculationRepository(db).findOccupancy([target.bookId]);
    assert.ok(occupancy); assert.equal(occupancy.totalCopies - occupancy.activeLoans - occupancy.heldReservations, 1);
  });

  it('cancelación ajena e inexistente: mismo 404, sin cambios persistidos', async t => {
    const target = await offered(); const before = await fixture.snapshot(); const api = await http(t);
    const foreign = await api.cancel(3, target.entries[0]!.id);
    const missing = await api.cancel(3, randomUUID());
    assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
    assert.equal(foreign.text, missing.text); assert.equal(errorCode(foreign), 'QUEUE_ENTRY_NOT_FOUND');
    assert.deepEqual(await fixture.snapshot(), before);
  });

  for (const table of ['reservations', 'notification_outbox'] as const) {
    it(`rollback completo ante fallo al insertar ${table}`, async t => {
      const target = await offered(); const before = await fixture.snapshot(); const api = await http(t);
      await installFault(table, 'rollback');
      try {
        const response = await api.cancel(0, target.entries[0]!.id);
        assert.equal(response.status, 500); assert.equal(errorCode(response), 'INTERNAL_ERROR');
        assert.equal(await faultAttempts(), 1); // La secuencia cuenta intentos y no participa en el rollback.
        assert.deepEqual(await fixture.snapshot(), before);
      } finally { await removeFault(); }
    });
  }

  it('idempotencia después del commit conserva fechas y una nueva entrada del mismo titular', async t => {
    const target = await offered(); const api = await http(t);
    assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
    await reassigned(target);
    const replacement = await new QueueRepository(fixture.database).joinQueue(data.students[0]!.id, target.bookId);
    assert.ok(!('code' in replacement)); assert.notEqual(replacement.entry.id, target.entries[0]!.id);
    const before = await fixture.snapshot();
    assert.deepEqual(await new QueueRepository(fixture.database).cancelQueue(data.students[0]!.id, target.entries[0]!.id), { closed: true });
    assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
    assert.deepEqual(await fixture.snapshot(), before);
  });

  it('conflicto PostgreSQL 40001 real: reintenta la operación completa y reasigna una sola vez', async t => {
    const target = await offered(); const api = await http(t);
    await installFault('reservations', 'once');
    try {
      assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
      assert.equal(await faultAttempts(), 2);
      await reassigned(target);
    } finally { await removeFault(); }
  });

  it('tres conflictos consecutivos producen 503 y rollback, sin salida falsa', async t => {
    const target = await offered(); const before = await fixture.snapshot(); const api = await http(t);
    await installFault('reservations', 'always');
    try {
      const response = await api.cancel(0, target.entries[0]!.id);
      assert.equal(response.status, 503); assert.equal(errorCode(response), 'SERVICE_UNAVAILABLE');
      assert.equal(await faultAttempts(), 3);
      assert.deepEqual(await fixture.snapshot(), before);
    } finally { await removeFault(); }
  });

  it('regresión WAITING: cancelar y repetir no crean reservas ni alteran préstamos', async t => {
    const queue = new QueueRepository(fixture.database);
    const joined = await queue.joinQueue(data.students[0]!.id, data.bookId);
    assert.ok(!('code' in joined)); assert.equal(joined.entry.state, 'WAITING');
    const loans = await fixture.database.loan.findMany(); const api = await http(t);
    assert.equal((await api.cancel(0, joined.entry.id)).status, 204);
    const entry = await fixture.database.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } });
    assert.equal(entry.state, 'CANCELLED'); assert.ok(entry.closedAt);
    const before = await fixture.snapshot();
    assert.equal((await api.cancel(0, joined.entry.id)).status, 204);
    assert.deepEqual(await fixture.snapshot(), before);
    assert.deepEqual(await fixture.database.loan.findMany(), loans);
    assert.equal(await fixture.database.reservation.count(), 0);
    assert.equal(await fixture.database.notificationOutbox.count(), 0);
  });
});
