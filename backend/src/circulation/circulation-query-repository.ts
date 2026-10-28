import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AccountError } from '../accounts/account-error.js';
import type { CirculationQueryRepositoryInterface, PersonalCirculation } from './circulation-query.js';

const publicBook = { id: true, title: true } as const;

export class CirculationQueryRepository implements CirculationQueryRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findPersonalCirculation(userId: string): Promise<PersonalCirculation> {
    return this.database.$transaction(async (tx) => {
      // La primera lectura establece la instantánea de RepeatableRead.
      // Todas las fechas se evalúan contra este mismo instante de PostgreSQL.
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())) {
        throw new AccountError('INTERNAL_ERROR');
      }
      const now = clock.now;
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
        // OFFERED sigue bloqueando mientras esté abierta, aunque su oferta
        // necesite conciliación; no se presenta como reserva vigente por eso.
        requestConstraints: {
          activeLoanCount: loans.length, maxActiveLoans: 5,
          openQueueBookIds: [...new Set(entries.map(entry => entry.bookId))].sort(),
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
