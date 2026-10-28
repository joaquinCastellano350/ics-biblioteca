import type { Prisma } from '../generated/prisma/client.js';

type TurnNotice = { kind: 'TURN_AVAILABLE'; reservationId: string; expiresAt: Date };
type RejectionNotice = { kind: 'QUEUE_LIMIT_REJECTED'; queueEntryId: string };
export type CirculationNotice = (TurnNotice | RejectionNotice) & {
  userId: string; email: string; bookId: string; title: string; now: Date;
};

// Registra trabajo durable en la transacción del llamador. No envía correos.
export class NotificationOutboxRepository {
  async enqueue(transaction: Prisma.TransactionClient, notice: CirculationNotice): Promise<void> {
    const turn = notice.kind === 'TURN_AVAILABLE';
    const dedupKey = turn ? `reservation:${notice.reservationId}:turn` : `queue:${notice.queueEntryId}:limit`;
    await transaction.notificationOutbox.upsert({
      where: { dedupKey }, update: {},
      create: {
        userId: notice.userId,
        ...(turn ? { reservationId: notice.reservationId } : { queueEntryId: notice.queueEntryId }),
        kind: notice.kind, dedupKey, recipientEmail: notice.email,
        payload: {
          bookId: notice.bookId, title: notice.title,
          ...(turn ? { reservationId: notice.reservationId, expiresAt: notice.expiresAt.toISOString() }
            : { queueEntryId: notice.queueEntryId }),
        },
        scheduledAt: notice.now, nextAttemptAt: notice.now, createdAt: notice.now,
      },
    });
  }
}
