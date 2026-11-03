import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { circulationTransaction } from '../src/circulation/circulation-transaction.js';

function fixture(errors: unknown[]) {
  const attempts: unknown[] = [];
  const database = { async $transaction(work: (tx: object) => Promise<unknown>, options: unknown) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
    const tx = {}; attempts.push(tx);
    if (errors.length) throw errors.shift();
    return work(tx);
  } } as Pick<PrismaClient, '$transaction'>;
  return { database, attempts };
}

for (const error of [
  { code: 'P2034' },
  { meta: { driverAdapterError: { cause: { originalCode: '40001' } } } },
  { code: '40P01' },
  { code: 'P2002', meta: { modelName: 'Reservation', target: ['queueEntryId'] } },
  { code: 'P2002', meta: { driverAdapterError: { cause: { originalCode: '23505',
    constraint: { index: 'reservations_queue_entry_id_key' } } }, modelName: 'Reservation' } },
  { code: 'P2002', meta: { driverAdapterError: { cause: { originalCode: '23505',
    constraint: { index: 'notification_outbox_dedup_key_key' } } }, modelName: 'NotificationOutbox' } },
]) {
  test(`contrato transaccional reintenta conflicto ${JSON.stringify(error)}`, async () => {
    const f = fixture([error]);
    const result = await circulationTransaction(f.database, async tx => tx);
    assert.equal(f.attempts.length, 2);
    assert.notEqual(f.attempts[0], f.attempts[1]);
    assert.equal(result, f.attempts[1]);
  });
}

test('tres conflictos consecutivos producen SERVICE_UNAVAILABLE sin informar éxito', async () => {
  const f = fixture(Array.from({ length: 3 }, () => ({ code: 'P2034' })));
  await assert.rejects(circulationTransaction(f.database, async () => 'incorrecto'), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.attempts.length, 3);
});

for (const error of [new Error('persistencia'), { code: 'P1001' },
  { code: 'P2002', meta: { modelName: 'Reservation', target: ['id'] } },
  { code: '23505', constraint: 'otro_indice' }]) {
  test('los fallos ajenos al protocolo se propagan sin reintento', async () => {
    const f = fixture([error]);
    await assert.rejects(circulationTransaction(f.database, async () => null), caught => caught === error);
    assert.equal(f.attempts.length, 1);
  });
}
