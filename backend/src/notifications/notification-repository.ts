import { randomUUID } from 'node:crypto';
import type { PrismaClient, NotificationOutbox } from '../generated/prisma/client.js';

const unclaimed = { claimToken: null, claimedAt: null, leaseExpiresAt: null };

async function databaseTime(tx: Pick<PrismaClient, '$queryRaw'>): Promise<Date> {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (!clock || !Number.isFinite(clock.now.getTime())) throw new Error('No se pudo obtener la hora de PostgreSQL.');
  return clock.now;
}

export class NotificationRepository {
  constructor(private readonly database: Pick<PrismaClient, '$transaction'>) {}

  async claim(): Promise<NotificationOutbox | null> {
    return this.database.$transaction(async tx => {
      const now = await databaseTime(tx);
      // SKIP LOCKED permite varios emisores sin reclamar dos veces la misma fila.
      // Incluye concesiones vencidas sin una actualización masiva que bloquee
      // las filas de otros emisores.
      const [candidate] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM notification_outbox
        WHERE (state = 'PENDING' OR (state = 'PROCESSING' AND lease_expires_at <= ${now}))
          AND kind IN ('TURN_AVAILABLE', 'QUEUE_LIMIT_REJECTED', 'LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED')
          AND scheduled_at <= ${now} AND next_attempt_at <= ${now}
        ORDER BY scheduled_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!candidate) return null;
      const current = await tx.notificationOutbox.findUniqueOrThrow({ where: { id: candidate.id } });
      return tx.notificationOutbox.update({ where: { id: candidate.id }, data: {
        state: 'PROCESSING', claimedAt: now, leaseExpiresAt: new Date(now.getTime() + 60_000),
        firstAttemptAt: current.firstAttemptAt ?? now,
        claimToken: randomUUID(), attemptCount: { increment: 1 },
      } });
    });
  }

  async canSend(notification: NotificationOutbox): Promise<boolean> {
    return this.database.$transaction(async tx => {
      const now = await databaseTime(tx);
      const current = await tx.notificationOutbox.findFirst({ where: {
        id: notification.id, state: 'PROCESSING', claimToken: notification.claimToken,
        leaseExpiresAt: { gt: now },
      } });
      if (!current) return false;
      if (['LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED'].includes(notification.kind)) {
        // El cierre del préstamo no cancela recordatorios atrasados ni su aviso
        // de vencimiento. La titularidad del origen sí debe conservarse.
        return Boolean(await tx.loan.findFirst({ where: { id: notification.loanId!, userId: notification.userId } }));
      }
      if (notification.kind === 'QUEUE_LIMIT_REJECTED') {
        const entry = await tx.queueEntry.findFirst({ where: {
          id: notification.queueEntryId!, userId: notification.userId, state: 'REJECTED_LIMIT',
        } });
        return Boolean(entry);
      }
      const reservation = await tx.reservation.findFirst({ where: {
        id: notification.reservationId!, userId: notification.userId, state: 'HELD', expiresAt: { gt: now },
        queueEntry: { userId: notification.userId, state: 'OFFERED' },
      } });
      return Boolean(reservation);
    });
  }

  async deliveryWindowOpen(notification: NotificationOutbox): Promise<boolean> {
    return this.database.$transaction(async tx => {
      const now = await databaseTime(tx);
      // Margen de una hora respecto de las 24 horas de Resend. Se mide desde
      // la primera reclamación, también si el proceso cayó antes del envío.
      return notification.firstAttemptAt !== null
        && now.getTime() - notification.firstAttemptAt.getTime() < 23 * 3_600_000;
    });
  }

  async finish(notification: NotificationOutbox, outcome:
    { state: 'SENT'; providerMessageId: string } | { state: 'CANCELLED' }
    | { state: 'PENDING' | 'FAILED'; error: string }): Promise<void> {
    await this.database.$transaction(async tx => {
      const now = await databaseTime(tx);
      await tx.notificationOutbox.updateMany({ where: {
        id: notification.id, state: 'PROCESSING', claimToken: notification.claimToken, leaseExpiresAt: { gt: now },
      }, data: {
        state: outcome.state, ...unclaimed,
        ...(outcome.state === 'SENT' ? { sentAt: now, providerMessageId: outcome.providerMessageId, lastError: null } : {}),
        ...('error' in outcome ? { lastError: outcome.error,
          nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(notification.attemptCount - 1, 7))),
        } : {}),
      } });
    });
  }
}
