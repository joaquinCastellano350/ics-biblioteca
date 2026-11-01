import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { circulationTime, circulationTransaction } from './circulation-transaction.js';
import { reconcileBooks, releaseReservation } from './reconcile-books.js';
import { scheduleLoanNotifications } from '../notifications/schedule-loan-notifications.js';
import type { ReservationRepositoryInterface, ReservationResult } from './reservation.js';

const publicLoan = { id: true, bookId: true, startedAt: true, dueAt: true } as const;

export class ReservationRepository implements ReservationRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async acceptReservation(userId: string, reservationId: string): Promise<ReservationResult> {
    return circulationTransaction(this.database, async tx => {
      // Mismo orden que la concesión directa: estudiante, luego libro.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const owned = await tx.reservation.findFirst({ where: { id: reservationId, userId }, select: { bookId: true } });
      // No se revela ni se modifica una reserva ajena, tampoco al repetir enlaces.
      if (!owned) return { code: 'RESERVATION_NOT_FOUND' };
      await reconcileBooks(tx, [owned.bookId]);
      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId },
        include: { loan: { select: { ...publicLoan, closedAt: true } } } });
      let now = await circulationTime(tx);
      if (reservation.state === 'CONSUMED' && reservation.loan) {
        const { closedAt, ...loan } = reservation.loan;
        return { loan, created: false, active: !closedAt && loan.startedAt <= now && now < loan.dueAt };
      }
      if (reservation.state === 'REJECTED_LIMIT') return { code: 'RESERVATION_REJECTED_LIMIT' };
      if (reservation.state === 'EXPIRED') return { code: 'RESERVATION_EXPIRED' };
      if (reservation.state !== 'HELD') return { code: 'RESERVATION_CANCELLED' };
      const loans = await tx.loan.findMany({ where: { userId, closedAt: null }, select: { startedAt: true, dueAt: true } });
      // Volver a comprobar el reloj justo antes de consumir, incluso tras consultas lentas.
      now = await circulationTime(tx);
      if (reservation.expiresAt <= now) {
        await reconcileBooks(tx, [owned.bookId]);
        return { code: 'RESERVATION_EXPIRED' };
      }
      if (loans.filter(loan => loan.startedAt <= now && now < loan.dueAt).length >= 5) {
        await releaseReservation(tx, reservationId, 'REJECTED_LIMIT');
        const closed = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { state: true } });
        // Un rechazo de negocio devuelve un valor: debe confirmar cierre y reasignación.
        return { code: closed.state === 'EXPIRED' ? 'RESERVATION_EXPIRED' : 'RESERVATION_REJECTED_LIMIT' };
      }
      const loan = await tx.loan.create({ data: { userId, bookId: owned.bookId, reservationId,
        startedAt: now, dueAt: new Date(now.getTime() + 480 * 3_600_000) }, select: publicLoan });
      await tx.reservation.update({ where: { id: reservationId }, data: { state: 'CONSUMED', closedAt: now } });
      await tx.queueEntry.update({ where: { id: reservation.queueEntryId }, data: { state: 'FULFILLED', closedAt: now } });
      await scheduleLoanNotifications(tx, { ...loan, userId });
      return { loan, created: true, active: true };
    }, error => error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002' && error.meta?.['modelName'] === 'Loan');
  }
}
