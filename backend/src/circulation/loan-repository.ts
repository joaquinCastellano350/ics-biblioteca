import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AccountError } from '../accounts/account-error.js';
import { CirculationRepository, retryable } from './circulation-repository.js';
import { preserveQueuePriority, type ReleasedCapacityHandler } from './released-capacity-handler.js';
import type { LoanRepositoryInterface, LoanResult } from './loan.js';
import { scheduleLoanNotifications } from '../notifications/schedule-loan-notifications.js';

const HOUR = 3_600_000;
const publicLoan = { id: true, bookId: true, startedAt: true, dueAt: true } as const;

export class LoanRepository implements LoanRepositoryInterface {
  constructor(
    private readonly database: Pick<PrismaClient, '$transaction'>,
    private readonly releasedCapacity: ReleasedCapacityHandler = preserveQueuePriority,
  ) {}

  async requestLoan(userId: string, bookId: string): Promise<LoanResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(tx => this.grant(tx, userId, bookId), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
        });
      } catch (error) {
        // PostgreSQL también puede informar el índice único del par cuando
        // dos confirmaciones partieron de la misma instantánea. Releer todo.
        const duplicate = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2002' && error.meta?.['modelName'] === 'Loan';
        if (!retryable(error) && !duplicate) throw error;
        if (attempt >= 2) throw new AccountError('SERVICE_UNAVAILABLE');
      }
    }
  }

  private async grant(tx: Prisma.TransactionClient, userId: string, bookId: string): Promise<LoanResult> {
    // Todas las concesiones deben coordinar estudiante y libro y leer el conjunto
    // de préstamos bajo SERIALIZABLE, también para libros distintos.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const books = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM books WHERE id = ${bookId}::uuid FOR UPDATE`;
    if (!books.length) return { code: 'BOOK_NOT_FOUND' };
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('No se pudo obtener la hora de PostgreSQL.');
    const now = clock.now;
    const active = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };

    const expired = await tx.reservation.findMany({
      where: { bookId, state: 'HELD', expiresAt: { lte: now } }, select: { id: true, queueEntryId: true },
    });
    if (expired.length) {
      await tx.reservation.updateMany({ where: { id: { in: expired.map(r => r.id) } }, data: { state: 'EXPIRED', closedAt: now } });
      await tx.queueEntry.updateMany({ where: { id: { in: expired.map(r => r.queueEntryId) } }, data: { state: 'EXPIRED', closedAt: now } });
    }
    const existing = await tx.loan.findFirst({ where: { ...active, userId, bookId }, select: publicLoan });
    if (existing) return { loan: existing, created: false };

    // Reutiliza la protección de prioridad de SCRUM-18. SCRUM-25 incorporará
    // aquí la conciliación completa que persiste ofertas y avisos de turno.
    const [occupancy] = await new CirculationRepository(this.database, this.releasedCapacity)
      .findOccupancyInTransaction(tx, [bookId], now);
    if (await tx.loan.count({ where: { ...active, userId } }) >= 5) return { code: 'LOAN_LIMIT_REACHED' };
    if (await tx.queueEntry.findFirst({ where: { userId, bookId, state: { in: ['WAITING', 'OFFERED'] } } })) {
      return { code: 'OPEN_QUEUE_ENTRY' };
    }
    if (!occupancy || occupancy.totalCopies <= occupancy.activeLoans + occupancy.heldReservations + occupancy.eligibleWaiters) {
      return { code: 'NO_AVAILABLE_COPIES' };
    }
    const dueAt = new Date(now.getTime() + 480 * HOUR);
    const loan = await tx.loan.create({ data: { userId, bookId, startedAt: now, dueAt }, select: publicLoan });
    await scheduleLoanNotifications(tx, { ...loan, userId });
    return { loan, created: true };
  }
}
