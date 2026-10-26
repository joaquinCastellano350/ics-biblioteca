import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { catalogDatabase } from './catalog-database.js';

test('migración de circulación conserva integridad y permite calcular disponibilidad por fecha', async (t) => {
  const database = await catalogDatabase();
  const db = database.client;
  // Los rechazos se prueban directamente en PostgreSQL: el puente Socket de
  // PGlite cierra su conexión tras ciertos errores de restricciones.
  const rejectsSql = (sql: string, values: unknown[], code: string, constraint: string) =>
    assert.rejects(database.postgres.query(sql, values), { code, constraint });
  const start = new Date('2026-10-26T12:00:00Z');
  const hours = (count: number) => new Date(start.getTime() + count * 3_600_000);
  try {
    const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
    const userData = (email: string) => ({
      firstName: 'Estudiante', lastName: 'Prueba', email, passwordHash: 'solo-prueba', universityId: university.id,
    });
    const user = await db.user.create({ data: userData('uno@example.org') });
    const otherUser = await db.user.create({ data: userData('dos@example.org') });
    const bookData = (title: string) => ({ title, titleSearch: title, pdfObjectKey: 'fixture.pdf', totalCopies: 3 });
    const book = await db.book.create({ data: bookData('Libro de prueba') });
    const otherBook = await db.book.create({ data: bookData('Otro libro') });

    await t.test('secuencia de espera generada y solo una entrada abierta por estudiante y libro', async () => {
      const first = await db.queueEntry.create({ data: { userId: user.id, bookId: book.id, joinedAt: start } });
      assert.equal(first.state, 'WAITING');
      assert.equal(typeof first.orderSeq, 'bigint');
      const duplicate = () => rejectsSql('INSERT INTO queue_entries (id,user_id,book_id) VALUES ($1,$2,$3)',
        [randomUUID(), user.id, book.id], '23505', 'queue_entries_user_book_open_key');
      await duplicate();
      await db.queueEntry.update({ where: { id: first.id }, data: { state: 'OFFERED' } });
      await duplicate();
      await db.queueEntry.update({ where: { id: first.id }, data: { state: 'CANCELLED', closedAt: start } });
      const next = await db.queueEntry.create({ data: { userId: user.id, bookId: book.id, joinedAt: start } });
      assert.ok(next.orderSeq > first.orderSeq);
      assert.equal(await db.queueEntry.count({ where: { userId: user.id, bookId: book.id } }), 2);
    });

    await t.test('estados y fechas de cierre de la cola se validan en PostgreSQL', async () => {
      const entry = await db.queueEntry.findFirstOrThrow({ where: { state: 'WAITING' } });
      await rejectsSql("UPDATE queue_entries SET state='UNKNOWN' WHERE id=$1", [entry.id], '23514', 'queue_entries_closed_at_check');
      await rejectsSql("UPDATE queue_entries SET state='CANCELLED' WHERE id=$1", [entry.id], '23514', 'queue_entries_closed_at_check');
      await rejectsSql('UPDATE queue_entries SET closed_at=$2 WHERE id=$1', [entry.id, start], '23514', 'queue_entries_closed_at_check');
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).state, 'WAITING');
    });

    await t.test('reserva de 24 horas, mismo titular y libro que su entrada, una oferta por entrada', async () => {
      const entry = await db.queueEntry.findFirstOrThrow({ where: { state: 'WAITING' } });
      const data = { queueEntryId: entry.id, userId: user.id, bookId: book.id, offeredAt: start, expiresAt: hours(24) };
      const invalid = (userId: string, bookId: string, expiresAt: Date, code: string, constraint: string) =>
        rejectsSql('INSERT INTO reservations (id,queue_entry_id,user_id,book_id,offered_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), entry.id, userId, bookId, start, expiresAt], code, constraint);
      await invalid(user.id, book.id, hours(23), '23514', 'reservations_duration_check');
      await invalid(otherUser.id, book.id, hours(24), '23503', 'reservations_queue_entry_id_user_id_book_id_fkey');
      await invalid(user.id, otherBook.id, hours(24), '23503', 'reservations_queue_entry_id_user_id_book_id_fkey');
      const reservation = await db.reservation.create({ data });
      await db.queueEntry.update({ where: { id: entry.id }, data: { state: 'OFFERED' } });
      await invalid(user.id, book.id, hours(24), '23505', 'reservations_queue_entry_id_key');
      assert.equal(reservation.state, 'HELD');
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { reservation: true } })).reservation?.id, reservation.id);
      await rejectsSql("UPDATE reservations SET state='CONSUMED' WHERE id=$1", [reservation.id], '23514', 'reservations_closed_at_check');
      await rejectsSql("UPDATE reservations SET state='EXPIRED',closed_at=$2 WHERE id=$1", [reservation.id, hours(23)], '23514', 'reservations_expired_at_check');
    });

    await t.test('préstamo de 480 horas, cierre desde vencimiento y un préstamo abierto por par', async () => {
      const data = { userId: user.id, bookId: otherBook.id, startedAt: start, dueAt: hours(480) };
      const invalid = (dueAt: Date, code: string, constraint: string) => rejectsSql(
        'INSERT INTO loans (id,user_id,book_id,started_at,due_at) VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), user.id, otherBook.id, start, dueAt], code, constraint);
      await invalid(hours(479), '23514', 'loans_duration_check');
      const first = await db.loan.create({ data });
      await invalid(hours(480), '23505', 'loans_user_book_open_key');
      await rejectsSql('UPDATE loans SET closed_at=$2 WHERE id=$1', [first.id, hours(479)], '23514', 'loans_closed_at_check');
      await db.loan.update({ where: { id: first.id }, data: { closedAt: hours(480) } });
      const next = await db.loan.create({ data: { ...data, startedAt: hours(480), dueAt: hours(960) } });
      assert.notEqual(first.id, next.id);
      assert.equal(next.reservationId, null);
    });

    await t.test('préstamo por reserva conserva titular y libro y no se duplica al cerrarse', async () => {
      const reservation = await db.reservation.findFirstOrThrow();
      const data = { reservationId: reservation.id, userId: user.id, bookId: book.id, startedAt: start, dueAt: hours(480) };
      const invalid = (userId: string, bookId: string, startedAt: Date, dueAt: Date, code: string, constraint: string) => rejectsSql(
        'INSERT INTO loans (id,reservation_id,user_id,book_id,started_at,due_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), reservation.id, userId, bookId, startedAt, dueAt], code, constraint);
      await invalid(otherUser.id, book.id, start, hours(480), '23503', 'loans_reservation_id_user_id_book_id_fkey');
      const unrelatedBook = await db.book.create({ data: bookData('Libro ajeno a la reserva') });
      await invalid(user.id, unrelatedBook.id, start, hours(480), '23503', 'loans_reservation_id_user_id_book_id_fkey');
      const loan = await db.loan.create({ data });
      await db.reservation.update({ where: { id: reservation.id }, data: { state: 'CONSUMED', closedAt: start } });
      await db.queueEntry.update({ where: { id: reservation.queueEntryId }, data: { state: 'FULFILLED', closedAt: start } });
      await db.loan.update({ where: { id: loan.id }, data: { closedAt: hours(480) } });
      await invalid(user.id, book.id, hours(480), hours(960), '23505', 'loans_reservation_id_key');
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include: { loan: true } })).loan?.id, loan.id);
      await rejectsSql('DELETE FROM queue_entries WHERE id=$1', [reservation.queueEntryId], '23503', 'reservations_queue_entry_id_user_id_book_id_fkey');
      await rejectsSql('DELETE FROM reservations WHERE id=$1', [reservation.id], '23503', 'loans_reservation_id_user_id_book_id_fkey');
      await assert.rejects(database.postgres.query('DELETE FROM users WHERE id=$1', [user.id]), { code: '23503' });
      await assert.rejects(database.postgres.query('DELETE FROM books WHERE id=$1', [book.id]), { code: '23503' });
    });

    await t.test('vigencia usa límites exclusivos sin depender de cierres procesados', async () => {
      const waiting = await db.queueEntry.create({ data: { userId: otherUser.id, bookId: book.id, joinedAt: start } });
      await db.reservation.create({ data: {
        queueEntryId: waiting.id, userId: otherUser.id, bookId: book.id, offeredAt: start, expiresAt: hours(24),
      } });
      await db.queueEntry.update({ where: { id: waiting.id }, data: { state: 'OFFERED' } });
      await db.loan.create({ data: { userId: otherUser.id, bookId: otherBook.id, startedAt: start, dueAt: hours(480) } });
      assert.equal(await db.reservation.count({ where: { state: 'HELD', expiresAt: { gt: hours(23) } } }), 1);
      assert.equal(await db.reservation.count({ where: { state: 'HELD', expiresAt: { gt: hours(24) } } }), 0);
      const activeAt = (time: Date) => db.loan.count({ where: {
        userId: otherUser.id, startedAt: { lte: time }, dueAt: { gt: time }, closedAt: null,
      } });
      assert.equal(await activeAt(hours(-1)), 0);
      assert.equal(await activeAt(hours(479)), 1);
      assert.equal(await activeAt(hours(480)), 0);
    });
  } finally {
    await database.close();
  }
});
