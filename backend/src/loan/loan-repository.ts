import type { PrismaClient } from '../generated/prisma/client.js';
import type { LoanReadingRepositoryInterface } from './loan-repository-interface.js';
import type { LoanReading } from './loan.js';

export class LoanReadingRepository implements LoanReadingRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findReading(loanId: string, userId: string): Promise<LoanReading | null> {
    return this.database.$transaction(async (transaction) => {
      // Prisma no expone el reloj de PostgreSQL como una consulta del modelo.
      const [clock] = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('Reloj no disponible');
      const loan = await transaction.loan.findFirst({
        where: { id: loanId, userId, closedAt: null, startedAt: { lte: clock.now }, dueAt: { gt: clock.now } },
        select: { dueAt: true, book: { select: { pdfObjectKey: true } } },
      });
      return loan ? { pdfObjectKey: loan.book.pdfObjectKey, dueAt: loan.dueAt, serverTime: clock.now } : null;
    });
  }
}
