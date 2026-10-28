import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import { CirculationController } from '../src/circulation/circulation-controller.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { CirculationReconciler } from '../src/circulation/circulation-reconciler.js';
import { NotificationOutboxRepository } from '../src/notifications/notification-outbox-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('conciliación compartida: rechazos terminales, turnos y avisos atómicos', async (t) => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  try {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const at = (hours: number) => new Date(clock!.now.getTime() + hours * 3_600_000);
    const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
    let sequence = 0;
    const user = () => db.user.create({ data: {
      firstName: 'Prueba', lastName: 'Cola', email: `cola-${++sequence}@example.org`,
      passwordHash: 'fixture', universityId: university.id,
    } });
    const book = (totalCopies = 1) => db.book.create({ data: {
      title: 'Libro de prueba', titleSearch: 'libro de prueba', totalCopies, pdfObjectKey: 'privado.pdf',
    } });
    const loan = (userId: string, bookId: string) => db.loan.create({ data: {
      userId, bookId, startedAt: at(-1), dueAt: at(479),
    } });
    const fiveLoans = async (userId: string) => {
      const loans = [];
      for (let i = 0; i < 5; i++) loans.push(await loan(userId, (await book()).id));
      return loans;
    };
    const queue = (userId: string, bookId: string) => db.queueEntry.create({ data: {
      userId, bookId, joinedAt: at(-2),
    } });
    const availability = (bookId: string, reconciler?: CirculationReconciler) =>
      new CirculationController(new CirculationRepository(db, reconciler)).findAvailability([bookId]);

    await t.test('el rechazo por cinco persiste después de bajar a cuatro préstamos', async () => {
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
      const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: second.id } });
      assert.equal(held.userId, next.id);
      assert.equal(held.expiresAt.getTime() - held.offeredAt.getTime(), 24 * 3_600_000);
      // Simula el paso del tiempo sin esperar: un préstamo de Ana y la oferta
      // del siguiente ya vencieron. No se altera el rechazo terminal de Ana.
      await db.loan.update({ where: { id: loans[0]!.id }, data: { startedAt: at(-481), dueAt: at(-1) } });
      await db.queueEntry.update({ where: { id: second.id }, data: { joinedAt: at(-26) } });
      await db.reservation.update({ where: { id: held.id }, data: { offeredAt: at(-25), expiresAt: at(-1) } });
      assert.equal((await availability(target.id))[0]?.availableCopies, 1);
      const after = await db.queueEntry.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(after.state, 'REJECTED_LIMIT');
      assert.deepEqual(after.closedAt, rejected.closedAt);
      assert.equal(await db.reservation.count({ where: { queueEntryId: first.id } }), 0);
      const notices = await db.notificationOutbox.findMany({ where: { userId: ana.id } });
      assert.equal(notices.length, 1);
      assert.equal(notices[0]?.kind, 'QUEUE_LIMIT_REJECTED');
      assert.equal(notices[0]?.queueEntryId, first.id);
      assert.equal(notices[0]?.recipientEmail, ana.email);
      assert.equal(notices[0]?.state, 'PENDING');
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `reservation:${held.id}:turn` } })).state, 'CANCELLED');
    });

    await t.test('no rechaza antes de que haya un cupo para atender el turno', async () => {
      const target = await book();
      const owner = await user();
      const full = await user();
      const occupying = await loan(owner.id, target.id);
      await fiveLoans(full.id);
      const waiting = await queue(full.id, target.id);
      assert.equal((await availability(target.id))[0]?.availableCopies, 0);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: waiting.id } }), 0);
      await db.loan.update({ where: { id: occupying.id }, data: { startedAt: at(-481), dueAt: at(-1) } });
      assert.equal((await availability(target.id))[0]?.availableCopies, 1);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'REJECTED_LIMIT');
      assert.ok((await db.loan.findUniqueOrThrow({ where: { id: occupying.id } })).closedAt);
    });

    await t.test('respeta FIFO y no evalúa a los siguientes después de agotar cupos', async () => {
      const target = await book();
      const first = await user();
      const later = await user();
      await fiveLoans(later.id);
      const eligible = await queue(first.id, target.id);
      const waiting = await queue(later.id, target.id);
      await availability(target.id);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: eligible.id } })).state, 'OFFERED');
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: waiting.id } }), 0);
    });

    await t.test('un cupo tiene una sola reserva y un aviso aunque se recargue varias veces', async () => {
      const target = await book();
      const person = await user();
      const waiting = await queue(person.id, target.id);
      for (let i = 0; i < 3; i++) assert.equal((await availability(target.id))[0]?.availableCopies, 0);
      const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: waiting.id } });
      const notices = await db.notificationOutbox.findMany({ where: { reservationId: held.id } });
      assert.equal(notices.length, 1);
      assert.equal(notices[0]?.kind, 'TURN_AVAILABLE');
      assert.equal(notices[0]?.recipientEmail, person.email);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 1);
    });

    await t.test('fallar el aviso de rechazo revierte rechazo y cierres de vencimientos', async () => {
      const target = await book();
      const full = await user();
      const owner = await user();
      await fiveLoans(full.id);
      const stale = await db.loan.create({ data: { userId: owner.id, bookId: target.id, startedAt: at(-481), dueAt: at(-1) } });
      const waiting = await queue(full.id, target.id);
      const failing = new CirculationReconciler({ enqueue: async () => { throw new Error('outbox-unavailable'); } });
      await assert.rejects(availability(target.id, failing), /outbox-unavailable/);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
      assert.equal((await db.loan.findUniqueOrThrow({ where: { id: stale.id } })).closedAt, null);
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: waiting.id } }), 0);
    });

    await t.test('fallar el aviso de turno revierte la reserva y el cambio a OFFERED', async () => {
      const target = await book();
      const person = await user();
      const waiting = await queue(person.id, target.id);
      const failing = new CirculationReconciler({ enqueue: async () => { throw new Error('outbox-unavailable'); } });
      await assert.rejects(availability(target.id, failing), /outbox-unavailable/);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
    });

    await t.test('un conflicto de serialización reintenta sin duplicar efectos confirmados', async () => {
      const target = await book();
      const person = await user();
      const waiting = await queue(person.id, target.id);
      const recorder = new NotificationOutboxRepository();
      let attempts = 0;
      const conflictOnce = new CirculationReconciler({ enqueue: async (tx, notice) => {
        await recorder.enqueue(tx, notice);
        if (++attempts === 1) throw new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
      } });
      assert.equal((await availability(target.id, conflictOnce))[0]?.availableCopies, 0);
      assert.equal(attempts, 2);
      assert.equal(await db.reservation.count({ where: { queueEntryId: waiting.id } }), 1);
      const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: waiting.id } });
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: held.id } }), 1);
    });

    await t.test('al agotar reintentos falla sin confirmar reservas ni avisos', async () => {
      const target = await book();
      const person = await user();
      const waiting = await queue(person.id, target.id);
      const recorder = new NotificationOutboxRepository();
      let attempts = 0;
      const conflictAlways = new CirculationReconciler({ enqueue: async (tx, notice) => {
        await recorder.enqueue(tx, notice); attempts++;
        throw new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
      } });
      await assert.rejects(availability(target.id, conflictAlways), { code: 'P2034' });
      assert.equal(attempts, 3);
      assert.equal(await db.reservation.count({ where: { queueEntryId: waiting.id } }), 0);
      assert.equal(await db.notificationOutbox.count({ where: { userId: person.id } }), 0);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'WAITING');
    });

    await t.test('el outbox valida tipo, origen único, intentos y estados de entrega', async () => {
      const notice = await db.notificationOutbox.findFirstOrThrow({ where: { kind: 'TURN_AVAILABLE', state: 'PENDING' } });
      for (const [sql, constraint] of [
        ["UPDATE notification_outbox SET kind='UNKNOWN' WHERE id=$1", 'notification_outbox_kind_origin_check'],
        ['UPDATE notification_outbox SET attempt_count=-1 WHERE id=$1', 'notification_outbox_attempt_count_check'],
        ["UPDATE notification_outbox SET state='PROCESSING' WHERE id=$1", 'notification_outbox_claim_check'],
        ["UPDATE notification_outbox SET state='SENT' WHERE id=$1", 'notification_outbox_sent_check'],
        ['UPDATE notification_outbox SET reservation_id=NULL WHERE id=$1', 'notification_outbox_kind_origin_check'],
      ]) await assert.rejects(fixture.postgres.query(sql!, [notice.id]), { code: '23514', constraint });
      await assert.rejects(fixture.postgres.query('DELETE FROM reservations WHERE id=$1', [notice.reservationId]), { code: '23503' });
    });
  } finally {
    await fixture.close();
  }
});
