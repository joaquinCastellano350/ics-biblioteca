import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';
import { circulationTransaction } from './circulation-transaction.js';
import { reconcileBooks } from './reconcile-books.js';

export { retryable } from './circulation-transaction.js';

export class CirculationRepository implements CirculationRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findOccupancy(bookIds: readonly string[]) {
    if (!bookIds.length) return [];
    return circulationTransaction(this.database, tx => this.findOccupancyInTransaction(tx, bookIds));
  }

  async findOccupancyInTransaction(tx: Prisma.TransactionClient, bookIds: readonly string[]) {
    return (await reconcileBooks(tx, bookIds)).occupancy;
  }
}
