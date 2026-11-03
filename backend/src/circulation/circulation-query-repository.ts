import type { PrismaClient } from '../generated/prisma/client.js';
import { circulationTransaction } from './circulation-transaction.js';
import { reconcileBooks } from './reconcile-books.js';
import type { CirculationQueryRepositoryInterface, PersonalCirculation } from './circulation-query.js';

const publicBook = { id: true, title: true } as const;

export class CirculationQueryRepository implements CirculationQueryRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findPersonalCirculation(userId: string): Promise<PersonalCirculation> {
    return circulationTransaction(this.database, async (tx) => {
      const books = await tx.queueEntry.findMany({
        where: { userId, state: { in: ['WAITING', 'OFFERED'] } }, select: { bookId: true },
      });
      const { now } = await reconcileBooks(tx, books.map(entry => entry.bookId));
      const loans = await tx.loan.findMany({
        where: { userId, closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: { id: true, startedAt: true, dueAt: true, book: { select: publicBook } },
      });
      const entries = await tx.queueEntry.findMany({
        where: { userId, closedAt: null, state: { in: ['WAITING', 'OFFERED'] } },
        orderBy: { orderSeq: 'asc' },
        select: { id: true, bookId: true, state: true, orderSeq: true, joinedAt: true, book: { select: publicBook } },
      });
      const reservations = await tx.reservation.findMany({
        where: {
          userId, state: 'HELD', closedAt: null, expiresAt: { gt: now },
          queueEntry: { userId, state: 'OFFERED', closedAt: null },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: { id: true, queueEntryId: true, offeredAt: true, expiresAt: true, book: { select: publicBook } },
      });
      const waits = [];
      for (const entry of entries) {
        if (entry.state !== 'WAITING') continue;
        // Posición entre WAITING persistidas: no filtrar personas por una
        // elegibilidad provisional ni simular ofertas de SCRUM-25/27.
        const ahead = await tx.queueEntry.count({
          where: { bookId: entry.bookId, state: 'WAITING', closedAt: null, orderSeq: { lt: entry.orderSeq } },
        });
        waits.push({ id: entry.id, book: entry.book, joinedAt: entry.joinedAt, position: ahead + 1 });
      }
      return {
        serverTime: now, loans, waits, reservations,
        // Son restricciones de la instantánea, no una promesa de concesión.
        requestConstraints: {
          activeLoanCount: loans.length, maxActiveLoans: 5,
          openQueueBookIds: [...new Set(entries.map(entry => entry.bookId))].sort(),
        },
      };
    });
  }
}
