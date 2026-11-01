import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CirculationController } from '../src/circulation/circulation-controller.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { reconcileBooks } from '../src/circulation/reconcile-books.js';
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
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AS now`;
    assert.ok(clock, 'PostgreSQL debe devolver una fila con el reloj de la transacción');
    const { now } = clock;
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
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

    await t.test('cierra vencidos y descuenta solo préstamos vigentes', async () => {
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

    await t.test('concilia reservas vencidas y solo cuenta HELD vigentes', async () => {
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
      const after = await db.reservation.findMany({ where: { bookId: target.id }, orderBy: { id: 'asc' } });
      assert.equal(after.filter(r => r.state === 'HELD').length, 1);
      for (const row of before.filter(r => r.state !== 'HELD')) assert.deepEqual(after.find(r => r.id === row.id), row);
      assert.equal(after.filter(reservation => reservation.state === 'EXPIRED').length, 2);
      assert.equal(await db.queueEntry.count({ where: { bookId: target.id, state: 'EXPIRED' } }), 1);
    });

    await t.test('la conciliación ofrece los cupos libres a la cola y persiste las reservas', async () => {
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
      assert.equal(await db.reservation.count({ where: { bookId: target.id, state: 'HELD' } }), 2);
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

test('la conciliación procesa antes, exactamente y después de dueAt de forma idempotente', async (t) => {
  const fixture = await catalogDatabase();
  t.after(() => fixture.close());
  const db = fixture.client;
  const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
  const user = await db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: 'limite-vencimiento@example.org',
    passwordHash: 'fixture', universityId: university.id } });
  const book = await db.book.create({ data: { title: 'Límite', titleSearch: 'limite', pdfObjectKey: 'privado.pdf', totalCopies: 1 } });
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const dueAt = new Date(clock!.now.getTime() + 60_000);
  const loan = await db.loan.create({ data: { userId: user.id, bookId: book.id,
    startedAt: new Date(dueAt.getTime() - 480 * 3_600_000), dueAt } });
  const at = (now: Date) => db.$transaction(tx => {
    const rawQuery = tx.$queryRaw.bind(tx);
    const withClock = new Proxy(tx, {
      get(target, property, receiver) {
        if (property === '$queryRaw') return ((query: TemplateStringsArray, ...values: unknown[]) => {
          if (Array.isArray(query) && query.join('').includes('clock_timestamp()')) return Promise.resolve([{ now }]);
          return rawQuery(query, ...values);
        }) as typeof tx.$queryRaw;
        return Reflect.get(target, property, receiver);
      },
    });
    return reconcileBooks(withClock, [book.id]);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const before = await at(new Date(dueAt.getTime() - 1));
  assert.equal(before.occupancy[0]?.activeLoans, 1);
  assert.equal((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).closedAt, null);

  const exact = await at(dueAt);
  assert.equal(exact.occupancy[0]?.activeLoans, 0);
  const closedAtBoundary = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.equal(closedAtBoundary.closedAt?.getTime(), dueAt.getTime());
  assert.equal(closedAtBoundary.dueAt.getTime(), dueAt.getTime());

  await at(new Date(dueAt.getTime() + 15 * 60_000));
  const replayed = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.deepEqual(replayed.closedAt, closedAtBoundary.closedAt);
  assert.equal(replayed.dueAt.getTime(), dueAt.getTime());
});

test('al vencer, reconcileBooks ofrece el cupo y deja persistida la reserva de turno', async (t) => {
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
  const [availability] = await new CirculationController(new CirculationRepository(db)).findAvailability([book.id]);
  assert.equal(availability?.availableCopies, 0);
  const closedLoan = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.ok(closedLoan.closedAt && closedLoan.closedAt >= closedLoan.dueAt);
  assert.equal(closedLoan.dueAt.getTime(), dueAt.getTime());
  assert.equal(await db.reservation.count({ where: { bookId: book.id, state: 'HELD' } }), 1);
  assert.equal(await db.queueEntry.count({ where: { bookId: book.id, state: 'OFFERED' } }), 1);
});
