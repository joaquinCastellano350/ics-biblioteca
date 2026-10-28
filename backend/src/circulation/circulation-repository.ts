import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { BookOccupancy } from './circulation.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';
import { CirculationReconciler } from './circulation-reconciler.js';

function retryable(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if ([record['code'], record['originalCode']].some(code => ['P2034', '40001', '40P01'].includes(String(code)))) return true;
    pending.push(record['meta'], record['cause'], record['driverAdapterError']);
  }
  return false;
}

export class CirculationRepository implements CirculationRepositoryInterface {
  constructor(
    private readonly database: Pick<PrismaClient, '$transaction'>,
    private readonly reconciler = new CirculationReconciler(),
  ) {}

  async findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]> {
    const ids = [...new Set(bookIds)].sort();
    if (ids.length === 0) return [];

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(transaction => this.reconciler.reconcile(transaction, ids), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
        });
      } catch (error) {
        if (attempt >= 2 || !retryable(error)) throw error;
      }
    }
  }
}
