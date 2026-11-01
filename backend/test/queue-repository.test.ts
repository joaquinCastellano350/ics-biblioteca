import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { QueueRepository } from '../src/circulation/queue-repository.js';
import { catalogDatabase } from './catalog-database.js';

const userId = '11111111-1111-4111-8111-111111111111';
const bookId = '22222222-2222-4222-8222-222222222222';

// Dobles limitados a la clasificación de errores; las reglas se prueban con SQL.
function retries(errors: unknown[]) {
  const transactions: unknown[] = []; const writes: unknown[] = [];
  const tx = {
    async $queryRaw() { return [{ id: userId }]; },
    book: { async findUnique() { return null; } },
  };
  const database = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: unknown) {
    transactions.push(options);
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
    if (errors.length) throw errors.shift();
    return work(tx as unknown as Prisma.TransactionClient);
  } };
  // La relectura completa termina aquí con BOOK_NOT_FOUND, sin fingir el resultado SQL.
  const repository = new QueueRepository(database as unknown as Pick<PrismaClient, '$transaction'>);
  return { repository, transactions, writes };
}

for (const error of [
  { code: 'P2034' }, { meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }, { code: '40P01' },
  { code: '23505', constraint: 'queue_entries_user_book_open_key' },
  { meta: { driverAdapterError: { cause: { originalCode: '23505', constraint: { index: 'queue_entries_user_book_open_key' } } } } },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { target: 'queue_entries_user_book_open_key' } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['userId', 'bookId'] } }),
]) {
  test(`reintenta una transacción nueva y relee la entrada ganadora: ${String((error as { code?: string }).code ?? 'anidado')}`, async () => {
    const f = retries([error]);
    const result = await f.repository.joinQueue(userId, bookId);
    assert.deepEqual(result, { code: 'BOOK_NOT_FOUND' });
    assert.equal(f.transactions.length, 2); assert.deepEqual(f.writes, []);

  });
}

test('agota tres intentos completos con SERVICE_UNAVAILABLE', async () => {
  const f = retries([{ code: 'P2034' }, { code: 'P2034' }, { code: 'P2034' }]);
  await assert.rejects(f.repository.joinQueue(userId, bookId), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.transactions.length, 3); assert.deepEqual(f.writes, []);
});

for (const error of [
  { code: 'P1001' }, new Error('persistencia'),
  { code: '23505', constraint: 'queue_entries_order_seq_key' },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry' } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['orderSeq'] } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'Other', target: ['userId', 'bookId'] } }),
]) {
  test('no confunde otros errores de persistencia/unicidad con la entrada abierta', async () => {
    const f = retries([error]);
    await assert.rejects(f.repository.joinQueue(userId, bookId), caught => caught === error);
    assert.equal(f.transactions.length, 1); assert.deepEqual(f.writes, []);
  });
}


test('unirse a cola integra conciliación, repetición y validaciones persistidas', async t => {
  const fixture = await catalogDatabase(); const db = fixture.client;
  try {
    const university = await db.university.create({ data: { name: 'Universidad' } });
    let seq = 0;
    const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: `cola-${++seq}@example.invalid`,
      universityId: university.id, passwordHash: 'fixture' } });
    const book = (totalCopies = 1) => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies } });
    const repository = new QueueRepository(db);
    await t.test('sin capacidad crea una entrada y repetir conserva identidad y posición', async () => {
      const student = await user(); const target = await book(0);
      const created = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in created)); assert.equal(created.created, true); assert.equal(created.entry.position, 1);
      const again = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in again)); assert.equal(again.created, false); assert.deepEqual(again.entry, created.entry);
      assert.equal(await db.queueEntry.count({ where: { userId: student.id } }), 1);
    });
    await t.test('cupo pendiente se ofrece primero a la espera anterior y el recién llegado entra después', async () => {
      const first = await user(); const newcomer = await user(); const target = await book();
      const prior = await db.queueEntry.create({ data: { userId: first.id, bookId: target.id } });
      const created = await repository.joinQueue(newcomer.id, target.id);
      assert.ok(!('code' in created)); assert.equal(created.entry.state, 'WAITING'); assert.equal(created.entry.position, 1);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: prior.id } })).state, 'OFFERED');
      const repeated = await repository.joinQueue(first.id, target.id);
      assert.ok(!('code' in repeated)); assert.equal(repeated.created, false); assert.equal(repeated.entry.state, 'OFFERED');
      assert.equal(repeated.entry.position, null);
    });
    await t.test('cierra préstamo vencido antes de informar cupos disponibles', async () => {
      const student = await user(); const target = await book();
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${student.id}::uuid, ${target.id}::uuid,
          statement_timestamp() - interval '481 hours', statement_timestamp() - interval '1 hour')`;
      assert.deepEqual(await repository.joinQueue(student.id, target.id), { code: 'AVAILABLE_COPIES' });
      assert.ok((await db.loan.findFirstOrThrow({ where: { bookId: target.id } })).closedAt);
    });
    await t.test('no reabre terminales y rechaza sexto préstamo o libro propio vigente', async () => {
      const student = await user(); const target = await book(0);
      const terminal = await db.queueEntry.create({ data: { userId: student.id, bookId: target.id, state: 'CANCELLED', joinedAt: new Date(Date.now() - 3_600_000), closedAt: new Date() } });
      const result = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in result)); assert.notEqual(result.entry.id, terminal.id);
      const borrowed = await book();
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${student.id}::uuid, ${borrowed.id}::uuid, statement_timestamp(), statement_timestamp() + interval '480 hours')`;
      assert.deepEqual(await repository.joinQueue(student.id, borrowed.id), { code: 'BOOK_ALREADY_BORROWED' });
      for (let i = 0; i < 4; i++) {
        const extra = await book();
        await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
          VALUES (gen_random_uuid(), ${student.id}::uuid, ${extra.id}::uuid, statement_timestamp(), statement_timestamp() + interval '480 hours')`;
      }
      assert.deepEqual(await repository.joinQueue(student.id, (await book(0)).id), { code: 'LOAN_LIMIT_REACHED' });
    });
  } finally { await fixture.close(); }
});
