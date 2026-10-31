import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { circulationTransaction } from '../src/circulation/circulation-transaction.js';
import { reconcileBooks, releaseReservation, type ReservationReleaseReason } from '../src/circulation/reconcile-books.js';

/** Prueba únicamente el contrato compartido; no requiere repositorios ni procesos de otras historias. */
export async function reconciliationScenarios(t: TestContext, db: PrismaClient) {
  const hour = 3_600_000;
  const university = await db.university.create({ data: { name: 'Universidad de contrato' } });
  let sequence = 0;
  const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Contrato',
    email: `contrato-${++sequence}@example.invalid`, universityId: university.id, passwordHash: 'fixture' } });
  const book = (totalCopies = 1) => db.book.create({ data: { title: 'Libro de contrato', titleSearch: 'libro de contrato',
    pdfObjectKey: 'fixture/no-existe.pdf', totalCopies } });
  const queue = async (bookId: string) => db.queueEntry.create({ data: { userId: (await user()).id, bookId,
    joinedAt: new Date(Date.now() - hour) } });
  const reconcile = (ids: readonly string[]) => circulationTransaction(db, tx => reconcileBooks(tx, ids));
  const reservation = (queueEntryId: string) => db.reservation.findUniqueOrThrow({ where: { queueEntryId } });
  const state = async (id: string) => (await db.queueEntry.findUniqueOrThrow({ where: { id } })).state;
  const fiveLoans = async (userId: string) => {
    for (let i = 0; i < 5; i++) {
      const target = await book();
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        SELECT gen_random_uuid(), ${userId}::uuid, ${target.id}::uuid, t, t + interval '480 hours'
        FROM (SELECT statement_timestamp() - interval '1 hour' AS t) clock`;
    }
  };

  await t.test('normaliza IDs, devuelve ocupación posterior y ofrece en FIFO sin duplicar', async () => {
    const target = await book(2);
    const entries = [await queue(target.id), await queue(target.id), await queue(target.id)];
    const result = await reconcile([target.id, target.id]);
    assert.equal(result.occupancy.length, 1);
    assert.deepEqual(result.occupancy[0], { bookId: target.id, totalCopies: 2, activeLoans: 0, heldReservations: 2, eligibleWaiters: 0 });
    assert.deepEqual(await Promise.all(entries.map(e => state(e.id))), ['OFFERED', 'OFFERED', 'WAITING']);
    for (const entry of entries.slice(0, 2)) {
      const held = await reservation(entry.id);
      assert.equal(held.state, 'HELD');
      assert.deepEqual(held.offeredAt, result.now);
      assert.equal(held.expiresAt.getTime() - held.offeredAt.getTime(), 24 * hour);
      const event = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `reservation:${held.id}:turn` } });
      assert.equal(event.userId, entry.userId); assert.equal(event.state, 'PENDING');
      assert.deepEqual(event.payload, { bookTitle: target.title, expiresAt: held.expiresAt.toISOString() });
    }
    const before = await db.reservation.findMany({ where: { bookId: target.id }, orderBy: { id: 'asc' } });
    await reconcile([target.id]);
    assert.deepEqual(await db.reservation.findMany({ where: { bookId: target.id }, orderBy: { id: 'asc' } }), before);
    assert.equal(await db.notificationOutbox.count({ where: { reservationId: { in: before.map(r => r.id) } } }), 2);
    assert.equal(await db.loan.count({ where: { bookId: target.id } }), 0);
  });

  await t.test('SCRUM-27: cerrar préstamo vencido y ofrecer a la cola se confirman juntos', async () => {
    const target = await book(); const first = await queue(target.id); const owner = await user();
    await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
      SELECT gen_random_uuid(), ${owner.id}::uuid, ${target.id}::uuid, t, t + interval '480 hours'
      FROM (SELECT statement_timestamp() - interval '481 hours' AS t) clock`;
    const result = await reconcile([target.id]);
    const expired = await db.loan.findFirstOrThrow({ where: { bookId: target.id } });
    assert.deepEqual(expired.closedAt, result.now);
    assert.equal(await state(first.id), 'OFFERED');
    assert.equal(result.occupancy[0]?.activeLoans, 0); assert.equal(result.occupancy[0]?.heldReservations, 1);
    assert.deepEqual((await reservation(first.id)).offeredAt, result.now);
  });

  await t.test('rechazo al llegar el turno: aviso y avance inmediato sin rechazar a quienes siguen sin cupo', async () => {
    const target = await book(); const first = await queue(target.id); const next = await queue(target.id); const last = await queue(target.id);
    await fiveLoans(first.userId); await fiveLoans(last.userId);
    await reconcile([target.id]);
    assert.deepEqual(await Promise.all([first, next, last].map(e => state(e.id))), ['REJECTED_LIMIT', 'OFFERED', 'WAITING']);
    assert.ok((await db.queueEntry.findUniqueOrThrow({ where: { id: first.id } })).closedAt);
    assert.equal(await db.notificationOutbox.count({ where: { dedupKey: `queue:${first.id}:limit` } }), 1);
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: last.id } }), 0);
  });

  await t.test('sin cupos no rechaza; si todos los sucesores son inelegibles deja el cupo libre', async () => {
    const target = await book(0); const first = await queue(target.id); const next = await queue(target.id);
    await fiveLoans(first.userId); await fiveLoans(next.userId);
    await reconcile([target.id]);
    assert.deepEqual(await Promise.all([first, next].map(e => state(e.id))), ['WAITING', 'WAITING']);
    await db.book.update({ where: { id: target.id }, data: { totalCopies: 1 } });
    const result = await reconcile([target.id]);
    assert.deepEqual(await Promise.all([first, next].map(e => state(e.id))), ['REJECTED_LIMIT', 'REJECTED_LIMIT']);
    assert.equal(result.occupancy[0]?.heldReservations, 0);
    assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: { in: [first.id, next.id] } } }), 2);
  });

  for (const reason of ['CANCELLED', 'REJECTED_LIMIT', 'EXPIRED'] as const) {
    await t.test(`liberar por ${reason} cierra ambas entidades y reasigna una sola vez`, async () => {
      const target = await book(); const first = await queue(target.id); const next = await queue(target.id);
      await reconcile([target.id]); const held = await reservation(first.id);
      if (reason === 'EXPIRED') await db.$executeRaw`UPDATE reservations
        SET offered_at = statement_timestamp() - interval '25 hours', expires_at = statement_timestamp() - interval '1 hour'
        WHERE id = ${held.id}::uuid`;
      const releaseReason: ReservationReleaseReason = reason === 'EXPIRED' ? 'CANCELLED' : reason;
      await circulationTransaction(db, tx => releaseReservation(tx, held.id, releaseReason));
      const terminal = await reservation(first.id);
      assert.equal(terminal.state, reason); assert.ok(terminal.closedAt); assert.equal(await state(first.id), reason);
      assert.equal(await state(next.id), 'OFFERED');
      await circulationTransaction(db, tx => releaseReservation(tx, held.id, 'CANCELLED'));
      assert.deepEqual(await reservation(first.id), terminal);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: first.id } }), 0);
    });
  }

  await t.test('recupera rechazos históricos sin reabrirlos y conserva avisos SENT', async () => {
    const target = await book(0); const entry = await queue(target.id);
    const closedAt = new Date();
    await db.queueEntry.update({ where: { id: entry.id }, data: { state: 'REJECTED_LIMIT', closedAt } });
    await reconcile([target.id]);
    const event = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `queue:${entry.id}:limit` } });
    await db.notificationOutbox.update({ where: { id: event.id }, data: { state: 'SENT', sentAt: closedAt } });
    await reconcile([target.id]);
    assert.equal(await state(entry.id), 'REJECTED_LIMIT');
    assert.deepEqual((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).closedAt, closedAt);
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: event.id } })).state, 'SENT');
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: entry.id } }), 1);
  });

  await t.test('fallo de outbox revierte también el cierre del préstamo y la oferta', async () => {
    const target = await book(); const first = await queue(target.id); const owner = await user();
    await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
      SELECT gen_random_uuid(), ${owner.id}::uuid, ${target.id}::uuid, t, t + interval '480 hours'
      FROM (SELECT statement_timestamp() - interval '481 hours' AS t) clock`;
    const failing = { $transaction: ((work, options) => db.$transaction(tx => work(new Proxy(tx, {
      get(object, key) {
        if (key !== 'notificationOutbox') return Reflect.get(object, key);
        return new Proxy(object.notificationOutbox, { get(outbox, method) {
          if (method === 'create') return () => { throw new Error('OUTBOX_CONTRACT_FAILURE'); };
          return Reflect.get(outbox, method);
        } });
      },
    })), options)) as PrismaClient['$transaction'] };
    await assert.rejects(circulationTransaction(failing, tx => reconcileBooks(tx, [target.id])), /OUTBOX_CONTRACT_FAILURE/);
    assert.equal((await db.loan.findFirstOrThrow({ where: { bookId: target.id } })).closedAt, null);
    assert.equal(await state(first.id), 'WAITING');
    assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
  });
}
