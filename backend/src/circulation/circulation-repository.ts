import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { BookOccupancy } from './circulation.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';

export function retryable(error: unknown): boolean {
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
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]> {
    const ids = [...new Set(bookIds)].sort();
    if (ids.length === 0) return [];

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(transaction => this.findOccupancyInTransaction(transaction, ids), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
        });
      } catch (error) {
        if (attempt >= 2 || !retryable(error)) throw error;
      }
    }
  }

  async findOccupancyInTransaction(transaction: Prisma.TransactionClient, ids: readonly string[], now?: Date): Promise<readonly BookOccupancy[]> {
    // Prisma no expone FOR UPDATE. El bloqueo coordina el rechazo persistido;
    // las lecturas de entidades y la actualización de la entrada usan el ORM.
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM books WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE
    `);
    const [clock] = now ? [{ now }] : await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('No se pudo obtener la hora de PostgreSQL.');
    const activeLoan: Prisma.LoanWhereInput = {
      closedAt: null, startedAt: { lte: clock.now }, dueAt: { gt: clock.now },
    };
    const heldReservation: Prisma.ReservationWhereInput = {
      state: 'HELD', expiresAt: { gt: clock.now },
    };
    const books = await transaction.book.findMany({
      where: { id: { in: [...ids] } }, orderBy: { id: 'asc' },
      select: {
        id: true, totalCopies: true,
        _count: { select: { loans: { where: activeLoan }, reservations: { where: heldReservation } } },
        queueEntries: {
          where: { state: 'WAITING' }, orderBy: { orderSeq: 'asc' },
          select: {
            id: true,
            user: { select: {
              _count: { select: { loans: { where: activeLoan } } },
              loans: { where: { ...activeLoan, bookId: { in: [...ids] } }, select: { bookId: true } },
              reservations: { where: { ...heldReservation, bookId: { in: [...ids] } }, select: { bookId: true } },
            } },
          },
        },
      },
    });
    const result: BookOccupancy[] = [];
    for (const book of books) {
      let remaining = Math.max(0, book.totalCopies - book._count.loans - book._count.reservations);
      let eligibleWaiters = 0;
      for (const entry of book.queueEntries) {
        // Las esperas elegibles anteriores tienen prioridad sobre estos cupos;
        // no evaluar ni rechazar a quienes aún no tienen turno.
        if (remaining === 0) break;
        if (entry.user._count.loans >= 5) {
          await transaction.queueEntry.update({
            where: { id: entry.id }, data: { state: 'REJECTED_LIMIT', closedAt: clock.now },
          });
          continue;
        }
        if (entry.user.loans.some(loan => loan.bookId === book.id)
          || entry.user.reservations.some(reservation => reservation.bookId === book.id)) continue;
        eligibleWaiters++;
        remaining--;
      }
      result.push({ bookId: book.id, totalCopies: book.totalCopies,
        activeLoans: book._count.loans, heldReservations: book._count.reservations, eligibleWaiters });
    }
    return result;
  }
}
