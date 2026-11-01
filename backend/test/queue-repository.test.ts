import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { QueueRepository } from '../src/circulation/queue-repository.js';
import { catalogDatabase } from './catalog-database.js';

const cancelId = '44444444-4444-4444-8444-444444444444';

const now = new Date('2026-10-29T12:00:00Z');
const at = (offset: number) => new Date(now.getTime() + offset);
const userId = '11111111-1111-4111-8111-111111111111';
const bookId = '22222222-2222-4222-8222-222222222222';
const order = 9007199254742000n;
type Entry = { id: string; userId: string; bookId: string; state: string; orderSeq: bigint; joinedAt: Date; closedAt: Date | null };
type CancellationReservation = Pick<Prisma.ReservationGetPayload<object>,
  'id' | 'queueEntryId' | 'userId' | 'bookId' | 'state' | 'offeredAt' | 'expiresAt' | 'closedAt'>;
const entry = (changes: Partial<Entry> = {}): Entry => ({ id: 'previous', userId: 'another-student', bookId,
  state: 'WAITING', orderSeq: 5n, joinedAt: at(-100), closedAt: null, ...changes });

// Dobles limitados a la clasificación de errores; las reglas se prueban con SQL.
function retries(errors: unknown[]) {
  const transactions: unknown[] = []; const writes: unknown[] = [];
  const tx = {
    async $queryRaw() { return [{ id: userId }]; },
    book: { async findUnique() { return null; } },
  };
  const database = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: unknown) {
    transactions.push(options);
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
    if (errors.length) throw errors.shift();
    return work(tx as unknown as Prisma.TransactionClient);
  } };
  // La relectura completa termina aquí con BOOK_NOT_FOUND, sin fingir el resultado SQL.
  const repository = new QueueRepository(database as unknown as Pick<PrismaClient, '$transaction'>);
  return { repository, transactions, writes };
}

for (const error of [
  { code: 'P2034' }, { meta: { driverAdapterError: { cause: { originalCode: '40001' } } } }, { code: '40P01' },
  { code: '23505', constraint: 'queue_entries_user_book_open_key' },
  { meta: { driverAdapterError: { cause: { originalCode: '23505', constraint: { index: 'queue_entries_user_book_open_key' } } } } },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { target: 'queue_entries_user_book_open_key' } }),
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['userId', 'bookId'] } }),
]) {
  test(`reintenta una transacción nueva y relee la entrada ganadora: ${String((error as { code?: string }).code ?? 'anidado')}`, async () => {
    const f = retries([error]);
    const result = await f.repository.joinQueue(userId, bookId);
    assert.deepEqual(result, { code: 'BOOK_NOT_FOUND' });
    assert.equal(f.transactions.length, 2); assert.deepEqual(f.writes, []);

  });
}

test('agota tres intentos completos con SERVICE_UNAVAILABLE', async () => {
  const f = retries([{ code: 'P2034' }, { code: 'P2034' }, { code: 'P2034' }]);
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
    const f = retries([error]);
    await assert.rejects(f.repository.joinQueue(userId, bookId), caught => caught === error);
    assert.equal(f.transactions.length, 1); assert.deepEqual(f.writes, []);
  });
}


test('unirse a cola integra conciliación, repetición y validaciones persistidas', async t => {
  const fixture = await catalogDatabase(); const db = fixture.client;
  try {
    const university = await db.university.create({ data: { name: 'Universidad' } });
    let seq = 0;
    const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: `cola-${++seq}@example.invalid`,
      universityId: university.id, passwordHash: 'fixture' } });
    const book = (totalCopies = 1) => db.book.create({ data: { title: 'Libro', titleSearch: 'libro', pdfObjectKey: 'fixture.pdf', totalCopies } });
    const repository = new QueueRepository(db);
    await t.test('sin capacidad crea una entrada y repetir conserva identidad y posición', async () => {
      const student = await user(); const target = await book(0);
      const created = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in created)); assert.equal(created.created, true); assert.equal(created.entry.position, 1);
      const again = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in again)); assert.equal(again.created, false); assert.deepEqual(again.entry, created.entry);
      assert.equal(await db.queueEntry.count({ where: { userId: student.id } }), 1);
    });
    await t.test('cupo pendiente se ofrece primero a la espera anterior y el recién llegado entra después', async () => {
      const first = await user(); const newcomer = await user(); const target = await book();
      const prior = await db.queueEntry.create({ data: { userId: first.id, bookId: target.id } });
      const created = await repository.joinQueue(newcomer.id, target.id);
      assert.ok(!('code' in created)); assert.equal(created.entry.state, 'WAITING'); assert.equal(created.entry.position, 1);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: prior.id } })).state, 'OFFERED');
      const repeated = await repository.joinQueue(first.id, target.id);
      assert.ok(!('code' in repeated)); assert.equal(repeated.created, false); assert.equal(repeated.entry.state, 'OFFERED');
      assert.equal(repeated.entry.position, null);
    });
    await t.test('cierra préstamo vencido antes de informar cupos disponibles', async () => {
      const student = await user(); const target = await book();
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${student.id}::uuid, ${target.id}::uuid,
          statement_timestamp() - interval '481 hours', statement_timestamp() - interval '1 hour')`;
      assert.deepEqual(await repository.joinQueue(student.id, target.id), { code: 'AVAILABLE_COPIES' });
      assert.ok((await db.loan.findFirstOrThrow({ where: { bookId: target.id } })).closedAt);
    });
    await t.test('no reabre terminales y rechaza sexto préstamo o libro propio vigente', async () => {
      const student = await user(); const target = await book(0);
      const terminal = await db.queueEntry.create({ data: { userId: student.id, bookId: target.id, state: 'CANCELLED', joinedAt: new Date(Date.now() - 3_600_000), closedAt: new Date() } });
      const result = await repository.joinQueue(student.id, target.id);
      assert.ok(!('code' in result)); assert.notEqual(result.entry.id, terminal.id);
      const borrowed = await book();
      await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
        VALUES (gen_random_uuid(), ${student.id}::uuid, ${borrowed.id}::uuid, statement_timestamp(), statement_timestamp() + interval '480 hours')`;
      assert.deepEqual(await repository.joinQueue(student.id, borrowed.id), { code: 'BOOK_ALREADY_BORROWED' });
      for (let i = 0; i < 4; i++) {
        const extra = await book();
        await db.$executeRaw`INSERT INTO loans (id, user_id, book_id, started_at, due_at)
          VALUES (gen_random_uuid(), ${student.id}::uuid, ${extra.id}::uuid, statement_timestamp(), statement_timestamp() + interval '480 hours')`;
      }
      assert.deepEqual(await repository.joinQueue(student.id, (await book(0)).id), { code: 'LOAN_LIMIT_REACHED' });
    });
  } finally { await fixture.close(); }
});

/** Doble transaccional: comprueba filtros, orden y propagación de fallos, NO el rollback de PostgreSQL. */
function cancellationFixture(options: {
  entries?: Entry[]; missingUser?: boolean; missingBook?: boolean; clock?: Date | null;
  revalidated?: Partial<Entry> | 'missing'; associatedReservation?: boolean; reservation?: CancellationReservation;
  totalCopies?: number; activeBookLoans?: number; held?: number; incoherent?: number;
  expiredLoans?: number; expiredReservations?: number; pendingOffers?: number;
  transactionErrors?: unknown[]; updateErrors?: unknown[]; commitError?: unknown; updateCount?: number;
} = {}) {
  const entries = structuredClone(options.entries ?? [entry({ id: cancelId, userId })]);
  const locks: string[] = []; const writes: Prisma.QueueEntryUpdateManyArgs[] = [];
  const transactions: unknown[] = []; const reads: string[] = [];
  const errors = [...(options.transactionErrors ?? [])]; const updateErrors = [...(options.updateErrors ?? [])];
  const changes: Array<() => void> = [];
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
      assert.equal(sql, 'SELECT clock_timestamp() AS now'); assert.deepEqual(values, []); reads.push('clock');
      return options.clock === null ? [] : [{ now: options.clock ?? now }];
    },
    queueEntry: {
      async findFirst(args: Prisma.QueueEntryFindFirstArgs) {
        assert.equal(args.where!.id, cancelId); assert.equal(args.where!.userId, userId);
        if (!args.where!.bookId) {
          reads.push('locate'); assert.deepEqual(args.select, { bookId: true });
          const target = entries.find(e => e.id === cancelId && e.userId === userId);
          return target ? { bookId: target.bookId } : null;
        }
        assert.deepEqual(locks.slice(-2), ['user', 'book']); assert.equal(args.where!.bookId, bookId);
        assert.deepEqual(args.select, { state: true, joinedAt: true, closedAt: true }); reads.push('revalidate');
        if (options.revalidated === 'missing') return null;
        const target = entries.find(e => e.id === cancelId && e.userId === userId && e.bookId === bookId);
        return target ? { ...target, ...options.revalidated } : null;
      },
      async count(args: Prisma.QueueEntryCountArgs) {
        const where = args.where!; assert.equal(where.bookId, bookId); assert.equal(where.closedAt, null);
        if (where.state === 'OFFERED') {
          assert.deepEqual(where.NOT, { reservation: { is: { state: 'HELD', closedAt: null, offeredAt: { lte: now }, expiresAt: { gt: now } } } });
          return options.pendingOffers ?? 0;
        }
        assert.equal(where.state, 'WAITING');
        return entries.filter(e => e.bookId === bookId && e.state === 'WAITING' && e.closedAt === null).length;
      },
      async updateMany(args: Prisma.QueueEntryUpdateManyArgs) {
        writes.push(args);
        assert.deepEqual(args.where, { id: cancelId, userId, bookId, state: 'WAITING', closedAt: null });
        assert.deepEqual(args.data, { state: 'CANCELLED', closedAt: now });
        if (updateErrors.length) throw updateErrors.shift();
        const target = entries.find(e => e.id === cancelId && e.userId === userId && e.bookId === bookId && e.state === 'WAITING' && e.closedAt === null);
        if (options.updateCount === 0 || !target) return { count: 0 };
        changes.push(() => { target.state = 'CANCELLED'; target.closedAt = now; });
        return { count: 1 };
      },
    },
    book: { async findUnique(args: Prisma.BookFindUniqueArgs) {
      assert.deepEqual(args, { where: { id: bookId }, select: { totalCopies: true } });
      return { totalCopies: options.totalCopies ?? 1 };
    } },
    loan: { async count(args: Prisma.LoanCountArgs) {
      const where = args.where!; assert.equal(where.bookId, bookId); assert.equal(where.closedAt, null);
      // Salir no consulta la cantidad de préstamos del titular ni sus otros libros.
      assert.equal('userId' in where, false);
      if (where.startedAt) {
        assert.deepEqual(where.startedAt, { lte: now }); assert.deepEqual(where.dueAt, { gt: now });
        return options.activeBookLoans ?? 1;
      }
      assert.deepEqual(where.dueAt, { lte: now }); return options.expiredLoans ?? 0;
    } },
    reservation: {
      async findUnique(args: Prisma.ReservationFindUniqueArgs) {
        assert.deepEqual(args, { where: { queueEntryId: cancelId }, select: {
          id: true, queueEntryId: true, userId: true, bookId: true, state: true,
          offeredAt: true, expiresAt: true, closedAt: true,
        } });
        assert.deepEqual(locks.slice(-2), ['user', 'book']);
        return options.reservation ?? (options.associatedReservation ? {
          id: 'reservation', queueEntryId: cancelId, userId, bookId, state: 'EXPIRED',
          offeredAt: at(-50), expiresAt: new Date(at(-50).getTime() + 24 * 3_600_000), closedAt: now,
        } : null);
      },
      async count(args: Prisma.ReservationCountArgs) {
        const where = args.where!; assert.equal(where.bookId, bookId); assert.equal(where.state, 'HELD');
        if (where.OR) return options.incoherent ?? 0;
        if ('gt' in (where.expiresAt as object)) {
          assert.deepEqual(where.expiresAt, { gt: now }); assert.equal(where.closedAt, null);
          return options.held ?? 0;
        }
        assert.deepEqual(where.expiresAt, { lte: now }); return options.expiredReservations ?? 0;
      },
    },
    // No hay métodos para escribir reservas, avisos, préstamos ni nuevas entradas.
  };
  const database = { async $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, settings: unknown) {
    transactions.push(settings); changes.length = 0;
    assert.deepEqual(settings, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
    if (errors.length) throw errors.shift();
    try {
      const result = await operation(tx as unknown as Prisma.TransactionClient);
      if (options.commitError) throw options.commitError;
      for (const change of changes) change();
      return result;
    } finally { changes.length = 0; }
  } };
  return { repository: new QueueRepository(database as unknown as Pick<PrismaClient, '$transaction'>),
    entries, reads, locks, writes, transactions };
}

test('cancelar WAITING usa una transacción, orden usuario→libro, relectura y reloj PG; conserva las otras entradas', async () => {
  const other = entry({ id: 'other', orderSeq: 3n });
  const f = cancellationFixture({ entries: [entry({ id: cancelId, userId }), other] });
  const original = structuredClone(f.entries);
  assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
  assert.equal(f.transactions.length, 1); assert.deepEqual(f.locks, ['user', 'book']);
  assert.deepEqual(f.reads, ['locate', 'revalidate', 'clock']); assert.equal(f.writes.length, 1);
  assert.deepEqual(f.entries[0], { ...original[0], state: 'CANCELLED', closedAt: now });
  assert.deepEqual(f.entries[1], original[1]);
  assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
  assert.equal(f.writes.length, 1); // No sobrescribe el cierre al repetir.
});

for (const foreign of [false, true]) {
  test(`cancelación inexistente/ajena: mismo resultado y sin bloquear otros libros (${foreign})`, async () => {
    const f = cancellationFixture({ entries: foreign ? [entry({ id: cancelId, userId: 'otra-persona' })] : [] });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { code: 'QUEUE_ENTRY_NOT_FOUND' });
    assert.deepEqual(f.locks, ['user']); assert.deepEqual(f.writes, []);
  });
}

for (const state of ['CANCELLED', 'EXPIRED', 'REJECTED_LIMIT']) {
  test(`cancelación idempotente ${state}: conserva fecha, estado y una inscripción nueva del mismo par`, async () => {
    const old = entry({ id: cancelId, userId, state, closedAt: at(-20) });
    const current = entry({ id: 'new-entry', userId, orderSeq: order });
    const f = cancellationFixture({ entries: [old, current] }); const original = structuredClone(f.entries);
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
    assert.deepEqual(f.entries, original); assert.deepEqual(f.writes, []);
  });
}

test('FULFILLED devuelve conflicto sin alterar el préstamo ni la entrada', async () => {
  const f = cancellationFixture({ entries: [entry({ id: cancelId, userId, state: 'FULFILLED', closedAt: at(-20) })] });
  assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { code: 'QUEUE_ENTRY_FULFILLED' });
  assert.deepEqual(f.writes, []);
});

for (const associatedReservation of [false, true]) {
  test(`OFFERED sin reserva HELD coherente exige conciliación (${associatedReservation})`, async () => {
    const f = cancellationFixture({ entries: [entry({ id: cancelId, userId, state: 'OFFERED' })], associatedReservation });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { code: 'CIRCULATION_RECONCILIATION_REQUIRED' });
    assert.deepEqual(f.writes, []);
  });
}

test('WAITING con una reserva asociada no se cierra aisladamente', async () => {
  const f = cancellationFixture({ associatedReservation: true });
  await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'INTERNAL_ERROR' });
  assert.deepEqual(f.writes, []);
});

const heldReservation = (): CancellationReservation => ({ id: 'held', queueEntryId: cancelId, userId, bookId,
  state: 'HELD', offeredAt: at(-50), expiresAt: new Date(at(-50).getTime() + 24 * 3_600_000), closedAt: null });

for (const changes of [
  { userId: 'otra-persona' }, { bookId: 'otro-libro' }, { queueEntryId: 'otra-entrada' },
  { state: 'CONSUMED' }, { closedAt: now }, { offeredAt: at(1) }, { expiresAt: now },
  { offeredAt: new Date(NaN) }, { expiresAt: new Date(NaN) },
]) {
  test(`OFFERED rechaza reserva incoherente sin escrituras: ${Object.keys(changes)}`, async () => {
    const f = cancellationFixture({ entries: [entry({ id: cancelId, userId, state: 'OFFERED' })],
      reservation: { ...heldReservation(), ...changes } });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { code: 'CIRCULATION_RECONCILIATION_REQUIRED' });
    assert.deepEqual(f.writes, []); assert.deepEqual(f.locks, ['user', 'book']);
  });
}

for (const state of ['CANCELLED', 'EXPIRED', 'REJECTED_LIMIT']) {
  test(`terminal ${state} no informa éxito si conserva una reserva HELD`, async () => {
    const f = cancellationFixture({ entries: [entry({ id: cancelId, userId, state, closedAt: now })], reservation: heldReservation() });
    await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'INTERNAL_ERROR' });
    assert.deepEqual(f.writes, []);
  });
  test(`terminal ${state} con reserva cerrada coherente conserva idempotencia`, async () => {
    const f = cancellationFixture({ entries: [entry({ id: cancelId, userId, state, closedAt: now })],
      reservation: { ...heldReservation(), state, closedAt: now } });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
    assert.deepEqual(f.writes, []);
  });
}

for (const error of [
  { code: 'P2002', meta: { modelName: 'Reservation', target: ['queueEntryId'] } },
  { code: 'P2002', meta: { modelName: 'NotificationOutbox', target: ['dedupKey'] } },
]) {
  test('cancelación comparte reintentos limitados por colisiones de conciliación', async () => {
    const f = cancellationFixture({ transactionErrors: [error] });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
    assert.equal(f.transactions.length, 2);
    const exhausted = cancellationFixture({ transactionErrors: [error, error, error] });
    await assert.rejects(exhausted.repository.cancelQueue(userId, cancelId), { code: 'SERVICE_UNAVAILABLE' });
    assert.equal(exhausted.transactions.length, 3); assert.deepEqual(exhausted.writes, []);
  });
}

for (const options of [{ expiredLoans: 1 }, { expiredReservations: 1 }, { pendingOffers: 1 }, { activeBookLoans: 0 }]) {
  test(`cancelación con conciliación pendiente no escribe: ${Object.keys(options)}`, async () => {
    const f = cancellationFixture(options); const original = structuredClone(f.entries);
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { code: 'CIRCULATION_RECONCILIATION_REQUIRED' });
    assert.deepEqual(f.writes, []); assert.deepEqual(f.entries, original);
  });
}

test('una reserva vigente de otra entrada puede ocupar el cupo sin ser modificada', async () => {
  const f = cancellationFixture({ activeBookLoans: 0, held: 1 });
  assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
  assert.equal(f.writes.length, 1);
});

test('salir no exige elegibilidad para entrar: ninguna consulta de límite del estudiante', async () => {
  const f = cancellationFixture();
  // El doble rechaza cualquier conteo por userId; tener cinco préstamos no es un filtro de salida.
  assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
});

for (const revalidated of ['missing', { state: 'OFFERED' }, { state: 'CANCELLED', closedAt: at(-10) }] as const) {
  test(`revalida la entrada después del bloqueo: ${JSON.stringify(revalidated)}`, async () => {
    const f = cancellationFixture({ revalidated });
    const expected = revalidated === 'missing' ? { code: 'QUEUE_ENTRY_NOT_FOUND' }
      : revalidated.state === 'OFFERED' ? { code: 'CIRCULATION_RECONCILIATION_REQUIRED' } : { closed: true };
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), expected); assert.deepEqual(f.writes, []);
  });
}

for (const error of [{ code: 'P2034' }, { code: '40P01' }, { cause: { originalCode: '40001' } }]) {
  test('cancelación reintenta la transacción completa ante conflictos reconocidos', async () => {
    const f = cancellationFixture({ updateErrors: [error] });
    assert.deepEqual(await f.repository.cancelQueue(userId, cancelId), { closed: true });
    assert.equal(f.transactions.length, 2); assert.deepEqual(f.locks, ['user', 'book', 'user', 'book']);
    assert.equal(f.reads.filter(read => read === 'clock').length, 2);
  });
}

test('cancelación agota tres intentos y no confirma éxito', async () => {
  const f = cancellationFixture({ transactionErrors: Array.from({ length: 3 }, () => ({ code: 'P2034' })) });
  await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.transactions.length, 3); assert.deepEqual(f.writes, []);
});

for (const error of [{ code: '23505', constraint: 'queue_entries_user_book_open_key' },
  new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'QueueEntry', target: ['userId', 'bookId'] } }),
  { code: 'P1001' }, new Error('persistencia')]) {
  test('cancelación no reutiliza los reintentos de unicidad de inscripción ni oculta otros errores', async () => {
    const f = cancellationFixture({ transactionErrors: [error] });
    await assert.rejects(f.repository.cancelQueue(userId, cancelId), caught => caught === error);
    assert.equal(f.transactions.length, 1); assert.deepEqual(f.writes, []);
  });
}

test('fallo del commit simulado se propaga sin informar éxito; rollback real queda pendiente', async () => {
  const error = new Error('commit fallido'); const f = cancellationFixture({ commitError: error });
  const original = structuredClone(f.entries);
  await assert.rejects(f.repository.cancelQueue(userId, cancelId), caught => caught === error);
  assert.equal(f.writes.length, 1); assert.deepEqual(f.entries, original);
});

test('cero filas afectadas no se interpreta como cancelación exitosa', async () => {
  const f = cancellationFixture({ updateCount: 0 });
  await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'SERVICE_UNAVAILABLE' });
});

for (const options of [{ clock: null }, { clock: new Date(NaN) }, { missingBook: true },
  { incoherent: 1 }, { activeBookLoans: 2 },
  { revalidated: { state: 'CANCELLED', closedAt: null } }, { revalidated: { state: 'WAITING', closedAt: now } },
  { revalidated: { state: 'UNKNOWN' } }, { revalidated: { joinedAt: at(1) } }]) {
  test(`cancelación rechaza inconsistencias sin escrituras: ${Object.keys(options)}`, async () => {
    const f = cancellationFixture(options);
    await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'INTERNAL_ERROR' });
    assert.deepEqual(f.writes, []);
  });
}

test('cancelación sin estudiante persistido devuelve AUTH_REQUIRED antes de leer la entrada', async () => {
  const f = cancellationFixture({ missingUser: true });
  await assert.rejects(f.repository.cancelQueue(userId, cancelId), { code: 'AUTH_REQUIRED' });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});

test('cancelación OFFERED integra liberación, reasignación y rollback con PGlite aislado', async t => {
  const fixture = await catalogDatabase(); const db = fixture.client;
  try {
    const university = await db.university.create({ data: { name: 'Universidad ficticia de cancelación' } });
    let sequence = 0;
    const user = () => db.user.create({ data: { firstName: 'Estudiante', lastName: 'Prueba',
      email: `salida-${++sequence}@example.invalid`, passwordHash: 'fixture', universityId: university.id } });
    const book = (totalCopies = 1) => db.book.create({ data: { title: 'Libro de cancelación', titleSearch: 'libro',
      pdfObjectKey: 'fixture.pdf', totalCopies } });
    const repository = new QueueRepository(db);
    async function prepare(count = 3) {
      const target = await book(0);
      const students = []; const entries = [];
      for (let i = 0; i < count; i++) {
        const student = await user(); students.push(student);
        entries.push(await db.queueEntry.create({ data: { userId: student.id, bookId: target.id } }));
      }
      await db.book.update({ where: { id: target.id }, data: { totalCopies: 1 } });
      // La inscripción existente reutiliza SCRUM-25 y ofrece el primer turno.
      const result = await repository.joinQueue(students[0]!.id, target.id);
      assert.ok(!('code' in result)); assert.equal(result.entry.state, 'OFFERED');
      const held = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: entries[0]!.id } });
      return { target, students, entries, held };
    }
    const snapshot = async (id: string) => ({
      entries: await db.queueEntry.findMany({ where: { bookId: id }, orderBy: { orderSeq: 'asc' } }),
      reservations: await db.reservation.findMany({ where: { bookId: id }, orderBy: { id: 'asc' } }),
      notices: await db.notificationOutbox.findMany({ where: { reservation: { bookId: id } }, orderBy: { id: 'asc' } }),
    });

    await t.test('propia HELD: cancela, ofrece al siguiente por FIFO y registra un aviso sin revelar su identidad', async () => {
      const f = await prepare();
      assert.deepEqual(await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id), { closed: true });
      const closed = await db.reservation.findUniqueOrThrow({ where: { id: f.held.id } });
      assert.equal(closed.state, 'CANCELLED'); assert.ok(closed.closedAt);
      const oldEntry = await db.queueEntry.findUniqueOrThrow({ where: { id: f.entries[0]!.id } });
      assert.equal(oldEntry.state, 'CANCELLED'); assert.deepEqual(oldEntry.closedAt, closed.closedAt);
      const next = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: f.entries[1]!.id } });
      assert.equal(next.userId, f.students[1]!.id); assert.equal(next.state, 'HELD');
      assert.equal(next.expiresAt.getTime() - next.offeredAt.getTime(), 24 * 3_600_000);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: f.entries[2]!.id } })).state, 'WAITING');
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: next.id, kind: 'TURN_AVAILABLE' } }), 1);
      const before = await snapshot(f.target.id);
      assert.deepEqual(await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id), { closed: true });
      assert.deepEqual(await snapshot(f.target.id), before);
    });

    await t.test('ajena e inexistente devuelven lo mismo y no alteran reservas ni avisos', async () => {
      const f = await prepare(); const before = await snapshot(f.target.id);
      assert.deepEqual(await repository.cancelQueue(f.students[1]!.id, f.entries[0]!.id), { code: 'QUEUE_ENTRY_NOT_FOUND' });
      assert.deepEqual(await repository.cancelQueue(f.students[1]!.id, '00000000-0000-4000-8000-000000000000'), { code: 'QUEUE_ENTRY_NOT_FOUND' });
      assert.deepEqual(await snapshot(f.target.id), before);
    });

    await t.test('rechaza al sucesor con cinco préstamos y ofrece al siguiente elegible', async () => {
      const f = await prepare(); const startedAt = f.held.offeredAt;
      for (let i = 0; i < 5; i++) await db.loan.create({ data: { userId: f.students[1]!.id, bookId: (await book()).id,
        startedAt, dueAt: new Date(startedAt.getTime() + 480 * 3_600_000) } });
      await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: f.entries[1]!.id } })).state, 'REJECTED_LIMIT');
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { queueEntryId: f.entries[2]!.id } })).userId, f.students[2]!.id);
      assert.equal(await db.notificationOutbox.count({ where: { queueEntryId: f.entries[1]!.id, kind: 'QUEUE_LIMIT_REJECTED' } }), 1);
    });

    await t.test('no ofrece al sucesor que ya tiene ese libro prestado', async () => {
      const f = await prepare(); const startedAt = f.held.offeredAt;
      await db.book.update({ where: { id: f.target.id }, data: { totalCopies: 2 } });
      await db.loan.create({ data: { userId: f.students[1]!.id, bookId: f.target.id,
        startedAt, dueAt: new Date(startedAt.getTime() + 480 * 3_600_000) } });
      await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id);
      assert.equal(await db.reservation.count({ where: { queueEntryId: f.entries[1]!.id } }), 0);
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { queueEntryId: f.entries[2]!.id } })).state, 'HELD');
    });

    await t.test('sin sucesor libera capacidad sin inventar reservas ni avisos nuevos', async () => {
      const f = await prepare(1);
      await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id);
      assert.equal(await db.reservation.count({ where: { bookId: f.target.id, state: 'HELD' } }), 0);
      assert.equal(await db.reservation.count({ where: { bookId: f.target.id } }), 1);
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: f.held.id } }), 1);
    });

    await t.test('reserva vencida termina EXPIRED sin renovar plazo, y reasigna con una reserva nueva', async () => {
      const f = await prepare(); const offeredAt = new Date(f.held.offeredAt.getTime() - 25 * 3_600_000);
      const expiresAt = new Date(offeredAt.getTime() + 24 * 3_600_000);
      await db.queueEntry.update({ where: { id: f.entries[0]!.id }, data: { joinedAt: offeredAt } });
      await db.reservation.update({ where: { id: f.held.id }, data: { offeredAt, expiresAt } });
      await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id);
      const old = await db.reservation.findUniqueOrThrow({ where: { id: f.held.id } });
      assert.equal(old.state, 'EXPIRED'); assert.deepEqual(old.expiresAt, expiresAt);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: f.entries[0]!.id } })).state, 'EXPIRED');
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { queueEntryId: f.entries[1]!.id } })).state, 'HELD');
    });

    for (const table of ['reservations', 'notification_outbox'] as const) {
      await t.test(`fallo al insertar ${table} revierte salida, reserva nueva y outbox`, async () => {
        const f = await prepare(); const before = await snapshot(f.target.id);
        await db.$executeRawUnsafe(`CREATE FUNCTION fail_cancel_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'SCRUM24_ROLLBACK_TEST'; END; $$`);
        try {
          await db.$executeRawUnsafe(`CREATE TRIGGER fail_cancel_reassignment BEFORE INSERT ON ${table}
            FOR EACH ROW EXECUTE FUNCTION fail_cancel_reassignment()`);
          await assert.rejects(repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id));
          assert.deepEqual(await snapshot(f.target.id), before);
        } finally {
          await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_cancel_reassignment ON ${table}`);
          await db.$executeRawUnsafe('DROP FUNCTION fail_cancel_reassignment()');
        }
        assert.deepEqual(await repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id), { closed: true });
      });
    }

    await t.test('dos llamadas solapadas conservan una sola reasignación (pool local de una conexión)', async () => {
      const f = await prepare();
      const results = await Promise.all([1, 2].map(() => repository.cancelQueue(f.students[0]!.id, f.entries[0]!.id)));
      assert.deepEqual(results, [{ closed: true }, { closed: true }]);
      assert.equal(await db.reservation.count({ where: { bookId: f.target.id } }), 2);
      const successor = await db.reservation.findUniqueOrThrow({ where: { queueEntryId: f.entries[1]!.id } });
      assert.equal(await db.notificationOutbox.count({ where: { reservationId: successor.id } }), 1);
    });
  } finally { await fixture.close(); }
});
