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
import { ReservationRepository } from '../../src/circulation/reservation-repository.js';
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

  async function http(t: TestContext, database: Database = fixture.database, acceptanceDatabase: Database = database) {
    const unexpected = async (): Promise<never> => { throw new Error('Servicio externo no permitido en integración'); };
    const server = createApp({ checkDatabase: unexpected, checkStorage: unexpected,
      accounts: new AccountsService(new PrismaAccountsRepository(fixture.database)),
      queue: new QueueRepository(database), loans: new LoanRepository(database),
      reservations: new ReservationRepository(acceptanceDatabase),
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
      accept: (student: number, reservationId: string) => post(student, `/api/reservations/${reservationId}/accept`, {}),
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

  async function waiting(expiredLoan = false, count = 3) {
    const bookId = await fixture.createBook(); const entries = [];
    for (const student of data.students.slice(0, count)) {
      entries.push(await fixture.database.queueEntry.create({ data: { userId: student.id, bookId } }));
    }
    const expiredId = expiredLoan ? await fixture.addLoan(data.students[3]!.id, bookId, 481) : null;
    return { bookId, entries, expiredId };
  }

  async function cancelledWait(target: Awaited<ReturnType<typeof waiting>>, canHaveHistoricalOffer = false) {
    const db = fixture.database;
    const cancelled = await db.queueEntry.findUniqueOrThrow({ where: { id: target.entries[0]!.id } });
    assert.equal(cancelled.state, 'CANCELLED'); assert.ok(cancelled.closedAt);
    assert.equal(await db.reservation.count({ where: { queueEntryId: cancelled.id, state: 'HELD' } }), 0);
    if (!canHaveHistoricalOffer) {
      assert.equal(await db.reservation.count({ where: { queueEntryId: cancelled.id } }), 0);
      assert.equal(await db.notificationOutbox.count({ where: { reservation: { queueEntryId: cancelled.id } } }), 0);
    }
    const held = await db.reservation.findMany({ where: { bookId: target.bookId, state: 'HELD' } });
    assert.equal(held.length, target.entries.length > 1 ? 1 : 0);
    if (target.entries.length > 1) {
      assert.equal(held[0]!.queueEntryId, target.entries[1]!.id);
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: held[0]!.id, kind: 'TURN_AVAILABLE' } }), 1);
    }
    if (target.expiredId) assert.ok((await db.loan.findUniqueOrThrow({ where: { id: target.expiredId } })).closedAt);
  }

  for (const expired of [false, true]) {
    it(`WAITING HTTP: cancela antes de conciliar, no recibe oferta y atiende FIFO; vencido=${expired}`, async t => {
      const target = await waiting(expired); const api = await http(t);
      assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
      await cancelledWait(target);
      const before = await fixture.snapshot();
      assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
      assert.deepEqual(await fixture.snapshot(), before);
    });
  }

  it('WAITING sin sucesor: cierra vencido y deja el cupo libre sin reserva', async t => {
    const target = await waiting(true, 1); const api = await http(t);
    assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
    await cancelledWait(target);
    assert.equal(await fixture.database.reservation.count({ where: { bookId: target.bookId } }), 0);
  });

  it('WAITING ajena o inexistente no dispara conciliación ni escrituras', async t => {
    const target = await waiting(true); const before = await fixture.snapshot(); const api = await http(t);
    const foreign = await api.cancel(1, target.entries[0]!.id); const missing = await api.cancel(1, randomUUID());
    assert.equal(foreign.status, 404); assert.equal(missing.status, 404); assert.equal(foreign.text, missing.text);
    assert.deepEqual(await fixture.snapshot(), before);
  });

  for (const table of ['reservations', 'notification_outbox'] as const) {
    it(`WAITING: fallo de ${table} revierte cancelación, cierre vencido y oferta`, async t => {
      const target = await waiting(true); const before = await fixture.snapshot(); const api = await http(t);
      await installFault(table, 'rollback');
      try {
        const response = await api.cancel(0, target.entries[0]!.id);
        assert.equal(response.status, 500); assert.equal(errorCode(response), 'INTERNAL_ERROR');
        assert.deepEqual(await fixture.snapshot(), before);
      } finally { await removeFault(); }
      assert.equal((await api.cancel(0, target.entries[0]!.id)).status, 204);
      await cancelledWait(target);
    });
  }

  for (const competing of ['reconciliation', 'loan'] as const) {
    it(`WAITING cancelación concurrente con ${competing}: sin doble oferta ni salto de cola`, async t => {
      const target = await waiting(true);
      await concurrent(async database => {
        const api = await http(t, database);
        if (competing === 'reconciliation') {
          const [cancel] = await Promise.all([api.cancel(0, target.entries[0]!.id),
            new CirculationRepository(database).findOccupancy([target.bookId])]);
          assert.equal(cancel.status, 204);
        } else {
          const [cancel, loan] = await Promise.all([api.cancel(0, target.entries[0]!.id), api.loan(3, target.bookId)]);
          assert.equal(cancel.status, 204); assert.equal(loan.status, 409);
          assert.equal(errorCode(loan), 'NO_AVAILABLE_COPIES');
        }
      });
      // Si la otra transacción se serializó antes, puede existir una oferta histórica cancelada.
      await cancelledWait(target, true);
      assert.equal(await fixture.database.loan.count({ where: { bookId: target.bookId, closedAt: null } }), 0);
    });
  }

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

  async function acceptanceCancellationRace(t: TestContext, target: Offered, winner: 'accept' | 'cancel') {
    return withConcurrentTransactions(fixture.database, async (database, totalAttempts) => {
      let winnerLocked!: (pid: number) => void;
      let loserConnected!: (pid: number) => void;
      let releaseWinner!: () => void;
      const locked = new Promise<number>(resolve => { winnerLocked = resolve; });
      const connected = new Promise<number>(resolve => { loserConnected = resolve; });
      const release = new Promise<void>(resolve => { releaseWinner = resolve; });
      const attempts = { accept: 0, cancel: 0 };
      const commits: Array<'accept' | 'cancel'> = [];
      let coordinationError: Error | undefined;
      let fail!: (error: Error) => void;
      const failed = new Promise<never>((_resolve, reject) => { fail = reject; });
      void failed.catch(() => {});
      // Deadline de fallo: la sincronización depende del bloqueo observado, no del tiempo.
      const deadline = setTimeout(() => {
        coordinationError = new Error('No se observó la contención de la reserva.');
        fail(coordinationError);
      }, 8_000);
      const bounded = <T>(promise: Promise<T>) => Promise.race([promise, failed]);
      const forOperation = (operation: 'accept' | 'cancel'): Database => new Proxy(database, {
        get(object, key, receiver) {
          if (key !== '$transaction') return Reflect.get(object, key, receiver);
          return async <R>(work: (tx: Prisma.TransactionClient) => Promise<R>, options?: Parameters<PrismaClient['$transaction']>[1]) => {
            const attempt = ++attempts[operation];
            assert.ok(attempt <= 3, 'cada operación conserva el límite de tres intentos');
            assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
            const result = await object.$transaction(async tx => {
              if (attempt === 1) {
                const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
                assert.ok(connection);
                if (operation === winner) {
                  // Adquiere el mismo primer bloqueo del protocolo productivo.
                  // work() vuelve a adquirirlo en esta transacción, sin alterar sus consultas ni resultados.
                  const owners = await tx.$queryRaw<{ id: string }[]>`
                    SELECT id FROM users WHERE id = ${data.students[0]!.id}::uuid FOR UPDATE`;
                  assert.deepEqual(owners, [{ id: data.students[0]!.id }]);
                  winnerLocked(connection.pid);
                  await bounded(release);
                } else {
                  loserConnected(connection.pid);
                  await bounded(locked);
                }
              }
              return work(tx);
            }, options);
            // $transaction solo resuelve después del COMMIT real.
            commits.push(operation);
            return result;
          };
        },
      });
      const requests: Promise<unknown>[] = [];
      let observation: Promise<void> | undefined;
      try {
        const api = await http(t, forOperation('cancel'), forOperation('accept'));
        const accepting = api.accept(0, target.held.id);
        const cancelling = api.cancel(0, target.entries[0]!.id);
        requests.push(accepting, cancelling);
        const responses = Promise.all([accepting, cancelling]);
        void responses.catch(() => {});
        const [winnerPid, loserPid] = await bounded(Promise.all([locked, connected]));
        assert.notEqual(winnerPid, loserPid, 'las dos transacciones usan conexiones PostgreSQL independientes');
        // El observador de la fixture es una tercera conexión. Comprueba contención
        // efectiva del SELECT FOR UPDATE del perdedor; nunca usa pg_sleep ni pausas.
        observation = (async () => {
          for (;;) {
            if (coordinationError) throw coordinationError;
            const [state] = await fixture.query<{ blocked: boolean }>(
              'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [winnerPid, loserPid]);
            assert.ok(state);
            if (state.blocked) return;
            if (commits.length) throw new Error('Se confirmó una operación antes de comprobar la contención.');
          }
        })();
        await bounded(observation);
        assert.deepEqual(commits, []);
        clearTimeout(deadline);
        releaseWinner();
        const [accept, cancel] = await responses;
        assert.deepEqual(commits, winner === 'accept' ? ['accept', 'cancel'] : ['cancel', 'accept']);
        assert.ok(attempts.accept >= 1 && attempts.accept <= 3);
        assert.ok(attempts.cancel >= 1 && attempts.cancel <= 3);
        assert.ok(totalAttempts() >= 3 && totalAttempts() <= 6, 'la instantánea perdedora requiere reintento completo y limitado');
        return { accept, cancel };
      } finally {
        clearTimeout(deadline);
        coordinationError ??= new Error('Finalizó la coordinación de esta carrera.');
        releaseWinner();
        // No dejar transacciones o peticiones vivas si falla una barrera o aserción.
        await Promise.allSettled([...requests, ...(observation ? [observation] : [])]);
      }
    });
  }

  for (const winner of ['accept', 'cancel'] as const) {
    it(`aceptar y cancelar la misma reserva con conexiones independientes: gana ${winner}`, async t => {
      const target = await offered(); const db = fixture.database;
      const historical = await db.notificationOutbox.findMany({ where: { reservationId: target.held.id }, orderBy: { id: 'asc' } });
      const { accept, cancel } = await acceptanceCancellationRace(t, target, winner);
      if (winner === 'accept') {
        assert.equal(accept.status, 201); assert.equal(cancel.status, 409);
        assert.equal(errorCode(cancel), 'QUEUE_ENTRY_FULFILLED');
        const loan = await db.loan.findUniqueOrThrow({ where: { reservationId: target.held.id } });
        const body: unknown = JSON.parse(accept.text);
        assert.ok(body && typeof body === 'object' && 'loan' in body && body.loan && typeof body.loan === 'object'
          && 'id' in body.loan && body.loan.id === loan.id && 'created' in body && body.created === true
          && 'active' in body && body.active === true);
        assert.equal(loan.userId, data.students[0]!.id); assert.equal(loan.bookId, target.bookId);
        assert.equal(loan.closedAt, null); assert.equal(loan.dueAt.getTime() - loan.startedAt.getTime(), 480 * 3_600_000);
        assert.equal(await db.loan.count({ where: { bookId: target.bookId } }), 1);
        const reservation = await db.reservation.findUniqueOrThrow({ where: { id: target.held.id } });
        const entry = await db.queueEntry.findUniqueOrThrow({ where: { id: target.entries[0]!.id } });
        assert.equal(reservation.state, 'CONSUMED'); assert.equal(entry.state, 'FULFILLED');
        assert.equal(reservation.queueEntryId, entry.id); assert.equal(reservation.userId, loan.userId);
        assert.equal(reservation.bookId, loan.bookId); assert.equal(entry.userId, loan.userId); assert.equal(entry.bookId, loan.bookId);
        assert.deepEqual(reservation.closedAt, loan.startedAt); assert.deepEqual(entry.closedAt, loan.startedAt);
        assert.equal(await db.reservation.count({ where: { bookId: target.bookId } }), 1);
        assert.equal(await db.reservation.count({ where: { bookId: target.bookId, state: 'HELD' } }), 0);
        assert.equal(await db.queueEntry.count({ where: { bookId: target.bookId, state: 'OFFERED' } }), 0);
        const waiting = await db.queueEntry.findMany({ where: { id: { in: target.entries.slice(1).map(item => item.id) } } });
        assert.equal(waiting.length, 2); assert.ok(waiting.every(item => item.state === 'WAITING' && item.closedAt === null));
        const notices = await db.notificationOutbox.findMany({ where: { loanId: loan.id } });
        assert.equal(notices.length, 3); assert.equal(new Set(notices.map(item => item.dedupKey)).size, 3);
        assert.deepEqual(notices.map(item => item.kind).sort(), ['LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED']);
        assert.equal(await db.notificationOutbox.count({ where: { kind: 'TURN_AVAILABLE', reservation: { bookId: target.bookId } } }), 1);
        const before = await fixture.snapshot(); const replay = await http(t);
        const denied = await replay.cancel(0, target.entries[0]!.id);
        assert.equal(denied.status, 409); assert.equal(errorCode(denied), 'QUEUE_ENTRY_FULFILLED');
        const repeated = await replay.accept(0, target.held.id);
        assert.equal(repeated.status, 200);
        const result: unknown = JSON.parse(repeated.text);
        assert.ok(result && typeof result === 'object' && 'created' in result && result.created === false
          && 'loan' in result && result.loan && typeof result.loan === 'object' && 'id' in result.loan && result.loan.id === loan.id);
        assert.deepEqual(await fixture.snapshot(), before);
        assert.deepEqual(await db.loan.findUniqueOrThrow({ where: { id: loan.id } }), loan);
      } else {
        assert.equal(cancel.status, 204); assert.equal(accept.status, 409);
        assert.equal(errorCode(accept), 'RESERVATION_CANCELLED');
        const successor = await reassigned(target);
        const successorEntry = await db.queueEntry.findUniqueOrThrow({ where: { id: successor.queueEntryId } });
        assert.equal(successorEntry.state, 'OFFERED'); assert.equal(successorEntry.closedAt, null);
        assert.equal(successorEntry.userId, successor.userId); assert.equal(successorEntry.bookId, successor.bookId);
        assert.equal(await db.loan.count({ where: { reservationId: target.held.id } }), 0);
        const before = await fixture.snapshot(); const replay = await http(t);
        assert.equal((await replay.cancel(0, target.entries[0]!.id)).status, 204);
        const repeated = await replay.accept(0, target.held.id);
        assert.equal(repeated.status, 409); assert.equal(errorCode(repeated), 'RESERVATION_CANCELLED');
        assert.deepEqual(await fixture.snapshot(), before);
      }
      assert.deepEqual(await db.notificationOutbox.findMany({ where: { reservationId: target.held.id }, orderBy: { id: 'asc' } }), historical);
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
