import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AccountError } from '../accounts/account-error.js';
import { retryable } from './circulation-repository.js';
import type { QueueCancellationResult, QueueRepositoryInterface, QueueResult } from './queue.js';

const openIndex = 'queue_entries_user_book_open_key';
const entrySelection = { id: true, state: true, joinedAt: true, orderSeq: true } as const;

/** Solo la unicidad del par abierto justifica releer la entrada ganadora. */
function openEntryCollision(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.['target'];
    if (target === openIndex || (Array.isArray(target) && target.length === 1 && target[0] === openIndex)) return true;
    if (error.meta?.['modelName'] === 'QueueEntry' && Array.isArray(target) && target.length === 2) {
      const fields = [...target].sort().join(',');
      if (fields === 'bookId,userId' || fields === 'book_id,user_id') return true;
    }
  }
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const constraint = record['constraint'];
    const index = constraint && typeof constraint === 'object'
      ? (constraint as Record<string, unknown>)['index'] : constraint;
    if ((record['code'] === '23505' || record['originalCode'] === '23505') && index === openIndex) return true;
    pending.push(record['meta'], record['cause'], record['driverAdapterError']);
  }
  return false;
}

export class QueueRepository implements QueueRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async joinQueue(userId: string, bookId: string): Promise<QueueResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(tx => this.join(tx, userId, bookId), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
        });
      } catch (error) {
        if (!retryable(error) && !openEntryCollision(error)) throw error;
        if (attempt >= 2) throw new AccountError('SERVICE_UNAVAILABLE');
      }
    }
  }

  async cancelQueue(userId: string, entryId: string): Promise<QueueCancellationResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(tx => this.cancel(tx, userId, entryId), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
        });
      } catch (error) {
        // Cancelar no crea entradas: una violación UNIQUE nunca justifica reintentar aquí.
        if (!retryable(error)) throw error;
        if (attempt >= 2) throw new AccountError('SERVICE_UNAVAILABLE');
      }
    }
  }

  private async cancel(tx: Prisma.TransactionClient, userId: string, entryId: string): Promise<QueueCancellationResult> {
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length) throw new AccountError('AUTH_REQUIRED');
    const target = await tx.queueEntry.findFirst({ where: { id: entryId, userId }, select: { bookId: true } });
    if (!target) return { code: 'QUEUE_ENTRY_NOT_FOUND' };
    const bookId = target.bookId;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM books WHERE id = ${bookId}::uuid FOR UPDATE`;
    if (!locked.length) throw new AccountError('INTERNAL_ERROR');
    // Releer después de ambos bloqueos; nunca buscar una nueva entrada del mismo par.
    const entry = await tx.queueEntry.findFirst({ where: { id: entryId, userId, bookId },
      select: { state: true, joinedAt: true, closedAt: true } });
    if (!entry) return { code: 'QUEUE_ENTRY_NOT_FOUND' };
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())
      || !(entry.joinedAt instanceof Date) || !Number.isFinite(entry.joinedAt.getTime()) || entry.joinedAt > clock.now) {
      throw new AccountError('INTERNAL_ERROR');
    }
    const terminal = ['CANCELLED', 'EXPIRED', 'REJECTED_LIMIT', 'FULFILLED'].includes(entry.state);
    if (terminal) {
      if (!(entry.closedAt instanceof Date) || !Number.isFinite(entry.closedAt.getTime()) || entry.closedAt < entry.joinedAt) {
        throw new AccountError('INTERNAL_ERROR');
      }
      return entry.state === 'FULFILLED' ? { code: 'QUEUE_ENTRY_FULFILLED' } : { closed: true };
    }
    if (!['WAITING', 'OFFERED'].includes(entry.state) || entry.closedAt !== null) throw new AccountError('INTERNAL_ERROR');
    // La oferta y su reserva necesitan la operación compartida de SCRUM-25/27.
    if (entry.state === 'OFFERED') return { code: 'CIRCULATION_RECONCILIATION_REQUIRED' };
    const reservation = await tx.reservation.findUnique({ where: { queueEntryId: entryId }, select: { id: true } });
    if (reservation) throw new AccountError('INTERNAL_ERROR');
    const book = await tx.book.findUnique({ where: { id: bookId }, select: { totalCopies: true } });
    if (!book) throw new AccountError('INTERNAL_ERROR');
    const availability = await this.queueAvailability(tx, bookId, clock.now, book.totalCopies);
    if (availability.pending) return { code: 'CIRCULATION_RECONCILIATION_REQUIRED' };
    const updated = await tx.queueEntry.updateMany({ where: { id: entryId, userId, bookId, state: 'WAITING', closedAt: null },
      data: { state: 'CANCELLED', closedAt: clock.now } });
    if (updated.count !== 1) throw new AccountError('SERVICE_UNAVAILABLE');
    return { closed: true };
  }

  private async join(tx: Prisma.TransactionClient, userId: string, bookId: string): Promise<QueueResult> {
    // Mismo orden que SCRUM-20. El bloqueo por libro precede a la asignación
    // de orderSeq: una secuencia por sí sola no ordena los commits concurrentes.
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length) throw new AccountError('AUTH_REQUIRED');
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM books WHERE id = ${bookId}::uuid FOR UPDATE`;
    if (!locked.length) return { code: 'BOOK_NOT_FOUND' };
    const book = await tx.book.findUnique({ where: { id: bookId }, select: { id: true, title: true, totalCopies: true } });
    if (!book) return { code: 'BOOK_NOT_FOUND' };
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new AccountError('INTERNAL_ERROR');
    const now = clock.now;
    const publicBook = { id: book.id, title: book.title };
    const open = { bookId, state: { in: ['WAITING', 'OFFERED'] }, closedAt: null };
    const existing = await tx.queueEntry.findFirst({ where: { ...open, userId }, select: entrySelection });
    if (existing) {
      if (existing.state === 'OFFERED') return { serverTime: now, created: false,
        entry: { id: existing.id, book: publicBook, joinedAt: existing.joinedAt, state: 'OFFERED', position: null } };
      if (existing.state !== 'WAITING') throw new AccountError('INTERNAL_ERROR');
      const position = await this.position(tx, bookId, existing.orderSeq);
      return { serverTime: now, created: false,
        entry: { id: existing.id, book: publicBook, joinedAt: existing.joinedAt, state: 'WAITING', position } };
    }

    const active = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };
    if (await tx.loan.findFirst({ where: { ...active, userId, bookId }, select: { id: true } })) {
      return { code: 'BOOK_ALREADY_BORROWED' };
    }
    if (await tx.loan.count({ where: { ...active, userId } }) >= 5) return { code: 'LOAN_LIMIT_REACHED' };

    // Solo lecturas del libro solicitado. No invocar findOccupancyInTransaction:
    // puede cerrar entradas y no representa la conciliación completa.
    const availability = await this.queueAvailability(tx, bookId, now, book.totalCopies);
    if (availability.pending) return { code: 'CIRCULATION_RECONCILIATION_REQUIRED' };
    if (availability.capacity > 0) return { code: 'AVAILABLE_COPIES' };

    // Única escritura de esta operación; conserva todas las entradas anteriores.
    const entry = await tx.queueEntry.create({ data: { userId, bookId, state: 'WAITING', joinedAt: now }, select: entrySelection });
    const position = await this.position(tx, bookId, entry.orderSeq);
    return { serverTime: now, created: true,
      entry: { id: entry.id, book: publicBook, joinedAt: entry.joinedAt, state: 'WAITING', position } };
  }

  /** Comprobaciones compartidas de solo lectura; no asigna turnos ni modifica circulación. */
  private async queueAvailability(tx: Prisma.TransactionClient, bookId: string, now: Date, totalCopies: number) {
    const active = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };
    const loans = await tx.loan.count({ where: { ...active, bookId } });
    const held = await tx.reservation.count({ where: { bookId, state: 'HELD', closedAt: null, expiresAt: { gt: now } } });
    const capacity = totalCopies - loans - held;
    const incoherent = await tx.reservation.count({ where: { bookId, state: 'HELD', OR: [
      { closedAt: { not: null } }, { offeredAt: { gt: now } },
      { queueEntry: { isNot: { state: 'OFFERED', closedAt: null } } },
    ] } });
    if (!Number.isInteger(totalCopies) || totalCopies < 0 || capacity < 0 || incoherent > 0) {
      throw new AccountError('INTERNAL_ERROR');
    }
    const expiredLoans = await tx.loan.count({ where: { bookId, closedAt: null, dueAt: { lte: now } } });
    const expiredReservations = await tx.reservation.count({ where: { bookId, state: 'HELD', expiresAt: { lte: now } } });
    const pendingOffers = await tx.queueEntry.count({ where: { bookId, state: 'OFFERED', closedAt: null,
      NOT: { reservation: { is: { state: 'HELD', closedAt: null, offeredAt: { lte: now }, expiresAt: { gt: now } } } },
    } });
    const waiting = capacity > 0 ? await tx.queueEntry.count({ where: { bookId, state: 'WAITING', closedAt: null } }) : 0;
    return { capacity, pending: expiredLoans > 0 || expiredReservations > 0 || pendingOffers > 0 || waiting > 0 };
  }

  private async position(tx: Prisma.TransactionClient, bookId: string, orderSeq: bigint): Promise<number> {
    return 1 + await tx.queueEntry.count({ where: { bookId, state: 'WAITING', closedAt: null, orderSeq: { lt: orderSeq } } });
  }
}
