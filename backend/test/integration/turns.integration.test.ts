import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnsScenarios } from '../turns-scenarios.js';
import { openTurnsPostgresFixture } from './turns-postgres-fixture.js';
import { withConcurrentTransactions } from './queue-postgres-fixture.js';
import { CirculationRepository } from '../../src/circulation/circulation-repository.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';
import { circulationTransaction } from '../../src/circulation/circulation-transaction.js';
import { releaseReservation } from '../../src/circulation/reconcile-books.js';
import { reservationIntegrationScenarios } from './reservation-integration-scenarios.js';

test('SCRUM-25/26: PostgreSQL 17 aislado y contención entre conexiones', { timeout: 120_000 }, async t => {
  const fixture = await openTurnsPostgresFixture();
  const db = fixture.database;
  try {
    await turnsScenarios(t, db);
    await fixture.reset();
    const university = await db.university.create({ data: { name: 'Prueba concurrente' } });
    let seq = 0;
    const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', universityId: university.id,
      email: `concurrente-${++seq}@example.invalid`, passwordHash: 'fixture' } });
    const book = () => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies: 1 } });
    await t.test('dos conciliadores por el último cupo: una reserva y un aviso', async () => {
      const target = await book(); const first = await user(); const next = await user();
      await db.queueEntry.createMany({ data: [{ userId: first.id, bookId: target.id }, { userId: next.id, bookId: target.id }] });
      await withConcurrentTransactions(db, async (concurrent, attempts) => {
        await Promise.all([1, 2].map(() => new CirculationRepository(concurrent).findOccupancy([target.id])));
        assert.ok(attempts() >= 3, 'el conflicto requiere reintentar la transacción completa');
      });
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 1);
      const held = await db.reservation.findFirstOrThrow({ where: { bookId: target.id } });
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: held.id } }), 1);
    });
    await t.test('conciliación y préstamo directo no se adelantan a la cola', async () => {
      const target = await book(); const waiting = await user(); const newcomer = await user();
      await db.queueEntry.create({ data: { userId: waiting.id, bookId: target.id } });
      await withConcurrentTransactions(db, async concurrent => {
        const [, result] = await Promise.all([
          new CirculationRepository(concurrent).findOccupancy([target.id]),
          new LoanRepository(concurrent).requestLoan(newcomer.id, target.id),
        ]);
        assert.deepEqual(result, { code: 'NO_AVAILABLE_COPIES' });
      });
      assert.equal(await db.loan.count({ where: { bookId: target.id } }), 0);
      assert.equal((await db.reservation.findFirstOrThrow({ where: { bookId: target.id } })).userId, waiting.id);
    });
    await t.test('dos liberaciones simultáneas conservan el cierre y una única reasignación', async () => {
      const target = await book();
      for (let i = 0; i < 3; i++) await db.queueEntry.create({ data: { userId: (await user()).id, bookId: target.id } });
      await new CirculationRepository(db).findOccupancy([target.id]);
      const held = await db.reservation.findFirstOrThrow({ where: { bookId: target.id } });
      await withConcurrentTransactions(db, async concurrent => {
        await Promise.all([1, 2].map(() => circulationTransaction(concurrent, tx => releaseReservation(tx, held.id, 'CANCELLED'))));
      });
      assert.equal(await db.reservation.count({ where: { bookId: target.id, state: 'HELD' } }), 1);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: held.id } })).state, 'CANCELLED');
    });
    await fixture.reset();
    await reservationIntegrationScenarios(t, db);
  } finally { await fixture.close(); }
});
