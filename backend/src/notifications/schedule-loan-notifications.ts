import type { Prisma } from '../generated/prisma/client.js';

const HOUR = 3_600_000;

/** Debe llamarse dentro de la misma transacción que concede el préstamo. */
export async function scheduleLoanNotifications(tx: Prisma.TransactionClient, loan: {
  id: string; userId: string; bookId: string; startedAt: Date; dueAt: Date;
}): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: loan.userId }, select: { email: true } });
  const book = await tx.book.findUniqueOrThrow({ where: { id: loan.bookId }, select: { title: true } });
  await tx.notificationOutbox.createMany({ skipDuplicates: true, data: [
    { kind: 'LOAN_DAY_10', suffix: 'day10', at: new Date(loan.startedAt.getTime() + 240 * HOUR) },
    { kind: 'LOAN_DUE_IN_3_DAYS', suffix: 'due3', at: new Date(loan.dueAt.getTime() - 72 * HOUR) },
    { kind: 'LOAN_EXPIRED', suffix: 'expired', at: loan.dueAt },
  ].map(({ kind, suffix, at }) => ({
    userId: loan.userId, loanId: loan.id, kind, dedupKey: `loan:${loan.id}:${suffix}`, recipientEmail: user.email,
    payload: { bookTitle: book.title, startedAt: loan.startedAt.toISOString(), dueAt: loan.dueAt.toISOString() },
    scheduledAt: at, nextAttemptAt: at,
  })) });
}
