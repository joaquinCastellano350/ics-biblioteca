import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createApp } from '../../src/app.js';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { PrismaAccountsRepository } from '../../src/accounts/prisma-accounts.repository.js';
import { QueueRepository } from '../../src/circulation/queue-repository.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';
import { CirculationQueryRepository } from '../../src/circulation/circulation-query-repository.js';
import { IsolatedSqlError, openQueuePostgresFixture, withConcurrentTransactions } from './queue-postgres-fixture.js';
import type { QueuePostgresFixture } from './queue-postgres-fixture.js';

// No conexión al importar. Sin autorización explícita, before falla antes de construir clientes.
// Suite secuencial; solo los casos que usan la barrera abren operaciones concurrentes.
describe('SCRUM-23 con PostgreSQL 17 local exclusivo', { concurrency: false, timeout: 180_000 }, () => {
  let fixture: QueuePostgresFixture;
  let data: Awaited<ReturnType<QueuePostgresFixture['seed']>>;
  before(async () => { fixture = await openQueuePostgresFixture(); });
  beforeEach(async () => { await fixture.reset(); data = await fixture.seed(); });
  after(async () => { await fixture?.close(); });

  async function app(t: TestContext, database: Pick<PrismaClient, '$transaction'> = fixture.database) {
    const unexpected = async (): Promise<never> => { throw new Error('Servicio externo no permitido en integración.'); };
    const server = createApp({
      checkDatabase: unexpected, checkStorage: unexpected,
      accounts: new AccountsService(new PrismaAccountsRepository(fixture.database)),
      queue: new QueueRepository(database), loans: new LoanRepository(database),
      circulationQueries: new CirculationQueryRepository(fixture.database),
    }).listen(0, '127.0.0.1');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      async post(student = 0, bookId = data.bookId, path = '/api/queue-entries') {
        const response = await fetch(`${base}${path}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: data.students[student]!.cookie },
          body: JSON.stringify({ bookId }), signal: AbortSignal.timeout(45_000),
        });
        const body = await response.json();
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('set-cookie'), null);
        return { status: response.status, body };
      },
      async personal(student: number) {
        const response = await fetch(`${base}/api/me/circulation`, {
          headers: { Cookie: data.students[student]!.cookie }, signal: AbortSignal.timeout(15_000),
        });
        assert.equal(response.status, 200);
        return response.json();
      },
    };
  }
  async function ordered() {
    return fixture.query<{ id: string; user_id: string; order_seq: string }>(
      "SELECT id, user_id, order_seq::text FROM queue_entries WHERE book_id = $1 AND state = 'WAITING' ORDER BY order_seq", [data.bookId]);
  }
  async function offer(expired = false) {
    const entry = await fixture.database.queueEntry.create({ data: {
      userId: data.students[2]!.id, bookId: data.bookId, state: 'OFFERED',
    } });
    await fixture.query(`INSERT INTO reservations (id, queue_entry_id, user_id, book_id, offered_at, expires_at)
      SELECT $1, $2, $3, $4, t, t + interval '24 hours'
      FROM (SELECT clock_timestamp() - $5::double precision * interval '1 hour' AS t) clock`,
    [randomUUID(), entry.id, data.students[2]!.id, data.bookId, expired ? 25 : 1]);
    return entry;
  }

  it('dos estudiantes concurrentes: dos entradas y posiciones según el orden confirmado', async t => {
    await withConcurrentTransactions(fixture.database, async (database, attempts) => {
      const http = await app(t, database);
      const responses = await Promise.all([http.post(0), http.post(1)]);
      assert.deepEqual(responses.map(r => r.status), [201, 201]);
      const rows = await ordered(); assert.equal(rows.length, 2);
      for (const response of responses) {
        assert.equal(response.body.entry.position, rows.findIndex(row => row.id === response.body.entry.id) + 1);
        assert.equal(response.body.entry.state, 'WAITING');
        assert.deepEqual(Object.keys(response.body).sort(), ['entry', 'serverTime']);
        assert.deepEqual(Object.keys(response.body.entry).sort(), ['book', 'id', 'joinedAt', 'position', 'state']);
      }
      for (const student of [0, 1]) {
        const personal = await http.personal(student);
        assert.equal(personal.waits.length, 1);
        assert.equal(personal.waits[0].position, rows.findIndex(row => row.user_id === data.students[student]!.id) + 1);
      }
      assert.ok(attempts() >= 2);
      t.diagnostic(`Intentos transaccionales reales: ${attempts()}`);
    });
  });

  it('dos solicitudes concurrentes del mismo titular: una fila, un 201 y un 200', async t => {
    await withConcurrentTransactions(fixture.database, async database => {
      const http = await app(t, database);
      const results = await Promise.all([http.post(), http.post()]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
      assert.equal(results[0]!.body.entry.id, results[1]!.body.entry.id);
      assert.equal(results[0]!.body.entry.position, 1); assert.equal(results[1]!.body.entry.position, 1);
      assert.equal((await ordered()).length, 1);
    });
  });

  it('calcula posición entre WAITING persistidas sin exigir secuencias consecutivas', async t => {
    const http = await app(t);
    assert.equal((await http.post(2)).status, 201);
    // Consumir un número sin crear entrada demuestra que un hueco no altera la posición.
    await fixture.query("SELECT nextval(pg_get_serial_sequence('queue_entries', 'order_seq'))");
    const second = await http.post(1); const third = await http.post(0);
    assert.equal(second.body.entry.position, 2); assert.equal(third.body.entry.position, 3);
    const rows = await ordered(); assert.equal(rows.length, 3);
    assert.ok(BigInt(rows[1]!.order_seq) > BigInt(rows[0]!.order_seq) + 1n);
    assert.equal((await http.personal(0)).waits[0].position, 3);
  });

  for (const state of ['WAITING', 'OFFERED']) {
    it(`el índice parcial rechaza un duplicado abierto ${state} pero permite otra entrada tras el cierre`, async () => {
      const entry = await fixture.database.queueEntry.create({ data: { userId: data.students[0]!.id, bookId: data.bookId, state } });
      const insert = () => fixture.query(`INSERT INTO queue_entries (id, user_id, book_id, state)
        VALUES ($1, $2, $3, 'WAITING')`, [randomUUID(), data.students[0]!.id, data.bookId]);
      await assert.rejects(insert, error => error instanceof IsolatedSqlError && error.code === '23505'
        && error.constraint === 'queue_entries_user_book_open_key');
      await fixture.query("UPDATE queue_entries SET state = 'CANCELLED', closed_at = clock_timestamp() WHERE id = $1", [entry.id]);
      await insert();
      assert.equal(await fixture.database.queueEntry.count(), 2);
      const terminal = await fixture.database.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
      assert.equal(terminal.state, 'CANCELLED'); assert.equal(terminal.orderSeq, entry.orderSeq);
    });
  }

  it('repetir WAITING mantiene identificador, fecha, orden y posición', async t => {
    const http = await app(t); const first = await http.post(); const before = await fixture.snapshot();
    const repeated = await http.post();
    assert.equal(first.status, 201); assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body.entry, first.body.entry);
    assert.deepEqual(await fixture.snapshot(), before);
  });

  it('repetir OFFERED devuelve posición null sin crear espera ni modificar la reserva', async t => {
    data.bookId = await fixture.createBook();
    const offered = await offer(); const before = await fixture.snapshot(); const http = await app(t);
    const response = await http.post(2);
    assert.equal(response.status, 200); assert.equal(response.body.entry.id, offered.id);
    assert.equal(response.body.entry.state, 'OFFERED'); assert.equal(response.body.entry.position, null);
    assert.deepEqual(await fixture.snapshot(), before);
    const personal = await http.personal(2); assert.equal(personal.waits.length, 0); assert.equal(personal.reservations.length, 1);
  });

  it('cinco préstamos vigentes: 409 y ninguna escritura de circulación', async t => {
    for (let i = 0; i < 5; i++) await fixture.addLoan(data.students[0]!.id, await fixture.createBook());
    const before = await fixture.snapshot(); const http = await app(t);
    await fixture.installFault('reject-writes');
    try {
      const response = await http.post(); assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'LOAN_LIMIT_REACHED');
      assert.equal(await fixture.writeAttempts(), 0); assert.deepEqual(await fixture.snapshot(), before);
    } finally { await fixture.removeHooks(); }
  });

  it('libro propio prestado: 409 y ninguna escritura de circulación', async t => {
    const before = await fixture.snapshot(); const http = await app(t);
    await fixture.installFault('reject-writes');
    try {
      const response = await http.post(3); assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'BOOK_ALREADY_BORROWED');
      assert.equal(await fixture.writeAttempts(), 0); assert.deepEqual(await fixture.snapshot(), before);
    } finally { await fixture.removeHooks(); }
  });

  it('fallo AFTER INSERT: rollback real de la entrada y de la escritura auxiliar', async t => {
    const before = await fixture.snapshot(); const http = await app(t);
    await fixture.installFault('rollback');
    try {
      const result = await http.post(); assert.equal(result.status, 500);
      assert.equal(result.body.error.code, 'INTERNAL_ERROR');
      assert.equal(JSON.stringify(result.body).includes('SCRUM23_TEST_FAULT'), false);
      assert.equal(await fixture.writeAttempts(), 1); // La secuencia no revierte.
      const [probe] = await fixture.query<{ count: string }>('SELECT count(*)::text AS count FROM scrum23_rollback_probe');
      assert.equal(probe!.count, '0');
      assert.deepEqual(await fixture.snapshot(), before);
    } finally { await fixture.removeHooks(); }
  });

  for (const pending of ['expired-loan', 'expired-reservation', 'orphan-offer', 'waiting-with-capacity']) {
    it(`conciliación pendiente (${pending}): 503 sin intentos de escritura`, async t => {
      if (pending === 'expired-loan') await fixture.addLoan(data.students[2]!.id, data.bookId, 481);
      if (pending === 'expired-reservation') await offer(true);
      if (pending === 'orphan-offer') await fixture.database.queueEntry.create({ data: {
        userId: data.students[2]!.id, bookId: data.bookId, state: 'OFFERED',
      } });
      if (pending === 'waiting-with-capacity') {
        data.bookId = await fixture.createBook();
        await fixture.database.queueEntry.create({ data: { userId: data.students[2]!.id, bookId: data.bookId, state: 'WAITING' } });
      }
      const before = await fixture.snapshot(); const http = await app(t);
      await fixture.installFault('reject-writes');
      try {
        const result = await http.post(); assert.equal(result.status, 503);
        assert.equal(result.body.error.code, 'CIRCULATION_RECONCILIATION_REQUIRED');
        assert.equal(await fixture.writeAttempts(), 0); assert.deepEqual(await fixture.snapshot(), before);
      } finally { await fixture.removeHooks(); }
    });
  }

  it('préstamo y cola concurrentes sin cupos: inscripción válida y préstamo rechazado', async t => {
    await withConcurrentTransactions(fixture.database, async database => {
      const http = await app(t, database);
      const [queue, loan] = await Promise.all([http.post(0), http.post(1, data.bookId, '/api/loans')]);
      assert.equal(queue.status, 201); assert.equal(loan.status, 409);
      assert.equal(loan.body.error.code, 'NO_AVAILABLE_COPIES');
      assert.equal(await fixture.database.loan.count({ where: { bookId: data.bookId } }), 1);
      assert.equal((await ordered()).length, 1);
    });
  });

  for (const sameStudent of [false, true]) {
    it(`préstamo y cola concurrentes con cupo: ${sameStudent ? 'mismo titular' : 'distintos titulares'}`, async t => {
      data.bookId = await fixture.createBook();
      await withConcurrentTransactions(fixture.database, async database => {
        const http = await app(t, database);
        const [queue, loan] = await Promise.all([http.post(0), http.post(sameStudent ? 0 : 1, data.bookId, '/api/loans')]);
        assert.equal(loan.status, 201);
        if (sameStudent) {
          assert.equal(queue.status, 409); assert.ok(['AVAILABLE_COPIES', 'BOOK_ALREADY_BORROWED'].includes(queue.body.error.code));
          assert.equal((await ordered()).length, 0);
        } else if (queue.status === 201) {
          // Si la concesión se confirmó primero, el otro estudiante puede entrar después.
          assert.equal(queue.body.entry.position, 1); assert.equal((await ordered()).length, 1);
        } else {
          assert.equal(queue.status, 409); assert.equal(queue.body.error.code, 'AVAILABLE_COPIES');
          assert.equal((await ordered()).length, 0);
        }
        assert.equal(await fixture.database.loan.count({ where: { bookId: data.bookId } }), 1);
        assert.equal(await fixture.database.notificationOutbox.count(), 3);
      });
    });
  }
});
