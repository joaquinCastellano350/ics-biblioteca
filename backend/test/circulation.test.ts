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

test('la base compartida procesa vencimientos y calcula cupos con PostgreSQL real en memoria', async (t) => {
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
      const processed = await db.loan.findUniqueOrThrow({ where: { id: stale.id } });
      assert.ok(processed.closedAt);
      assert.ok(processed.closedAt >= processed.dueAt);
      assert.equal(processed.dueAt.getTime(), stale.dueAt.getTime());
      const [processedAt] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      assert.ok(processed.closedAt <= processedAt!.now);
      assert.ok(processedAt!.now.getTime() - processed.closedAt.getTime() < 10_000);
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
      const before = await db.reservation.findMany({ where: { bookId: target.id }, orderBy: { id: 'asc' } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 3 }]);
      assert.deepEqual(await db.reservation.findMany({ where: { bookId: target.id }, orderBy: { id: 'asc' } }), before);
    });

    await t.test('la cola elegible retiene solo los cupos que necesita y no crea reservas', async () => {
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
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
      assert.equal(await db.queueEntry.count({ where: { bookId: target.id, state: 'WAITING' } }), 2);
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

    await t.test('no descuenta dos veces una espera que ya tiene el libro prestado o reservado', async () => {
      const target = await book();
      const borrower = await user();
      await db.loan.create({ data: { userId: borrower.id, bookId: target.id, startedAt: at(-1), dueAt: at(479) } });
      await db.queueEntry.create({ data: { userId: borrower.id, bookId: target.id } });
      const person = await user();
      const entry = await db.queueEntry.create({ data: { userId: person.id, bookId: target.id } });
      await db.reservation.create({ data: {
        userId: person.id, bookId: target.id, queueEntryId: entry.id, offeredAt: at(-1), expiresAt: at(23),
      } });
      assert.deepEqual(await circulation.findAvailability([target.id]), [{ bookId: target.id, totalCopies: 4, availableCopies: 2 }]);
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

test('procesa vencimientos en el límite exacto y conserva dueAt e idempotencia', async (t) => {
  const fixture = await catalogDatabase();
  t.after(() => fixture.close());
  const db = fixture.client;
  const repository = new CirculationRepository(db);
  const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
  const user = await db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: 'limite-vencimiento@example.org',
    passwordHash: 'fixture', universityId: university.id } });
  const book = await db.book.create({ data: { title: 'Límite', titleSearch: 'limite', pdfObjectKey: 'privado.pdf', totalCopies: 1 } });
  const dueAt = new Date('2026-10-31T12:00:00.000Z');
  const loan = await db.loan.create({ data: { userId: user.id, bookId: book.id,
    startedAt: new Date(dueAt.getTime() - 480 * 3_600_000), dueAt } });
  const at = (now: Date) => db.$transaction(tx => repository.findOccupancyInTransaction(tx, [book.id], now));

  const before = await at(new Date(dueAt.getTime() - 1));
  assert.equal(before[0]?.activeLoans, 1);
  assert.equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).closedAt, null);

  const exact = await at(dueAt);
  assert.equal(exact[0]?.activeLoans, 0);
  assert.equal(exact[0]?.eligibleWaiters, 0);
  const closedAtBoundary = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.equal(closedAtBoundary.closedAt?.getTime(), dueAt.getTime());
  assert.equal(closedAtBoundary.dueAt.getTime(), dueAt.getTime());

  await at(new Date(dueAt.getTime() + 15 * 60_000));
  const replayed = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.deepEqual(replayed.closedAt, closedAtBoundary.closedAt);
  assert.equal(replayed.dueAt.getTime(), dueAt.getTime());
});

test('el punto HU-06 recibe el cupo liberado dentro de la transacción, sin crear una oferta en HU-08', async (t) => {
  const fixture = await catalogDatabase();
  t.after(() => fixture.close());
  const db = fixture.client;
  const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
  const user = await db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: 'integracion-vencimiento@example.org',
    passwordHash: 'fixture', universityId: university.id } });
  const book = await db.book.create({ data: { title: 'Integración', titleSearch: 'integracion', pdfObjectKey: 'privado.pdf', totalCopies: 1 } });
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const dueAt = new Date(clock!.now.getTime() - 1_000);
  const loan = await db.loan.create({ data: { userId: user.id, bookId: book.id,
    startedAt: new Date(dueAt.getTime() - 480 * 3_600_000), dueAt } });
  await db.queueEntry.create({ data: { userId: (await db.user.create({ data: { firstName: 'Bea', lastName: 'Prueba', email: 'en-espera-vencimiento@example.org',
    passwordHash: 'fixture', universityId: university.id } })).id, bookId: book.id } });
  const calls: { bookId: string; processedAt: Date }[] = [];
  const repository = new CirculationRepository(db, { handle: async (tx, bookId, processedAt) => {
    assert.ok(tx);
    calls.push({ bookId, processedAt });
  } });

  const [occupancy] = await repository.findOccupancy([book.id]);
  assert.equal(occupancy?.eligibleWaiters, 1);
  assert.equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).closedAt?.getTime(), calls[0]?.processedAt.getTime());
  assert.deepEqual(calls.map(call => call.bookId), [book.id]);
  assert.equal(await db.reservation.count({ where: { bookId: book.id } }), 0);
  assert.equal(await db.queueEntry.count({ where: { bookId: book.id, state: 'WAITING' } }), 1);
  await repository.findOccupancy([book.id]);
  assert.equal(calls.length, 1, 'el cupo vencido no vuelve a notificarse al punto de integración');
});
