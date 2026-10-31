import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { circulationTransaction } from './circulation-transaction.js';
import { reconcileBooks } from './reconcile-books.js';
import { scheduleLoanNotifications } from '../notifications/schedule-loan-notifications.js';
import type { LoanRepositoryInterface, LoanResult } from './loan.js';

const HOUR = 3_600_000;
const publicLoan = { id: true, bookId: true, startedAt: true, dueAt: true } as const;

export class LoanRepository implements LoanRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async requestLoan(userId: string, bookId: string): Promise<LoanResult> {
    return circulationTransaction(this.database, tx => this.grant(tx, userId, bookId), error =>
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002' && error.meta?.['modelName'] === 'Loan');
  }

  private async grant(tx: Prisma.TransactionClient, userId: string, bookId: string): Promise<LoanResult> {
    // Mantiene el orden de bloqueos de circulación: estudiante y luego libro.
    // La conciliación y la concesión comparten el mismo intento SERIALIZABLE.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const reconciliation = await reconcileBooks(tx, [bookId]);
    const now = reconciliation.now;
    const [occupancy] = reconciliation.occupancy;
    if (!occupancy) return { code: 'BOOK_NOT_FOUND' };
    const active = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };

    const existing = await tx.loan.findFirst({ where: { ...active, userId, bookId }, select: publicLoan });
    if (existing) return { loan: existing, created: false };

    if (await tx.loan.count({ where: { ...active, userId } }) >= 5) return { code: 'LOAN_LIMIT_REACHED' };
    if (await tx.queueEntry.findFirst({ where: { userId, bookId, state: { in: ['WAITING', 'OFFERED'] } } })) {
      return { code: 'OPEN_QUEUE_ENTRY' };
    }
    if (occupancy.totalCopies <= occupancy.activeLoans + occupancy.heldReservations + occupancy.eligibleWaiters) {
      return { code: 'NO_AVAILABLE_COPIES' };
    }
    const dueAt = new Date(now.getTime() + 480 * HOUR);
    const loan = await tx.loan.create({ data: { userId, bookId, startedAt: now, dueAt }, select: publicLoan });
    await scheduleLoanNotifications(tx, { ...loan, userId });
    return { loan, created: true };
  }
}
