import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { QueueRepository } from '../src/circulation/queue-repository.js';

const now = new Date('2026-10-29T12:00:00Z');
const at = (offset: number) => new Date(now.getTime() + offset);
const userId = '11111111-1111-4111-8111-111111111111';
const bookId = '22222222-2222-4222-8222-222222222222';
const otherBook = '33333333-3333-4333-8333-333333333333';
const order = 9007199254742000n;
type Loan = { userId: string; bookId: string; startedAt: Date; dueAt: Date; closedAt: Date | null };
type Entry = { id: string; userId: string; bookId: string; state: string; orderSeq: bigint; joinedAt: Date; closedAt: Date | null };
type Reservation = { bookId: string; queueEntryId: string; state: string; offeredAt: Date; expiresAt: Date; closedAt: Date | null };
const loan = (changes: Partial<Loan> = {}): Loan => ({ userId: 'another-student', bookId,
  startedAt: at(-100), dueAt: at(100), closedAt: null, ...changes });
const entry = (changes: Partial<Entry> = {}): Entry => ({ id: 'previous', userId: 'another-student', bookId,
  state: 'WAITING', orderSeq: 5n, joinedAt: at(-100), closedAt: null, ...changes });
const reservation = (changes: Partial<Reservation> = {}): Reservation => ({ bookId, queueEntryId: 'offer',
  state: 'HELD', offeredAt: at(-100), expiresAt: at(100), closedAt: null, ...changes });

/** Solo dobles: no crea PrismaClient, no conecta ni ejecuta SQL. */
function fixture(options: {
  loans?: Loan[]; entries?: Entry[]; reservations?: Reservation[]; totalCopies?: number;
  missingBook?: boolean; missingUser?: boolean; clock?: Date | null;
  transactionErrors?: unknown[]; createError?: unknown;
} = {}) {
  const loans = options.loans ?? [loan()];
  const entries = [...(options.entries ?? [])];
  const reservations = options.reservations ?? [];
  const transactions: unknown[] = [];
  const locks: string[] = [];
  const writes: unknown[] = [];
  const reads: string[] = [];
  const errors = [...(options.transactionErrors ?? [])];
  const active = (row: Loan) => row.closedAt === null && row.startedAt <= now && row.dueAt > now;
  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join('?');
      if (sql.includes('FROM users')) {
        assert.equal(sql, 'SELECT id FROM users WHERE id = ?::uuid FOR UPDATE');
        assert.deepEqual(values, [userId]); locks.push('user');
        return options.missingUser ? [] : [{ id: userId }];
      }
      if (sql.includes('FROM books')) {
        assert.equal(sql, 'SELECT id FROM books WHERE id = ?::uuid FOR UPDATE');
        assert.deepEqual(values, [bookId]); locks.push('book');
        return options.missingBook ? [] : [{ id: bookId }];
      }
      assert.equal(sql, 'SELECT clock_timestamp() AS now');
      assert.deepEqual(values, []); reads.push('clock');
      return options.clock === null ? [] : [{ now: options.clock ?? now }];
    },
    book: { async findUnique(args: Prisma.BookFindUniqueArgs) {
      assert.deepEqual(args, { where: { id: bookId }, select: { id: true, title: true, totalCopies: true } });
      return { id: bookId, title: 'Redes', totalCopies: options.totalCopies ?? 1 };
    } },
    loan: {
      async findFirst(args: Prisma.LoanFindFirstArgs) {
        reads.push('own-loan');
        assert.deepEqual(args, { where: { closedAt: null, startedAt: { lte: now }, dueAt: { gt: now }, userId, bookId }, select: { id: true } });
        return loans.some(row => row.userId === userId && row.bookId === bookId && active(row)) ? { id: 'own' } : null;
      },
      async count(args: Prisma.LoanCountArgs) {
        const where = args.where!;
        reads.push('loan-count');
        assert.equal(where.closedAt, null);
        if (where.startedAt) {
          assert.deepEqual(where.startedAt, { lte: now }); assert.deepEqual(where.dueAt, { gt: now });
          assert.ok(where.userId === userId || where.bookId === bookId);
          return loans.filter(row => active(row) && (where.userId ? row.userId === where.userId : row.bookId === where.bookId)).length;
        }
        assert.equal(where.bookId, bookId); assert.deepEqual(where.dueAt, { lte: now });
        return loans.filter(row => row.bookId === bookId && row.closedAt === null && row.dueAt <= now).length;
      },
    },
    reservation: { async count(args: Prisma.ReservationCountArgs) {
      const where = args.where!;
      reads.push('reservation-count');
      assert.equal(where.bookId, bookId); assert.equal(where.state, 'HELD');
      const rows = reservations.filter(row => row.bookId === bookId && row.state === 'HELD');
      if (where.OR) {
        assert.deepEqual(where.OR, [{ closedAt: { not: null } }, { offeredAt: { gt: now } },
          { queueEntry: { isNot: { state: 'OFFERED', closedAt: null } } }]);
        return rows.filter(row => row.closedAt !== null || row.offeredAt > now
          || !entries.some(e => e.id === row.queueEntryId && e.state === 'OFFERED' && e.closedAt === null)).length;
      }
      if ('gt' in (where.expiresAt as object)) {
        assert.deepEqual(where.expiresAt, { gt: now }); assert.equal(where.closedAt, null);
        return rows.filter(row => row.closedAt === null && row.expiresAt > now).length;
      }
      assert.deepEqual(where.expiresAt, { lte: now });
      return rows.filter(row => row.expiresAt <= now).length;
    } },
    queueEntry: {
      async findFirst(args: Prisma.QueueEntryFindFirstArgs) {
        reads.push('existing');
        assert.deepEqual(args.where, { bookId, userId, state: { in: ['WAITING', 'OFFERED'] }, closedAt: null });
        assert.deepEqual(args.select, { id: true, state: true, joinedAt: true, orderSeq: true });
        return entries.find(row => row.bookId === bookId && row.userId === userId && row.closedAt === null
          && ['WAITING', 'OFFERED'].includes(row.state)) ?? null;
      },
      async count(args: Prisma.QueueEntryCountArgs) {
        const where = args.where!;
        reads.push('queue-count');
        assert.equal(where.bookId, bookId); assert.equal(where.closedAt, null);
        const rows = entries.filter(row => row.bookId === bookId && row.closedAt === null && row.state === where.state);
        if (where.NOT) {
          assert.equal(where.state, 'OFFERED');
          assert.deepEqual(where.NOT, { reservation: { is: { state: 'HELD', closedAt: null, offeredAt: { lte: now }, expiresAt: { gt: now } } } });
          return rows.filter(row => !reservations.some(r => r.queueEntryId === row.id && r.state === 'HELD'
            && r.closedAt === null && r.offeredAt <= now && r.expiresAt > now)).length;
        }
        assert.equal(where.state, 'WAITING');
        if (where.orderSeq) {
          const limit = (where.orderSeq as { lt: bigint }).lt;
          assert.equal(typeof limit, 'bigint');
          assert.equal('userId' in where, false);
          return rows.filter(row => row.orderSeq < limit).length;
        }
        return rows.length;
      },
      async create(args: Prisma.QueueEntryCreateArgs) {
        assert.deepEqual(args.data, { userId, bookId, state: 'WAITING', joinedAt: now });
        writes.push(args.data);
        if (options.createError) throw options.createError;
        const created = entry({ id: 'new-entry', userId, orderSeq: order, joinedAt: now });
        entries.push(created);
        return created;
      },
    },
  };
  const database = { async $transaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>, settings: unknown) {
    transactions.push(settings);
    assert.deepEqual(settings, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
    if (errors.length) throw errors.shift();
    return operation(tx as unknown as Prisma.TransactionClient);
  } };
  return { repository: new QueueRepository(database as unknown as Pick<PrismaClient, '$transaction'>),
    transactions, locks, reads, writes, entries };
}

test('crea WAITING en una transacción, bloquea usuario/libro y usa un único reloj; respuesta pública', async () => {
  const f = fixture();
  assert.deepEqual(await f.repository.joinQueue(userId, bookId), { serverTime: now, created: true,
    entry: { id: 'new-entry', book: { id: bookId, title: 'Redes' }, joinedAt: now, state: 'WAITING', position: 1 } });
  assert.equal(f.transactions.length, 1); assert.deepEqual(f.locks, ['user', 'book']);
  assert.equal(f.reads.filter(read => read === 'clock').length, 1);
  assert.equal(f.writes.length, 1);
});

test('posición cuenta WAITING anteriores con huecos BigInt, no ofertas ni entradas terminales', async () => {
  const f = fixture({ entries: [entry({ id: 'first', orderSeq: 2n }), entry({ id: 'second', orderSeq: order - 5n }),
    entry({ id: 'closed', state: 'CANCELLED', closedAt: now }),
    entry({ id: 'offer', state: 'OFFERED' }), entry({ id: 'foreign', bookId: otherBook })],
    loans: [], reservations: [reservation()] });
  const result = await f.repository.joinQueue(userId, bookId);
  assert.ok(!('code' in result)); assert.equal(result.entry.position, 3);
  assert.equal(JSON.stringify(result).includes('orderSeq'), false);
  assert.equal(JSON.stringify(result).includes('userId'), false);
});

for (const state of ['WAITING', 'OFFERED'] as const) {
  test(`repetir ${state} devuelve la entrada sin moverla ni aplicar requisitos de ingreso nuevo`, async () => {
    const existing = entry({ userId, state, orderSeq: order, joinedAt: at(-50) });
    const f = fixture({ entries: [existing, entry({ id: 'ahead' })],
      loans: Array.from({ length: 5 }, () => loan({ userId })) });
    const result = await f.repository.joinQueue(userId, bookId);
    assert.ok(!('code' in result)); assert.equal(result.created, false);
    assert.equal(result.entry.id, existing.id); assert.equal(result.entry.joinedAt, existing.joinedAt);
    assert.equal(result.entry.state, state); assert.equal(result.entry.position, state === 'WAITING' ? 2 : null);
    assert.deepEqual(f.writes, []); assert.equal(f.reads.includes('own-loan'), false);
    assert.deepEqual(f.entries[0], existing);
  });
}

const rejected: Array<{ name: string; options: Parameters<typeof fixture>[0]; code: string }> = [
  { name: 'libro inexistente', options: { missingBook: true }, code: 'BOOK_NOT_FOUND' },
  { name: 'ya tiene el libro vigente', options: { loans: [loan({ userId })] }, code: 'BOOK_ALREADY_BORROWED' },
  { name: 'cinco préstamos activos', options: { loans: [loan(), ...Array.from({ length: 5 }, () => loan({ userId, bookId: otherBook }))] }, code: 'LOAN_LIMIT_REACHED' },
  { name: 'cupos libres sin esperas', options: { loans: [] }, code: 'AVAILABLE_COPIES' },
  { name: 'cupos libres con WAITING, aun si luego pudiera rechazarse por límite', options: { loans: [], entries: [entry()] }, code: 'CIRCULATION_RECONCILIATION_REQUIRED' },
  { name: 'préstamo vencido abierto en el límite exacto', options: { loans: [loan({ dueAt: now })] }, code: 'CIRCULATION_RECONCILIATION_REQUIRED' },
  { name: 'reserva vencida en el límite exacto', options: { loans: [], entries: [entry({ id: 'offer', state: 'OFFERED' })], reservations: [reservation({ expiresAt: now })] }, code: 'CIRCULATION_RECONCILIATION_REQUIRED' },
  { name: 'OFFERED sin reserva', options: { entries: [entry({ state: 'OFFERED' })] }, code: 'CIRCULATION_RECONCILIATION_REQUIRED' },
  { name: 'OFFERED con reserva terminal', options: { entries: [entry({ id: 'offer', state: 'OFFERED' })], reservations: [reservation({ state: 'EXPIRED', closedAt: now })] }, code: 'CIRCULATION_RECONCILIATION_REQUIRED' },
];
for (const scenario of rejected) {
  test(`rechazo sin escrituras: ${scenario.name}`, async () => {
    const f = fixture(scenario.options);
    const before = [...f.entries];
    assert.deepEqual(await f.repository.joinQueue(userId, bookId), { code: scenario.code });
    assert.deepEqual(f.writes, []); assert.deepEqual(f.entries, before);
  });
}

test('reservas vigentes ocupan cupo; WAITING no se rechaza ni se convierte en oferta sin capacidad', async () => {
  const f = fixture({ loans: [], entries: [entry({ id: 'offer', state: 'OFFERED' }), entry()], reservations: [reservation()] });
  const before = [...f.entries];
  const result = await f.repository.joinQueue(userId, bookId);
  assert.ok(!('code' in result)); assert.equal(result.entry.position, 2);
  assert.deepEqual(f.entries.slice(0, before.length), before);
});

test('no bloquea por conciliación de otros libros ni cuenta préstamos propios vencidos/cerrados', async () => {
  const f = fixture({ loans: [loan(), loan({ bookId: otherBook, dueAt: now }),
    ...Array.from({ length: 4 }, () => loan({ userId, bookId: otherBook })),
    loan({ userId, bookId: otherBook, dueAt: now }), loan({ userId, bookId: otherBook, closedAt: now })],
    entries: [entry({ id: 'other-offer', bookId: otherBook, state: 'OFFERED' })],
    reservations: [reservation({ bookId: otherBook, queueEntryId: 'other-offer', expiresAt: now })] });
  const result = await f.repository.joinQueue(userId, bookId);
  assert.ok(!('code' in result)); assert.equal(result.created, true);
});

test('una entrada terminal no se reabre: crea otra al final', async () => {
  const terminal = entry({ userId, state: 'REJECTED_LIMIT', closedAt: now });
  const f = fixture({ entries: [terminal] });
  const result = await f.repository.joinQueue(userId, bookId);
  assert.ok(!('code' in result)); assert.notEqual(result.entry.id, terminal.id);
  assert.deepEqual(f.entries[0], terminal);
});

for (const options of [{ totalCopies: 0 }, { loans: [], reservations: [reservation()] }, { clock: null }, { clock: new Date(NaN) }]) {
  test(`inconsistencia o reloj inválido produce fallo interno sin escrituras: ${Object.keys(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.repository.joinQueue(userId, bookId), { code: 'INTERNAL_ERROR' });
    assert.deepEqual(f.writes, []);
  });
}

test('usuario ausente no continúa con el libro ni escribe', async () => {
  const f = fixture({ missingUser: true });
  await assert.rejects(f.repository.joinQueue(userId, bookId), { code: 'AUTH_REQUIRED' });
  assert.deepEqual(f.locks, ['user']); assert.deepEqual(f.writes, []);
});

for (const error of [
  { code: 'P2034' }, { meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }, { code: '40P01' },
  { code: '23505', constraint: 'queue_entries_user_book_open_key' },
  { meta: { driverAdapterError: { cause: { originalCode: '23505', constraint: { index: 'queue_entries_user_book_open_key' } } } } },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { target: 'queue_entries_user_book_open_key' } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['userId', 'bookId'] } }),
]) {
  test(`reintenta una transacción nueva y relee la entrada ganadora: ${String((error as { code?: string }).code ?? 'anidado')}`, async () => {
    const f = fixture({ transactionErrors: [error], entries: [entry({ userId })] });
    const result = await f.repository.joinQueue(userId, bookId);
    assert.ok(!('code' in result)); assert.equal(result.created, false);
    assert.equal(f.transactions.length, 2); assert.deepEqual(f.writes, []);
    assert.deepEqual(f.locks, ['user', 'book']);
  });
}

test('agota tres intentos completos con SERVICE_UNAVAILABLE', async () => {
  const f = fixture({ transactionErrors: [{ code: 'P2034' }, { code: 'P2034' }, { code: 'P2034' }] });
  await assert.rejects(f.repository.joinQueue(userId, bookId), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.transactions.length, 3); assert.deepEqual(f.writes, []);
});

for (const error of [
  { code: 'P1001' }, new Error('persistencia'),
  { code: '23505', constraint: 'queue_entries_order_seq_key' },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry' } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['orderSeq'] } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'Other', target: ['userId', 'bookId'] } }),
]) {
  test('no confunde otros errores de persistencia/unicidad con la entrada abierta', async () => {
    const f = fixture({ transactionErrors: [error] });
    await assert.rejects(f.repository.joinQueue(userId, bookId), caught => caught === error);
    assert.equal(f.transactions.length, 1); assert.deepEqual(f.writes, []);
  });
}

test('un fallo de inserción se propaga; no devuelve una inscripción exitosa', async () => {
  const error = new Error('fallo al insertar');
  const f = fixture({ createError: error });
  await assert.rejects(f.repository.joinQueue(userId, bookId), caught => caught === error);
  assert.equal(f.writes.length, 1);
  // El rollback real y la exclusión mutua requieren PostgreSQL aislado: estos dobles no los prueban.
});
