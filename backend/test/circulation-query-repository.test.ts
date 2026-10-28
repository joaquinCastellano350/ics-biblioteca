import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { CirculationQueryRepository } from '../src/circulation/circulation-query-repository.js';

const now = new Date('2026-10-28T12:00:00Z');
const at = (offset: number) => new Date(now.getTime() + offset);
const book = { id: 'book-a', title: 'Libro A' };
const publicBook = { id: true, title: true };
const sequence = 9007199254741000n; // No convertir el orden persistido a Number.

/** Dobles de lectura: no construye PrismaClient, no ejecuta SQL ni accede a servicios. */
function fixture(options: { empty?: boolean; clock?: Date | null; fail?: 'loan' | 'queue' | 'reservation' | 'count'; error?: Error } = {}) {
  let transactions = 0;
  let clocks = 0;
  const calls: string[] = [];
  const owners: string[] = [];
  const constraints = { state: { in: ['WAITING', 'OFFERED'] }, closedAt: null };
  const tx = {
    async $queryRaw(template: TemplateStringsArray, ...values: unknown[]) {
      clocks++;
      assert.equal(template.join('?'), 'SELECT clock_timestamp() AS now');
      assert.deepEqual(values, []);
      return options.clock === null ? [] : [{ now: options.clock ?? now }];
    },
    loan: { async findMany(args: Prisma.LoanFindManyArgs) {
      calls.push('loan');
      if (options.fail === 'loan') throw options.error;
      const userId = args.where?.userId;
      assert.equal(typeof userId, 'string');
      owners.push(userId as string);
      assert.deepEqual(args.where, { userId, closedAt: null, startedAt: { lte: now }, dueAt: { gt: now } });
      assert.deepEqual(args.select, { id: true, startedAt: true, dueAt: true, book: { select: publicBook } });
      assert.deepEqual(args.orderBy, [{ dueAt: 'asc' }, { id: 'asc' }]);
      // Selección evaluada por el doble para comprobar los límites pedidos al ORM.
      const rows = [
        { id: 'active', userId: 'ana', startedAt: at(-100), dueAt: at(1), closedAt: null },
        { id: 'expired', userId: 'ana', startedAt: at(-100), dueAt: at(-1), closedAt: null },
        { id: 'boundary', userId: 'ana', startedAt: at(-100), dueAt: now, closedAt: null },
        { id: 'closed', userId: 'ana', startedAt: at(-100), dueAt: at(100), closedAt: now },
        { id: 'future', userId: 'ana', startedAt: at(1), dueAt: at(100), closedAt: null },
        { id: 'other', userId: 'bea', startedAt: now, dueAt: at(100), closedAt: null },
      ];
      return options.empty ? [] : rows.filter(row => row.userId === userId && row.closedAt === null
        && row.startedAt <= now && row.dueAt > now).map(({ id, startedAt, dueAt }) => ({ id, startedAt, dueAt, book }));
    } },
    queueEntry: {
      async findMany(args: Prisma.QueueEntryFindManyArgs) {
        calls.push('queue');
        if (options.fail === 'queue') throw options.error;
        const userId = args.where?.userId;
        assert.deepEqual(args.where, { userId, ...constraints });
        assert.deepEqual(args.orderBy, { orderSeq: 'asc' });
        assert.deepEqual(args.select, { id: true, bookId: true, state: true, orderSeq: true, joinedAt: true,
          book: { select: publicBook } });
        assert.equal(typeof userId, 'string');
        owners.push(userId as string);
        return options.empty ? [] : [
          { id: 'wait', userId: 'ana', state: 'WAITING', closedAt: null, bookId: book.id,
            orderSeq: sequence, joinedAt: at(-100), book },
          { id: 'offer', userId: 'ana', state: 'OFFERED', closedAt: null, bookId: 'book-b',
            orderSeq: sequence + 100n, joinedAt: at(-90), book: { id: 'book-b', title: 'Libro B' } },
          // Oferta pendiente de conciliación: restringe la interfaz pero no es una reserva vigente.
          { id: 'stale-offer', userId: 'ana', state: 'OFFERED', closedAt: null, bookId: 'book-c',
            orderSeq: sequence + 200n, joinedAt: at(-80), book: { id: 'book-c', title: 'Libro C' } },
          { id: 'terminal', userId: 'ana', state: 'REJECTED_LIMIT', closedAt: now, bookId: 'book-d',
            orderSeq: sequence + 300n, joinedAt: at(-70), book },
          { id: 'other', userId: 'bea', state: 'WAITING', closedAt: null, bookId: book.id,
            orderSeq: sequence + 400n, joinedAt: at(-60), book },
        ].filter(row => row.userId === userId && row.closedAt === null && ['WAITING', 'OFFERED'].includes(row.state))
          .map(({ id, state, bookId, orderSeq, joinedAt, book: selectedBook }) => ({ id, state, bookId, orderSeq, joinedAt, book: selectedBook }));
      },
      async count(args: Prisma.QueueEntryCountArgs) {
        calls.push('count');
        if (options.fail === 'count') throw options.error;
        const order = (args.where?.orderSeq as { lt: bigint }).lt;
        assert.ok(order === sequence || order === sequence + 400n);
        assert.deepEqual(args.where, { bookId: book.id, state: 'WAITING', closedAt: null, orderSeq: { lt: order } });
        // Los huecos en orderSeq no son posiciones. No se seleccionan identidades ajenas.
        const rows = [
          { order: 10n, state: 'WAITING', closedAt: null, bookId: book.id },
          { order: sequence - 5n, state: 'WAITING', closedAt: null, bookId: book.id },
          { order: sequence, state: 'WAITING', closedAt: null, bookId: book.id },
          { order: sequence + 1n, state: 'WAITING', closedAt: null, bookId: book.id },
          { order: 15n, state: 'OFFERED', closedAt: null, bookId: book.id },
          { order: 16n, state: 'CANCELLED', closedAt: now, bookId: book.id },
          { order: 17n, state: 'WAITING', closedAt: null, bookId: 'another-book' },
        ];
        return rows.filter(row => row.order < order && row.state === 'WAITING' && row.closedAt === null && row.bookId === book.id).length;
      },
    },
    reservation: { async findMany(args: Prisma.ReservationFindManyArgs) {
      calls.push('reservation');
      if (options.fail === 'reservation') throw options.error;
      const userId = args.where?.userId;
      assert.deepEqual(args.where, { userId, state: 'HELD', closedAt: null, expiresAt: { gt: now },
        queueEntry: { userId, state: 'OFFERED', closedAt: null } });
      assert.deepEqual(args.select, { id: true, queueEntryId: true, offeredAt: true, expiresAt: true, book: { select: publicBook } });
      assert.deepEqual(args.orderBy, [{ expiresAt: 'asc' }, { id: 'asc' }]);
      assert.equal(typeof userId, 'string');
      owners.push(userId as string);
      const rows = [
        { id: 'held', userId: 'ana', state: 'HELD', closedAt: null, expiresAt: at(1), entry: 'OFFERED' },
        { id: 'expired', userId: 'ana', state: 'HELD', closedAt: null, expiresAt: at(-1), entry: 'OFFERED' },
        { id: 'boundary', userId: 'ana', state: 'HELD', closedAt: null, expiresAt: now, entry: 'OFFERED' },
        { id: 'consumed', userId: 'ana', state: 'CONSUMED', closedAt: now, expiresAt: at(100), entry: 'FULFILLED' },
        { id: 'orphan', userId: 'ana', state: 'HELD', closedAt: null, expiresAt: at(100), entry: 'WAITING' },
        { id: 'other', userId: 'bea', state: 'HELD', closedAt: null, expiresAt: at(100), entry: 'OFFERED' },
      ];
      return options.empty ? [] : rows.filter(row => row.userId === userId && row.state === 'HELD'
        && row.closedAt === null && row.expiresAt > now && row.entry === 'OFFERED')
        .map(({ id, expiresAt }) => ({ id, expiresAt, queueEntryId: 'offer', offeredAt: at(-100), book: { id: 'book-b', title: 'Libro B' } }));
    } },
  };
  const database = {
    async $transaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>, settings: unknown): Promise<T> {
      transactions++;
      assert.deepEqual(settings, { isolationLevel: 'RepeatableRead' });
      return operation(tx as unknown as Prisma.TransactionClient);
    },
  };
  return {
    repository: new CirculationQueryRepository(database as unknown as Pick<PrismaClient, '$transaction'>),
    calls, owners, get transactions() { return transactions; }, get clocks() { return clocks; },
  };
}

test('una instantánea y un reloj de PostgreSQL, con operaciones exclusivamente de lectura', async () => {
  const f = fixture();
  const result = await f.repository.findPersonalCirculation('ana');
  assert.equal(f.transactions, 1);
  assert.equal(f.clocks, 1);
  assert.deepEqual(f.calls, ['loan', 'queue', 'reservation', 'count']);
  assert.equal(result.serverTime, now);
});

test('préstamos vigentes: excluye vencidos, límite exacto, cerrados, futuros y ajenos', async () => {
  const f = fixture();
  const result = await f.repository.findPersonalCirculation('ana');
  assert.deepEqual(result.loans, [{ id: 'active', book, startedAt: at(-100), dueAt: at(1) }]);
  assert.equal(result.requestConstraints.activeLoanCount, 1);
  assert.equal(result.requestConstraints.maxActiveLoans, 5);
});

test('posición por cantidad de WAITING anteriores, no por el valor BigInt de orderSeq', async () => {
  const result = await fixture().repository.findPersonalCirculation('ana');
  assert.deepEqual(result.waits, [{ id: 'wait', book, joinedAt: at(-100), position: 3 }]);
  assert.equal(JSON.stringify(result).includes('orderSeq'), false);
});

test('solo reservas HELD vigentes con entrada OFFERED; excluye límites exactos y ofertas vencidas', async () => {
  const result = await fixture().repository.findPersonalCirculation('ana');
  assert.deepEqual(result.reservations, [{ id: 'held', queueEntryId: 'offer',
    book: { id: 'book-b', title: 'Libro B' }, offeredAt: at(-100), expiresAt: at(1) }]);
  assert.deepEqual(result.requestConstraints.openQueueBookIds, ['book-a', 'book-b', 'book-c']);
  assert.equal('canRequest' in result.requestConstraints, false);
});

test('cada consulta personal filtra por el titular recibido; no devuelve identidades ajenas', async () => {
  for (const userId of ['ana', 'bea']) {
    const f = fixture();
    const result = await f.repository.findPersonalCirculation(userId);
    assert.deepEqual(f.owners, [userId, userId, userId]);
    assert.equal(JSON.stringify(result).includes('userId'), false);
    if (userId === 'bea') {
      assert.deepEqual(result.loans.map(loan => loan.id), ['other']);
      assert.equal(result.reservations[0]?.id, 'other');
      assert.deepEqual(result.waits, [{ id: 'other', book, joinedAt: at(-60), position: 5 }]);
    }
  }
});

test('listas vacías conservan el contrato y no consultan posiciones', async () => {
  const f = fixture({ empty: true });
  assert.deepEqual(await f.repository.findPersonalCirculation('ana'), {
    serverTime: now, loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] },
  });
  assert.equal(f.calls.includes('count'), false);
});

for (const clock of [null, new Date(NaN)]) {
  test(`reloj ausente o inválido impide devolver un resultado: ${String(clock)}`, async () => {
    const f = fixture({ clock });
    await assert.rejects(f.repository.findPersonalCirculation('ana'), { code: 'INTERNAL_ERROR' });
    assert.deepEqual(f.calls, []);
  });
}

for (const fail of ['loan', 'queue', 'reservation', 'count'] as const) {
  test(`fallo de ${fail} propaga el error y no entrega una fotografía parcial`, async () => {
    const error = new Error('Fallo simulado');
    const f = fixture({ fail, error });
    await assert.rejects(f.repository.findPersonalCirculation('ana'), caught => caught === error);
    assert.equal(f.transactions, 1);
  });
}
