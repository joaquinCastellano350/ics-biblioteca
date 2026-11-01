import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CirculationQueryRepository } from '../src/circulation/circulation-query-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('consulta personal: conciliación, privacidad, orden y restricciones en una instantánea', async t => {
  const fixture = await catalogDatabase(); const db = fixture.client;
  try {
    const university = await db.university.create({ data: { name: 'Prueba personal' } });
    let seq = 0;
    const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', universityId: university.id,
      email: `consulta-${++seq}@example.invalid`, passwordHash: 'fixture' } });
    const book = (totalCopies = 0) => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', totalCopies, pdfObjectKey: 'fixture.pdf' } });
    const ana = await user(); const bea = await user(); const empty = await user();
    const waiting = await book(); const reserved = await book(1); const stale = await book(1);
    await db.queueEntry.create({ data: { userId: bea.id, bookId: waiting.id } });
    const anaWait = await db.queueEntry.create({ data: { userId: ana.id, bookId: waiting.id } });
    await db.queueEntry.create({ data: { userId: ana.id, bookId: reserved.id } });
    const staleEntry = await db.queueEntry.create({ data: { userId: ana.id, bookId: stale.id, state: 'OFFERED' } });
    await db.$executeRaw`INSERT INTO reservations (id, queue_entry_id, user_id, book_id, offered_at, expires_at)
      VALUES (gen_random_uuid(), ${staleEntry.id}::uuid, ${ana.id}::uuid, ${stale.id}::uuid,
        statement_timestamp() - interval '25 hours', statement_timestamp() - interval '1 hour')`;
    const activeBooks = [await book(1), await book(1)];
    for (const [i, target] of activeBooks.entries()) {
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${ana.id}::uuid, ${target.id}::uuid,
          statement_timestamp() - ${i + 1} * interval '1 hour', statement_timestamp() + ${479 - i} * interval '1 hour')`;
    }
    for (const age of [481, -1]) {
      const target = await book(1);
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${ana.id}::uuid, ${target.id}::uuid,
          statement_timestamp() - ${age} * interval '1 hour', statement_timestamp() + ${480 - age} * interval '1 hour')`;
    }
    const repository = new CirculationQueryRepository(db);
    await t.test('esperas por FIFO y ofertas reales separadas, sin datos de otros estudiantes', async () => {
      const result = await repository.findPersonalCirculation(ana.id);
      assert.equal(result.waits.length, 1); assert.equal(result.waits[0]?.id, anaWait.id); assert.equal(result.waits[0]?.position, 2);
      assert.equal(result.reservations.length, 1); assert.equal(result.reservations[0]?.book.id, reserved.id);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: staleEntry.id } })).state, 'EXPIRED');
      assert.deepEqual(result.requestConstraints.openQueueBookIds, [waiting.id, reserved.id].sort());
      for (const field of ['userId', 'email', 'passwordHash', 'orderSeq', 'pdfObjectKey']) assert.equal(JSON.stringify(result).includes(field), false);
      const other = await repository.findPersonalCirculation(bea.id);
      assert.equal(other.reservations.length, 0); assert.equal(other.loans.length, 0); assert.equal(other.waits[0]?.position, 1);
    });
    await t.test('solo préstamos vigentes, ordenados por vencimiento', async () => {
      const result = await repository.findPersonalCirculation(ana.id);
      assert.equal(result.loans.length, 2); assert.equal(result.requestConstraints.activeLoanCount, 2);
      assert.equal(result.requestConstraints.maxActiveLoans, 5);
      assert.deepEqual(result.loans.map(loan => loan.book.id), activeBooks.map(book => book.id).reverse());
      assert.ok(result.loans.every(loan => loan.startedAt <= result.serverTime && loan.dueAt > result.serverTime));
    });
    await t.test('cuenta vacía conserva el contrato', async () => {
      const result = await repository.findPersonalCirculation(empty.id);
      assert.deepEqual(result, { serverTime: result.serverTime, loans: [], waits: [], reservations: [],
        requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } });
    });
  } finally { await fixture.close(); }
});
