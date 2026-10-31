import type { Prisma } from '../generated/prisma/client.js';

/** Internal seam for HU-06 to assign capacity released by an expired loan. */
export interface ReleasedCapacityHandler {
  handle(transaction: Prisma.TransactionClient, bookId: string, processedAt: Date): Promise<void>;
}

/** Until HU-06 is integrated, the availability projection keeps WAITING users' priority. */
export const preserveQueuePriority: ReleasedCapacityHandler = {
  async handle() {},
};
