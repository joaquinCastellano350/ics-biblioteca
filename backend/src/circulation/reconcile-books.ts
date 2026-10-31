import { Prisma } from '../generated/prisma/client.js';
import type { BookOccupancy } from './circulation.js';
import { circulationTime } from './circulation-transaction.js';

export interface ReconciliationResult {
  readonly now: Date;
  readonly occupancy: readonly BookOccupancy[];
}

export type ReservationReleaseReason = 'CANCELLED' | 'REJECTED_LIMIT';

/**
 * Cierra vencidos y asigna cupos a la cola con sus avisos, dentro del tx recibido.
 * El llamador confirma y reintenta la transacción SERIALIZABLE completa.
 */
export async function reconcileBooks(tx: Prisma.TransactionClient, bookIds: readonly string[]): Promise<ReconciliationResult> {
  const ids = [...new Set(bookIds)].sort();
  if (ids.length) await tx.$queryRaw(Prisma.sql`
    SELECT id FROM books WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR UPDATE
  `);
  const now = await circulationTime(tx);
  const occupancy: BookOccupancy[] = [];
  if (!ids.length) return { now, occupancy };
  const active = { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } };
  const held = { state: 'HELD', expiresAt: { gt: now } };
  await tx.loan.updateMany({ where: { bookId: { in: ids }, closedAt: null, dueAt: { lte: now } }, data: { closedAt: now } });
  const expired = await tx.reservation.findMany({ where: { bookId: { in: ids }, state: 'HELD', expiresAt: { lte: now } },
    select: { id: true, queueEntryId: true } });
  if (expired.length) {
    await tx.reservation.updateMany({ where: { id: { in: expired.map(r => r.id) } }, data: { state: 'EXPIRED', closedAt: now } });
    await tx.queueEntry.updateMany({ where: { id: { in: expired.map(r => r.queueEntryId) } }, data: { state: 'EXPIRED', closedAt: now } });
  }
  // Recupera rechazos de SCRUM-18 sin reabrirlos ni reiniciar avisos existentes.
  const rejected = await tx.queueEntry.findMany({ where: {
    bookId: { in: ids }, state: 'REJECTED_LIMIT', reservation: { is: null },
    notifications: { none: { kind: 'QUEUE_LIMIT_REJECTED' } },
  }, select: { id: true, userId: true, closedAt: true, user: { select: { email: true } }, book: { select: { title: true } } } });
  for (const entry of rejected) await tx.notificationOutbox.createMany({ skipDuplicates: true, data: {
    userId: entry.userId, queueEntryId: entry.id, kind: 'QUEUE_LIMIT_REJECTED', dedupKey: `queue:${entry.id}:limit`,
    recipientEmail: entry.user.email, payload: { bookTitle: entry.book.title }, scheduledAt: entry.closedAt!, nextAttemptAt: now,
  } });
  const books = await tx.book.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' },
    select: { id: true, title: true, totalCopies: true,
      _count: { select: { loans: { where: active }, reservations: { where: held } } },
      queueEntries: { where: { state: 'WAITING' }, orderBy: { orderSeq: 'asc' },
        select: { id: true, userId: true, user: { select: { email: true,
          _count: { select: { loans: { where: active } } },
          loans: { where: { ...active, bookId: { in: ids } }, select: { bookId: true } },
          reservations: { where: { ...held, bookId: { in: ids } }, select: { bookId: true } },
        } } } },
    } });
  for (const book of books) {
    let remaining = Math.max(0, book.totalCopies - book._count.loans - book._count.reservations);
    let offered = 0;
    for (const entry of book.queueEntries) {
      if (!remaining) break;
      if (entry.user._count.loans >= 5) {
        await tx.queueEntry.update({ where: { id: entry.id }, data: { state: 'REJECTED_LIMIT', closedAt: now } });
        await tx.notificationOutbox.create({ data: {
          userId: entry.userId, queueEntryId: entry.id, kind: 'QUEUE_LIMIT_REJECTED', dedupKey: `queue:${entry.id}:limit`,
          recipientEmail: entry.user.email, payload: { bookTitle: book.title }, scheduledAt: now, nextAttemptAt: now,
        } });
        continue;
      }
      if (entry.user.loans.some(loan => loan.bookId === book.id)
        || entry.user.reservations.some(reservation => reservation.bookId === book.id)) continue;
      const reservation = await tx.reservation.create({ data: {
        queueEntryId: entry.id, userId: entry.userId, bookId: book.id,
        offeredAt: now, expiresAt: new Date(now.getTime() + 24 * 3_600_000),
      } });
      await tx.queueEntry.update({ where: { id: entry.id }, data: { state: 'OFFERED' } });
      await tx.notificationOutbox.create({ data: {
        userId: entry.userId, reservationId: reservation.id, kind: 'TURN_AVAILABLE', dedupKey: `reservation:${reservation.id}:turn`,
        recipientEmail: entry.user.email, payload: { bookTitle: book.title, expiresAt: reservation.expiresAt.toISOString() },
        scheduledAt: now, nextAttemptAt: now,
      } });
      remaining--;
      offered++;
    }
    occupancy.push({ bookId: book.id, totalCopies: book.totalCopies, activeLoans: book._count.loans,
      heldReservations: book._count.reservations + offered, eligibleWaiters: 0 });
  }
  return { now, occupancy };
}

/** Uso interno de SCRUM-24/26, después de validar titularidad y motivo. */
export async function releaseReservation(tx: Prisma.TransactionClient, reservationId: string, reason: ReservationReleaseReason): Promise<ReconciliationResult> {
  const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { bookId: true } });
  await tx.$queryRaw`SELECT id FROM books WHERE id = ${reservation.bookId}::uuid FOR UPDATE`;
  const current = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  const now = await circulationTime(tx);
  if (current.state === 'HELD') {
    const state = current.expiresAt <= now ? 'EXPIRED' : reason;
    await tx.reservation.update({ where: { id: reservationId }, data: { state, closedAt: now } });
    await tx.queueEntry.update({ where: { id: current.queueEntryId }, data: { state, closedAt: now } });
  }
  return reconcileBooks(tx, [reservation.bookId]);
}
