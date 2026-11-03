import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconciliationScenarios } from '../reconciliation-scenarios.js';
import { openTurnsPostgresFixture } from './turns-postgres-fixture.js';
import { withConcurrentTransactions } from './queue-postgres-fixture.js';
import { circulationTransaction } from '../../src/circulation/circulation-transaction.js';
import { reconcileBooks, releaseReservation } from '../../src/circulation/reconcile-books.js';

test('contrato compartido: PostgreSQL 17 y transacciones independientes', { timeout: 120_000 }, async t => {
  const fixture = await openTurnsPostgresFixture();
  const db = fixture.database;
  try {
    await reconciliationScenarios(t, db);
    await fixture.reset();
    const university = await db.university.create({ data: { name: 'Concurrencia de contrato' } });
    const target = await db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies: 1 } });
    for (let i = 0; i < 3; i++) {
      const student = await db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', universityId: university.id,
        email: `contrato-concurrente-${i}@example.invalid`, passwordHash: 'fixture' } });
      await db.queueEntry.create({ data: { userId: student.id, bookId: target.id } });
    }
    await t.test('dos conciliadores confirman una reserva y un aviso por causa', async () => {
      await withConcurrentTransactions(db, async (database, attempts) => {
        await Promise.all([1, 2].map(() => circulationTransaction(database, tx => reconcileBooks(tx, [target.id]))));
        assert.ok(attempts() >= 3);
      });
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 1);
      assert.equal(await db.notificationOutbox.count({ where: { kind: 'TURN_AVAILABLE' } }), 1);
    });
    await t.test('dos liberaciones conservan un cierre y una única reasignación', async () => {
      const held = await db.reservation.findFirstOrThrow({ where: { bookId: target.id } });
      await withConcurrentTransactions(db, async database => {
        await Promise.all([1, 2].map(() => circulationTransaction(database, tx => releaseReservation(tx, held.id, 'CANCELLED'))));
      });
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: held.id } })).state, 'CANCELLED');
      assert.equal(await db.reservation.count({ where: { bookId: target.id, state: 'HELD' } }), 1);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
      assert.equal(await db.notificationOutbox.count({ where: { kind: 'TURN_AVAILABLE' } }), 2);
    });
  } finally { await fixture.close(); }
});
