import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { ReservationRepository } from '../src/circulation/reservation-repository.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { LoanRepository } from '../src/circulation/loan-repository.js';

export async function reservationScenarios(t: TestContext, db: PrismaClient) {
  const university = await db.university.create({ data: { name: 'Aceptaciones' } });
  let sequence = 0;
  const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba',
    email: `aceptar-${++sequence}@example.invalid`, universityId: university.id, passwordHash: 'fixture' } });
  const book = () => db.book.create({ data: { title: 'Libro universitario', titleSearch: 'libro universitario',
    pdfObjectKey: 'fixture.pdf', totalCopies: 1 } });
  const repo = new ReservationRepository(db);
  const offer = async () => {
    const owner = await user(); const target = await book();
    const entry = await db.queueEntry.create({ data: { userId: owner.id, bookId: target.id } });
    await new CirculationRepository(db).findOccupancy([target.id]);
    const reservation = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: entry.id } });
    return { owner, target, entry, reservation };
  };
  const fiveLoans = async (userId: string) => {
    for (let i = 0; i < 5; i++) assert.ok('loan' in await new LoanRepository(db).requestLoan(userId, (await book()).id));
  };

  await t.test('consume reserva, cumple espera y crea un préstamo de 480 horas con tres avisos atómicos', async () => {
    const { owner, target, entry, reservation } = await offer();
    const first = await repo.acceptReservation(owner.id, reservation.id);
    assert.ok('loan' in first); if (!('loan' in first)) return;
    assert.equal(first.created, true); assert.equal(first.active, true);
    assert.equal(first.loan.dueAt.getTime() - first.loan.startedAt.getTime(), 480 * 3_600_000);
    assert.ok(first.loan.startedAt >= reservation.offeredAt);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).state, 'CONSUMED');
    assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).state, 'FULFILLED');
    const saved = await db.loan.findUniqueOrThrow({ where: { id: first.loan.id } });
    assert.equal(saved.reservationId, reservation.id); assert.equal(saved.userId, owner.id);
    assert.equal(await db.notificationOutbox.count({ where: { loanId: saved.id } }), 3);
    assert.equal((await new CirculationRepository(db).findOccupancy([target.id]))[0]?.heldReservations, 0);
    assert.deepEqual(await repo.acceptReservation(owner.id, reservation.id), { ...first, created: false });
    assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 1);
    // Un enlace consumido conserva su resultado aunque el préstamo termine.
    await db.$executeRaw`UPDATE loans SET started_at = statement_timestamp() - interval '481 hours',
      due_at = statement_timestamp() - interval '1 hour' WHERE id = ${saved.id}::uuid`;
    const ended = await repo.acceptReservation(owner.id, reservation.id);
    assert.ok('loan' in ended && ended.loan.id === saved.id && !ended.active && !ended.created);
    assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 1);
  });

  await t.test('titularidad antes de cualquier cambio: ajena y ausente tienen el mismo resultado', async () => {
    const { reservation } = await offer(); const stranger = await user();
    const before = await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    assert.deepEqual(await repo.acceptReservation(stranger.id, reservation.id), { code: 'RESERVATION_NOT_FOUND' });
    assert.deepEqual(await repo.acceptReservation(stranger.id, '00000000-0000-4000-8000-000000000000'), { code: 'RESERVATION_NOT_FOUND' });
    assert.deepEqual(await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } }), before);
    assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 0);
  });

  for (const successor of [false, true]) {
    await t.test(`cinco préstamos: persiste rechazo y ${successor ? 'ofrece al siguiente elegible' : 'libera el cupo'}`, async () => {
      const { owner, target, entry, reservation } = await offer();
      await fiveLoans(owner.id);
      const blocked = await user(); await fiveLoans(blocked.id);
      const skipped = await db.queueEntry.create({ data: { userId: blocked.id, bookId: target.id } });
      const next = successor ? await db.queueEntry.create({ data: { userId: (await user()).id, bookId: target.id } }) : null;
      assert.deepEqual(await repo.acceptReservation(owner.id, reservation.id), { code: 'RESERVATION_REJECTED_LIMIT' });
      for (const closed of await Promise.all([
        db.reservation.findUniqueOrThrow({ where: { id: reservation.id } }),
        db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } }),
      ])) {
        assert.equal(closed.state, 'REJECTED_LIMIT'); assert.ok(closed.closedAt);
      }
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: skipped.id } })).state, 'REJECTED_LIMIT');
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: entry.id } }), 0, 'rechazar al aceptar no agrega un correo');
      assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 0);
      if (next) {
        const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: next.id } });
        assert.equal(held.state, 'HELD');
        assert.equal(await db.notificationOutbox.count({ where: { reservationId: held.id, kind: 'TURN_AVAILABLE' } }), 1);
      } else assert.equal((await new CirculationRepository(db).findOccupancy([target.id]))[0]?.heldReservations, 0);
      // Bajar del límite no reactiva un enlace rechazado.
      await db.$executeRaw`UPDATE loans SET started_at = statement_timestamp() - interval '481 hours',
        due_at = statement_timestamp() - interval '1 hour' WHERE user_id = ${owner.id}::uuid`;
      assert.deepEqual(await repo.acceptReservation(owner.id, reservation.id), { code: 'RESERVATION_REJECTED_LIMIT' });
    });
  }

  await t.test('vencida y cancelada devuelven resultado terminal; vencimiento reasigna', async () => {
    for (const state of ['EXPIRED', 'CANCELLED'] as const) {
      const { owner, target, entry, reservation } = await offer();
      const next = await db.queueEntry.create({ data: { userId: (await user()).id, bookId: target.id } });
      if (state === 'EXPIRED') await db.$executeRaw`UPDATE reservations SET offered_at = statement_timestamp() - interval '25 hours',
        expires_at = statement_timestamp() - interval '1 hour' WHERE id = ${reservation.id}::uuid`;
      else {
        const now = new Date();
        await db.reservation.update({ where: { id: reservation.id }, data: { state, closedAt: now } });
        await db.queueEntry.update({ where: { id: entry.id }, data: { state, closedAt: now } });
      }
      assert.deepEqual(await repo.acceptReservation(owner.id, reservation.id), { code: `RESERVATION_${state}` });
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: next.id } })).state, 'OFFERED');
      assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 0);
      assert.deepEqual(await repo.acceptReservation(owner.id, reservation.id), { code: `RESERVATION_${state}` });
    }
  });

  await t.test('un fallo al programar avisos revierte préstamo, consumo y cierre de espera', async () => {
    const { owner, entry, reservation } = await offer();
    const failing = { $transaction: ((work, options) => db.$transaction(tx => work(new Proxy(tx, {
      get(object, key) {
        if (key !== 'notificationOutbox') return Reflect.get(object, key);
        return new Proxy(object.notificationOutbox, { get(outbox, method) {
          if (method === 'createMany') return () => { throw new Error('OUTBOX_ACCEPT_TEST_FAILURE'); };
          return Reflect.get(outbox, method);
        } });
      },
    })), options)) as PrismaClient['$transaction'] };
    await assert.rejects(new ReservationRepository(failing).acceptReservation(owner.id, reservation.id), /OUTBOX_ACCEPT_TEST_FAILURE/);
    assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 0);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).state, 'HELD');
    assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).state, 'OFFERED');
  });

  await t.test('el plazo que vence durante la aceptación se rechaza en el límite exacto y reasigna', async () => {
    const { owner, target, reservation } = await offer();
    const next = await db.queueEntry.create({ data: { userId: (await user()).id, bookId: target.id } });
    let reads = 0;
    const atBoundary = { $transaction: ((work, options) => db.$transaction(tx => work(new Proxy(tx, {
      get(object, key) {
        if (key !== '$queryRaw') return Reflect.get(object, key);
        return (...args: unknown[]) => {
          const query = args[0];
          if (Array.isArray(query) && query.join('').includes('SELECT clock_timestamp()')) {
            reads++;
            return Promise.resolve([{ now: new Date(+reservation.expiresAt - (reads < 3 ? 1 : 0)) }]);
          }
          return Reflect.apply(object.$queryRaw, object, args);
        };
      },
    })), options)) as PrismaClient['$transaction'] };
    assert.deepEqual(await new ReservationRepository(atBoundary).acceptReservation(owner.id, reservation.id), { code: 'RESERVATION_EXPIRED' });
    assert.equal(await db.loan.count({ where: { reservationId: reservation.id } }), 0);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).state, 'EXPIRED');
    assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: next.id } })).state, 'OFFERED');
  });
}
