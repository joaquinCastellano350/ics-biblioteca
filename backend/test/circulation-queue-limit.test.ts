import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { CirculationController } from '../src/circulation/circulation-controller.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('rechazo puntual por límite: terminal, en orden y solo al llegar el turno', async (t) => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  try {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const at = (hours: number) => new Date(clock!.now.getTime() + hours * 3_600_000);
    const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
    let sequence = 0;
    const user = () => db.user.create({ data: { firstName: 'Prueba', lastName: 'Cola',
      universityId: university.id, email: `limite-${++sequence}@example.org`, passwordHash: 'fixture' } });
    const book = () => db.book.create({ data: {
      title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies: 1,
    } });
    const loan = (userId: string, bookId: string) => db.loan.create({ data: {
      userId, bookId, startedAt: at(-1), dueAt: at(479),
    } });
    const fiveLoans = async (userId: string) => {
      const loans = [];
      for (let i = 0; i < 5; i++) loans.push(await loan(userId, (await book()).id));
      return loans;
    };
    const queue = (userId: string, bookId: string) => db.queueEntry.create({ data: { userId, bookId, joinedAt: at(-2) } });
    const availability = (bookId: string) => new CirculationController(new CirculationRepository(db)).findAvailability([bookId]);

    await t.test('bajar de cinco a cuatro no recupera la posición rechazada', async () => {
      const target = await book();
      const ana = await user();
      const next = await user();
      const loans = await fiveLoans(ana.id);
      const first = await queue(ana.id, target.id);
      const second = await queue(next.id, target.id);
      assert.equal((await availability(target.id))[0]?.availableCopies, 0);
      const rejected = await db.queueEntry.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(rejected.state, 'REJECTED_LIMIT');
      assert.ok(rejected.closedAt);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: second.id } })).state, 'WAITING');
      await db.loan.update({ where: { id: loans[0]!.id }, data: { startedAt: at(-481), dueAt: at(-1) } });
      // La salida del siguiente se prepara solo como dato de prueba. No hay
      // endpoint nuevo ni creación de reservas en esta corrección.
      await db.queueEntry.update({ where: { id: second.id }, data: { state: 'CANCELLED', closedAt: clock!.now } });
      assert.equal((await availability(target.id))[0]?.availableCopies, 1);
      const after = await db.queueEntry.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(after.state, 'REJECTED_LIMIT');
      assert.deepEqual(after.closedAt, rejected.closedAt);
      // Este vencimiento pertenece a otro libro y la consulta actual no lo procesa.
      assert.equal((await db.loan.findUniqueOrThrow({ where: { id: loans[0]!.id } })).closedAt, null);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
      assert.equal(await db.notificationOutbox.count(), 0);
    });

    await t.test('sin cupos no rechaza una entrada aunque tenga cinco préstamos', async () => {
      const target = await book();
      const full = await user();
      const owner = await user();
      const occupying = await loan(owner.id, target.id);
      await fiveLoans(full.id);
      const waiting = await queue(full.id, target.id);
      assert.equal((await availability(target.id))[0]?.availableCopies, 0);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
      await db.loan.update({ where: { id: occupying.id }, data: { startedAt: at(-481), dueAt: at(-1) } });
      assert.equal((await availability(target.id))[0]?.availableCopies, 1);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'REJECTED_LIMIT');
      const processed = await db.loan.findUniqueOrThrow({ where: { id: occupying.id } });
      assert.ok(processed.closedAt);
      assert.ok(processed.closedAt >= processed.dueAt);
    });

    await t.test('una espera elegible anterior consume la prioridad del único cupo', async () => {
      const target = await book();
      const first = await user();
      const later = await user();
      await fiveLoans(later.id);
      const eligible = await queue(first.id, target.id);
      const waiting = await queue(later.id, target.id);
      assert.equal((await availability(target.id))[0]?.availableCopies, 0);
      for (const entry of [eligible, waiting]) {
        const after = await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } });
        assert.equal(after.state, 'WAITING');
        assert.equal(after.closedAt, null);
      }
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
    });

    await t.test('un fallo de la transacción revierte el rechazo', async () => {
      const target = await book();
      const full = await user();
      await fiveLoans(full.id);
      const waiting = await queue(full.id, target.id);
      const failing = {
        $transaction: ((operation, options) => db.$transaction(async tx => {
          await operation(tx);
          throw new Error('fallo-de-prueba-antes-del-commit');
        }, options)) as PrismaClient['$transaction'],
      };
      await assert.rejects(new CirculationRepository(failing).findOccupancy([target.id]), /fallo-de-prueba/);
      const after = await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } });
      assert.equal(after.state, 'WAITING');
      assert.equal(after.closedAt, null);
    });

    await t.test('un fallo después de procesar el vencimiento revierte el cierre para reintentar', async () => {
      const target = await book();
      const owner = await user();
      const expired = await db.loan.create({ data: { userId: owner.id, bookId: target.id,
        startedAt: at(-481), dueAt: at(-1) } });
      const failing = {
        $transaction: ((operation, options) => db.$transaction(async tx => {
          await operation(tx);
          throw new Error('fallo-de-prueba-tras-cerrar');
        }, options)) as PrismaClient['$transaction'],
      };
      await assert.rejects(new CirculationRepository(failing).findOccupancy([target.id]), /fallo-de-prueba/);
      assert.equal((await db.loan.findUniqueOrThrow({ where: { id: expired.id } })).closedAt, null);
      await availability(target.id);
      const retried = await db.loan.findUniqueOrThrow({ where: { id: expired.id } });
      assert.ok(retried.closedAt);
      assert.ok(retried.closedAt >= retried.dueAt);
    });
  } finally {
    await fixture.close();
  }
});
