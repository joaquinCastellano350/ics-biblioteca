import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { circulationTransaction } from '../src/circulation/circulation-transaction.js';
import { releaseReservation } from '../src/circulation/reconcile-books.js';
import { CirculationWorker } from '../src/circulation/circulation-worker.js';
import { CirculationQueryRepository } from '../src/circulation/circulation-query-repository.js';
import { LoanRepository } from '../src/circulation/loan-repository.js';
import { NotificationWorker } from '../src/notifications/notification-worker.js';
import { NotificationRepository } from '../src/notifications/notification-repository.js';
import { EmailDeliveryError, type EmailMessage } from '../src/notifications/notification.js';

export async function turnsScenarios(t: TestContext, db: PrismaClient) {
  const university = await db.university.create({ data: { name: 'Universidad de turnos' } });
  let sequence = 0;
  const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba',
    email: `turno-${++sequence}@example.invalid`, universityId: university.id, passwordHash: 'fixture' } });
  const book = (totalCopies = 1) => db.book.create({ data: { title: 'Lecturas <seguras>', titleSearch: 'lecturas seguras',
    pdfObjectKey: 'fixture/no-existe.pdf', totalCopies } });
  const queue = async (bookId: string) => db.queueEntry.create({ data: { userId: (await user()).id, bookId } });
  const offer = (bookId: string) => new CirculationRepository(db).findOccupancy([bookId]);
  const release = (id: string, reason: 'CANCELLED' | 'REJECTED_LIMIT') => circulationTransaction(db, tx => releaseReservation(tx, id, reason));
  const expire = async (id: string) => {
    await db.$executeRaw`UPDATE reservations SET offered_at = statement_timestamp() - interval '25 hours',
      expires_at = statement_timestamp() - interval '1 hour' WHERE id = ${id}::uuid`;
  };
  const reservation = (id: string) => db.reservation.findUniqueOrThrow({ where: { queueEntryId: id } });
  const state = async (id: string) => (await db.queueEntry.findUniqueOrThrow({ where: { id } })).state;

  await t.test('FIFO, múltiples cupos, 24 horas completas, outbox y repetición', async () => {
    const target = await book(2);
    const entries = [await queue(target.id), await queue(target.id), await queue(target.id)];
    const [occupancy] = await offer(target.id);
    assert.equal(occupancy?.heldReservations, 2);
    assert.equal(occupancy?.eligibleWaiters, 0);
    for (const entry of entries.slice(0, 2)) {
      assert.equal(await state(entry.id), 'OFFERED');
      const held = await reservation(entry.id);
      assert.equal(held.state, 'HELD');
      assert.equal(held.expiresAt.getTime() - held.offeredAt.getTime(), 24 * 3_600_000);
      const notification = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `reservation:${held.id}:turn` } });
      assert.equal(notification.userId, entry.userId);
      assert.equal(notification.state, 'PENDING');
      assert.equal(notification.reservationId, held.id);
      assert.deepEqual(notification.payload, { bookTitle: target.title, expiresAt: held.expiresAt.toISOString() });
    }
    assert.equal(await state(entries[2]!.id), 'WAITING');
    await Promise.all([offer(target.id), offer(target.id)]);
    assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
  });

  await t.test('rechaza al llegar el turno, avisa y ofrece al siguiente sin rechazar anticipadamente', async () => {
    const target = await book();
    const entries = [await queue(target.id), await queue(target.id), await queue(target.id)];
    for (const entry of [entries[0]!, entries[2]!]) {
      for (let i = 0; i < 5; i++) await new LoanRepository(db).requestLoan(entry.userId, (await book()).id);
    }
    await offer(target.id);
    assert.deepEqual(await Promise.all(entries.map(e => state(e.id))), ['REJECTED_LIMIT', 'OFFERED', 'WAITING']);
    const rejected = await db.queueEntry.findUniqueOrThrow({ where: { id: entries[0]!.id } });
    assert.ok(rejected.closedAt);
    const notification = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `queue:${rejected.id}:limit` } });
    assert.equal(notification.state, 'PENDING');
    assert.equal(notification.userId, rejected.userId);
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: entries[2]!.id } }), 0);
    await offer(target.id);
    assert.deepEqual(await db.queueEntry.findUniqueOrThrow({ where: { id: rejected.id } }), rejected);
  });

  for (const reason of ['CANCELLED', 'REJECTED_LIMIT', 'EXPIRED'] as const) {
    await t.test(`${reason}: cierre conjunto y reasignación inmediata e idempotente`, async () => {
      const target = await book();
      const first = await queue(target.id);
      const next = await queue(target.id);
      await offer(target.id);
      const held = await reservation(first.id);
      if (reason === 'EXPIRED') { await expire(held.id); await offer(target.id); }
      else await release(held.id, reason);
      assert.equal((await reservation(first.id)).state, reason);
      assert.equal(await state(first.id), reason);
      assert.equal(await state(next.id), 'OFFERED');
      assert.ok((await reservation(first.id)).closedAt);
      await release(held.id, 'CANCELLED');
      assert.equal((await reservation(first.id)).state, reason);
      assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 2);
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: first.id } }), 0);
    });
  }

  await t.test('sin sucesor elegible el cupo queda libre; las reservas no suman préstamos', async () => {
    const target = await book(); const first = await queue(target.id);
    await offer(target.id);
    const held = await reservation(first.id);
    const released = await release(held.id, 'CANCELLED');
    assert.equal(released.occupancy[0]?.heldReservations, 0);
    assert.ok('loan' in await new LoanRepository(db).requestLoan(first.userId, (await book()).id));
  });

  await t.test('recupera rechazo histórico una vez y conserva SENT y el cierre original', async () => {
    const target = await book(0); const entry = await queue(target.id);
    const closedAt = new Date();
    await db.queueEntry.update({ where: { id: entry.id }, data: { state: 'REJECTED_LIMIT', closedAt } });
    await Promise.all([offer(target.id), offer(target.id)]);
    const event = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `queue:${entry.id}:limit` } });
    await db.notificationOutbox.update({ where: { id: event.id }, data: { state: 'SENT', sentAt: new Date() } });
    await offer(target.id);
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: event.id } })).state, 'SENT');
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: entry.id } }), 1);
    assert.deepEqual((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).closedAt, closedAt);
  });

  await t.test('fallo del outbox revierte reserva, oferta y rechazo', async () => {
    const target = await book(); const first = await queue(target.id); const next = await queue(target.id);
    for (let i = 0; i < 5; i++) await new LoanRepository(db).requestLoan(first.userId, (await book()).id);
    // El fallo ocurre en la escritura del aviso de turno, después del rechazo y su aviso.
    const failing = { $transaction: (<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: Parameters<PrismaClient['$transaction']>[1]) => db.$transaction(tx => work(new Proxy(tx, {
      get(object, key) {
        if (key !== 'notificationOutbox') return Reflect.get(object, key);
        return new Proxy(object.notificationOutbox, { get(outbox, method) {
          if (method !== 'create') return Reflect.get(outbox, method);
          return (args: { data: { kind: string } }) => {
            if (args.data.kind === 'TURN_AVAILABLE') throw new Error('OUTBOX_TEST_FAILURE');
            return outbox.create(args as Parameters<typeof outbox.create>[0]);
          };
        } });
      },
    })), options)) as PrismaClient['$transaction'] };
    await assert.rejects(new CirculationRepository(failing).findOccupancy([target.id]), /OUTBOX_TEST_FAILURE/);
    assert.equal(await state(first.id), 'WAITING'); assert.equal(await state(next.id), 'WAITING');
    assert.equal(await db.reservation.count({ where: { bookId: target.id } }), 0);
    assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: first.id } }), 0);
  });

  await t.test('consulta propia concilia sin exponer otras identidades; préstamo directo respeta la oferta', async () => {
    const target = await book(); const first = await queue(target.id); const other = await user();
    const personal = await new CirculationQueryRepository(db).findPersonalCirculation(first.userId);
    assert.equal(personal.waits.length, 0); assert.equal(personal.reservations[0]?.book.id, target.id);
    assert.equal(JSON.stringify(personal).includes(first.userId), false);
    assert.deepEqual(await new LoanRepository(db).requestLoan(other.id, target.id), { code: 'NO_AVAILABLE_COPIES' });
    assert.equal((await new CirculationQueryRepository(db).findPersonalCirculation(other.id)).reservations.length, 0);
  });

  await t.test('proceso externo cierra vencimientos y ofrece turnos sin peticiones web', async () => {
    const target = await book(); const first = await queue(target.id); const owner = await user();
    await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
      VALUES (gen_random_uuid(), ${owner.id}::uuid, ${target.id}::uuid,
        statement_timestamp() - interval '481 hours', statement_timestamp() - interval '1 hour')`;
    await new CirculationWorker(db).runBatch(500);
    assert.equal(await state(first.id), 'OFFERED');
    assert.ok((await db.loan.findFirstOrThrow({ where: { bookId: target.id } })).closedAt);
  });

  await t.test('entrega real del productor: fallo conserva PENDING, reintento usa la clave y turno vencido se cancela', async () => {
    // Aísla solo el correo de este escenario; nunca llama al proveedor externo.
    await db.notificationOutbox.deleteMany();
    const target = await book(); const first = await queue(target.id); await offer(target.id);
    const held = await reservation(first.id);
    const messages: EmailMessage[] = [];
    const worker = new NotificationWorker(new NotificationRepository(db), { async send(message) {
      messages.push(message);
      if (messages.length === 1) throw new EmailDeliveryError('SIMULATED_FAILURE', false);
      return 'provider-test-id';
    } }, 'https://biblioteca.example.org');
    await worker.runBatch();
    const event = await db.notificationOutbox.findFirstOrThrow({ where: { reservationId: held.id } });
    assert.equal(event.state, 'PENDING'); assert.equal(event.attemptCount, 1);
    await db.notificationOutbox.update({ where: { id: event.id }, data: { nextAttemptAt: event.scheduledAt } });
    await worker.runBatch();
    assert.equal(messages.length, 2); assert.deepEqual(messages[0], messages[1]);
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: event.id } })).state, 'SENT');
    const staleTarget = await book(); const stale = await queue(staleTarget.id); await offer(staleTarget.id);
    const staleHeld = await reservation(stale.id); await expire(staleHeld.id);
    await worker.runBatch();
    assert.equal(messages.length, 2);
    assert.equal((await db.notificationOutbox.findFirstOrThrow({ where: { reservationId: staleHeld.id } })).state, 'CANCELLED');
  });
}
