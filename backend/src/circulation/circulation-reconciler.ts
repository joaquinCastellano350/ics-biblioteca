import { Prisma } from '../generated/prisma/client.js';
import { NotificationOutboxRepository } from '../notifications/notification-outbox-repository.js';
import type { BookOccupancy } from './circulation.js';

export class CirculationReconciler {
  constructor(private readonly notices: Pick<NotificationOutboxRepository, 'enqueue'> = new NotificationOutboxRepository()) {}

  // Reutilizable por operaciones futuras; nunca abre otra transacción.
  async reconcile(transaction: Prisma.TransactionClient, bookIds: readonly string[]): Promise<readonly BookOccupancy[]> {
    const ids = [...new Set(bookIds)].sort();
    if (!ids.length) return [];
    // Prisma no ofrece FOR UPDATE. Solo el bloqueo y el reloj usan SQL.
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM books WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE
    `);
    const [clock] = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('No se pudo obtener la hora de PostgreSQL.');
    const now = clock.now;
    const activeLoan: Prisma.LoanWhereInput = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };
    const heldReservation: Prisma.ReservationWhereInput = { state: 'HELD', expiresAt: { gt: now } };
    await transaction.loan.updateMany({ where: { bookId: { in: ids }, closedAt: null, dueAt: { lte: now } }, data: { closedAt: now } });
    const expired = await transaction.reservation.findMany({
      where: { bookId: { in: ids }, state: 'HELD', expiresAt: { lte: now } }, select: { id: true, queueEntryId: true },
    });
    if (expired.length) {
      await transaction.reservation.updateMany({
        where: { id: { in: expired.map(item => item.id) } }, data: { state: 'EXPIRED', closedAt: now },
      });
      await transaction.queueEntry.updateMany({
        where: { id: { in: expired.map(item => item.queueEntryId) }, state: 'OFFERED' }, data: { state: 'EXPIRED', closedAt: now },
      });
      await transaction.notificationOutbox.updateMany({
        where: { reservationId: { in: expired.map(item => item.id) }, kind: 'TURN_AVAILABLE', state: 'PENDING' },
        data: { state: 'CANCELLED' },
      });
    }
    // Cuentas y esperas por lote: no consultar de nuevo cada libro/estudiante.
    const books = await transaction.book.findMany({
      where: { id: { in: ids } }, orderBy: { id: 'asc' },
      select: {
        id: true, title: true, totalCopies: true,
        _count: { select: { loans: { where: activeLoan }, reservations: { where: heldReservation } } },
        queueEntries: {
          where: { state: 'WAITING' }, orderBy: { orderSeq: 'asc' },
          select: {
            id: true, userId: true,
            user: { select: {
              email: true, _count: { select: { loans: { where: activeLoan } } },
              loans: { where: { ...activeLoan, bookId: { in: ids } }, select: { bookId: true } },
              reservations: { where: { ...heldReservation, bookId: { in: ids } }, select: { bookId: true } },
            } },
          },
        },
      },
    });
    const result: BookOccupancy[] = [];
    for (const book of books) {
      const activeLoans = book._count.loans;
      let heldReservations = book._count.reservations;
      let free = book.totalCopies - activeLoans - heldReservations;
      if (free < 0) throw new Error('La ocupación supera los cupos del libro.');
      for (const entry of book.queueEntries) {
        if (free === 0) break;
        if (entry.user._count.loans >= 5) {
          await transaction.queueEntry.update({ where: { id: entry.id }, data: { state: 'REJECTED_LIMIT', closedAt: now } });
          await this.notices.enqueue(transaction, {
            kind: 'QUEUE_LIMIT_REJECTED', queueEntryId: entry.id,
            userId: entry.userId, email: entry.user.email, bookId: book.id, title: book.title, now,
          });
          continue;
        }
        if (entry.user.loans.some(loan => loan.bookId === book.id)
          || entry.user.reservations.some(reservation => reservation.bookId === book.id)) {
          throw new Error('Entrada en cola incompatible con una ocupación propia.');
        }
        const expiresAt = new Date(now.getTime() + 24 * 3_600_000);
        // Reclamar primero la entrada provoca conflicto de serialización si
        // otra recarga ya la atendió desde una instantánea más nueva. Evita
        // intentar insertar una reserva duplicada desde la instantánea vieja.
        await transaction.queueEntry.update({ where: { id: entry.id }, data: { state: 'OFFERED' } });
        const reservation = await transaction.reservation.create({ data: {
          queueEntryId: entry.id, userId: entry.userId, bookId: book.id, offeredAt: now, expiresAt,
        } });
        await this.notices.enqueue(transaction, {
          kind: 'TURN_AVAILABLE', reservationId: reservation.id, expiresAt,
          userId: entry.userId, email: entry.user.email, bookId: book.id, title: book.title, now,
        });
        heldReservations++;
        free--;
      }
      result.push({ bookId: book.id, totalCopies: book.totalCopies, activeLoans, heldReservations });
    }
    return result;
  }
}
