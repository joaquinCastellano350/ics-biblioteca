import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { reservationScenarios } from '../reservation-scenarios.js';
import { withConcurrentTransactions } from './queue-postgres-fixture.js';
import { ReservationRepository } from '../../src/circulation/reservation-repository.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';
import { CirculationRepository } from '../../src/circulation/circulation-repository.js';

export async function reservationIntegrationScenarios(t: TestContext, db: PrismaClient) {
  await reservationScenarios(t, db);
  const university = await db.university.create({ data: { name: 'Aceptación concurrente' } });
  let sequence = 0;
  const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', universityId: university.id,
    email: `concurrente-26-${++sequence}@example.invalid`, passwordHash: 'fixture' } });
  const book = () => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies: 1 } });
  const held = async (userId: string) => {
    const target = await book();
    const entry = await db.queueEntry.create({ data: { userId, bookId: target.id } });
    await new CirculationRepository(db).findOccupancy([target.id]);
    return db.reservation.findUniqueOrThrow({ where: { queueEntryId: entry.id } });
  };
  await t.test('dos aceptaciones simultáneas devuelven el mismo préstamo y solo tres avisos', async () => {
    const owner = await user(); const reservation = await held(owner.id);
    await withConcurrentTransactions(db, async (concurrent, attempts) => {
      const results = await Promise.all([1, 2].map(() => new ReservationRepository(concurrent).acceptReservation(owner.id, reservation.id)));
      assert.ok(results.every(result => 'loan' in result));
      assert.equal(results.filter(result => 'loan' in result && result.created).length, 1);
      assert.ok(attempts() >= 3, 'reintenta completamente tras el conflicto');
      if ('loan' in results[0]! && 'loan' in results[1]!) assert.equal(results[0].loan.id, results[1].loan.id);
    });
    const loan = await db.loan.findUniqueOrThrow({ where: { reservationId: reservation.id } });
    assert.equal(await db.notificationOutbox.count({ where: { loanId: loan.id } }), 3);
  });
  for (const other of ['aceptación', 'préstamo directo'] as const) {
    await t.test(`con cuatro préstamos, aceptar y otra ${other} nunca permite seis`, async () => {
      const owner = await user();
      for (let i = 0; i < 4; i++) assert.ok('loan' in await new LoanRepository(db).requestLoan(owner.id, (await book()).id));
      const first = await held(owner.id);
      const second = other === 'aceptación' ? await held(owner.id) : null;
      const direct = second ? null : await book();
      await withConcurrentTransactions(db, async concurrent => {
        const results = await Promise.all([
          new ReservationRepository(concurrent).acceptReservation(owner.id, first.id),
          second ? new ReservationRepository(concurrent).acceptReservation(owner.id, second.id)
            : new LoanRepository(concurrent).requestLoan(owner.id, direct!.id),
        ]);
        assert.equal(results.filter(result => 'loan' in result).length, 1);
        assert.ok(results.some(result => 'code' in result && ['RESERVATION_REJECTED_LIMIT', 'LOAN_LIMIT_REACHED'].includes(result.code)));
      });
      assert.equal(await db.loan.count({ where: { userId: owner.id, closedAt: null } }), 5);
    });
  }
}
