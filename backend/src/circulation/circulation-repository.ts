import type { PrismaClient } from '../generated/prisma/client.js';
import type { BookOccupancy } from './circulation.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';
import { circulationTransaction, retryable } from './circulation-transaction.js';
import { reconcileBooks } from './reconcile-books.js';

// Re-exported for existing circulation operations that share the retry policy.
export { retryable };

export class CirculationRepository implements CirculationRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]> {
    const ids = [...new Set(bookIds)].sort();
    if (ids.length === 0) return [];
    const result = await circulationTransaction(this.database, tx => reconcileBooks(tx, ids));
    return result.occupancy;
  }
}
