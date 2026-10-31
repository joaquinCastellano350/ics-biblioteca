import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AccountError } from '../accounts/account-error.js';

export function retryable(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if ([record['code'], record['originalCode']].some(code => ['P2034', '40001', '40P01'].includes(String(code)))) return true;
    // Una instantánea SERIALIZABLE anterior al otro COMMIT puede detectar la
    // reserva ganadora por UNIQUE antes de informar un error de serialización.
    const meta = record['meta'] as Record<string, unknown> | undefined;
    const target = meta?.['target'];
    const targets = Array.isArray(target) ? target : [target];
    if (record['code'] === 'P2002' && (
      (meta?.['modelName'] === 'Reservation' && targets.some(field => ['queueEntryId', 'queue_entry_id', 'reservations_queue_entry_id_key'].includes(String(field))))
      || (meta?.['modelName'] === 'NotificationOutbox' && targets.some(field => ['dedupKey', 'dedup_key', 'notification_outbox_dedup_key_key'].includes(String(field))))
    )) return true;
    const constraint = record['constraint'];
    const index = constraint && typeof constraint === 'object' ? (constraint as Record<string, unknown>)['index'] : constraint;
    if ((record['code'] === '23505' || record['originalCode'] === '23505')
      && ['reservations_queue_entry_id_key', 'notification_outbox_dedup_key_key'].includes(String(index))) return true;
    pending.push(record['meta'], record['cause'], record['driverAdapterError']);
  }
  return false;
}

export async function circulationTransaction<T>(database: Pick<PrismaClient, '$transaction'>,
  operation: (tx: Prisma.TransactionClient) => Promise<T>, collision: (error: unknown) => boolean = () => false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000,
      });
    } catch (error) {
      if (!retryable(error) && !collision(error)) throw error;
      if (attempt >= 2) throw new AccountError('SERVICE_UNAVAILABLE');
    }
  }
}

export async function circulationTime(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new AccountError('INTERNAL_ERROR');
  return clock.now;
}
