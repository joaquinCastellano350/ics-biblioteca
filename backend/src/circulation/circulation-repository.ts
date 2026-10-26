import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { BookOccupancy } from './circulation.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';

export class CirculationRepository implements CirculationRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]> {
    const ids = [...new Set(bookIds)];
    if (ids.length === 0) return [];

    return this.database.$transaction(async (transaction) => {
      // Único SQL explícito: Prisma no ofrece un método para leer el reloj del
      // servidor. Las entidades y sus relaciones se consultan mediante el ORM.
      const [clock] = await transaction.$queryRaw<{ now: Date }[]>`
        SELECT transaction_timestamp() AS now
      `;
      if (!clock) throw new Error('No se pudo obtener la hora de PostgreSQL.');
      const activeLoan: Prisma.LoanWhereInput = {
        closedAt: null, startedAt: { lte: clock.now }, dueAt: { gt: clock.now },
      };
      const heldReservation: Prisma.ReservationWhereInput = {
        state: 'HELD', expiresAt: { gt: clock.now },
      };
      const books = await transaction.book.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          totalCopies: true,
          _count: {
            select: {
              loans: { where: activeLoan },
              reservations: { where: heldReservation },
            },
          },
          queueEntries: {
            where: { state: 'WAITING' },
            select: {
              user: {
                select: {
                  // El límite considera todos los préstamos del estudiante.
                  _count: { select: { loans: { where: activeLoan } } },
                  // Para excluir posesión del libro solo hacen falta los IDs
                  // de los libros de esta consulta, no los metadatos personales.
                  loans: { where: { ...activeLoan, bookId: { in: ids } }, select: { bookId: true } },
                  reservations: { where: { ...heldReservation, bookId: { in: ids } }, select: { bookId: true } },
                },
              },
            },
          },
        },
      });

      return books.map((book) => ({
        bookId: book.id,
        totalCopies: book.totalCopies,
        activeLoans: book._count.loans,
        heldReservations: book._count.reservations,
        eligibleWaiters: book.queueEntries.filter(({ user }) =>
          user._count.loans < 5
          && !user.loans.some(({ bookId }) => bookId === book.id)
          && !user.reservations.some(({ bookId }) => bookId === book.id),
        ).length,
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
