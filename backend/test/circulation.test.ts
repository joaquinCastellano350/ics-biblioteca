import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CirculationController } from '../src/circulation/circulation-controller.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('una consulta vacía de disponibilidad no accede a PostgreSQL', async () => {
  const repository = new CirculationRepository({
    $transaction: () => { throw new Error('No se debe consultar sin libros'); },
  });
  assert.deepEqual(await new CirculationController(repository).findAvailability([]), []);
});

test('la base compartida calcula cupos solicitables con PostgreSQL real en memoria', async (t) => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  const repository = new CirculationRepository(db);
  const circulation = new CirculationController(repository);
  try {
    const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AS now`;
    const at = (hours: number) => new Date(now!.getTime() + hours * 3_600_000);
    const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
    let sequence = 0;
    const user = () => db.user.create({ data: {
      firstName: 'Estudiante', lastName: 'Prueba', email: `circulacion-${++sequence}@example.org`,
      passwordHash: 'fixture', universityId: university.id,
    } });
    const book = (totalCopies = 4) => db.book.create({ data: {
      title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'privado.pdf', totalCopies,
    } });

    await t.test('sin ocupación conserva total, admite cero y elimina IDs repetidos', async () => {
      const free = await book();
      const zero = await book(0);
      const result = await circulation.findAvailability([free.id, zero.id, free.id, randomUUID()]);
      assert.equal(result.length, 2);
      assert.deepEqual(result.find(({ bookId }) => bookId === free.id), {
        bookId: free.id, totalCopies: 4, availableCopies: 4,
      });
      assert.deepEqual(result.find(({ bookId }) => bookId === zero.id), {
        bookId: zero.id, totalCopies: 0, availableCopies: 0,
      });
      assert.deepEqual(await circulation.findAvailability([randomUUID()]), []);
    });

    await t.test('descuenta solo préstamos vigentes aunque los vencidos sigan sin cerrar', async () => {
      const target = await book();
      const borrowers = await Promise.all([user(), user(), user(), user()]);
      const [active, expired, closed, future] = borrowers;
      await db.loan.create({ data: { userId: active!.id, bookId: target.id, startedAt: at(-1), dueAt: at(479) } });
      const stale = await db.loan.create({ data: { userId: expired!.id, bookId: target.id, startedAt: at(-481), dueAt: at(-1) } });
      await db.loan.create({ data: { userId: closed!.id, bookId: target.id, startedAt: at(-482), dueAt: at(-2), closedAt: at(-1) } });
      await db.loan.create({ data: { userId: future!.id, bookId: target.id, startedAt: at(1), dueAt: at(481) } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 3 }]);
      assert.ok((await db.loan.findUniqueOrThrow({ where: { id: stale.id } })).closedAt);
    });

    await t.test('descuenta reservas HELD vigentes, no vencidas ni terminales', async () => {
      const target = await book();
      const states = ['HELD', 'HELD', 'CONSUMED', 'CANCELLED', 'REJECTED_LIMIT', 'EXPIRED'] as const;
      for (const [index, state] of states.entries()) {
        const person = await user();
        const entry = await db.queueEntry.create({ data: { userId: person.id, bookId: target.id, state: 'OFFERED' } });
        const expired = index === 1 || state === 'EXPIRED';
        await db.reservation.create({ data: {
          queueEntryId: entry.id, userId: person.id, bookId: target.id,
          offeredAt: at(expired ? -25 : -1), expiresAt: at(expired ? -1 : 23), state,
          ...(state === 'HELD' ? {} : { closedAt: at(0) }),
        } });
      }
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 3 }]);
      assert.equal(await db.reservation.count({ where: { bookId: target.id, state: 'EXPIRED' } }), 2);
    });

    await t.test('la cola elegible recibe reservas reales antes de informar disponibilidad', async () => {
      const target = await book(3);
      const waiting = await Promise.all([user(), user()]);
      for (const person of waiting) {
        await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      }
      const terminalPerson = await user();
      await db.queueEntry.create({ data: {
        userId: terminalPerson.id, bookId: target.id, joinedAt: at(-1), state: 'CANCELLED', closedAt: at(0),
      } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 3, availableCopies: 1 }]);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
      assert.equal(await db.queueEntry.count({ where: { bookId: target.id, state: 'OFFERED' } }), 2);
    });

    await t.test('una espera con cinco préstamos vigentes no retiene capacidad para un turno', async () => {
      const target = await book(2);
      const person = await user();
      for (let i = 0; i < 5; i++) {
        const borrowed = await book();
        await db.loan.create({ data: { userId: person.id, bookId: borrowed.id, startedAt: at(-1), dueAt: at(479) } });
      }
      await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 2, availableCopies: 2 }]);
    });

    await t.test('descuenta préstamo y oferta una vez, sin duplicar la reserva al recargar', async () => {
      const target = await book();
      const borrower = await user();
      await db.loan.create({ data: { userId: borrower.id, bookId: target.id, startedAt: at(-1), dueAt: at(479) } });
      const person = await user();
      const entry = await db.queueEntry.create({ data: { userId: person.id, bookId: target.id, state: 'OFFERED' } });
      await db.reservation.create({ data: {
        userId: person.id, bookId: target.id, queueEntryId: entry.id, offeredAt: at(-1), expiresAt: at(23),
      } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 2 }]);
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 2 }]);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 1);
    });

    await t.test('cada lectura refleja cambios y el conteo nunca es negativo', async () => {
      const target = await book(1);
      assert.equal((await circulation.findAvailability([target.id]))[0]?.availableCopies, 1);
      const person = await user();
      await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      assert.equal((await circulation.findAvailability([target.id]))[0]?.availableCopies, 0);
      const next = await user();
      await db.queueEntry.create({ data: { userId: next.id, bookId: target.id } });
      assert.equal((await circulation.findAvailability([target.id]))[0]?.availableCopies, 0);
    });
  } finally {
    await fixture.close();
  }
});
