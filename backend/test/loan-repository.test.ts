import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { LoanRepository } from '../src/circulation/loan-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('préstamo directo: reglas persistidas y avisos atómicos', async t => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  const repository = new LoanRepository(db);
  const university = await db.university.create({ data: { name: 'Prueba' } });
  let sequence = 0;
  const user = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', email: `prestamo-${++sequence}@example.org`,
    passwordHash: 'fixture', universityId: university.id } });
  const book = (totalCopies = 1) => db.book.create({ data: { title: 'Libro', titleSearch: 'libro',
    pdfObjectKey: 'privado.pdf', totalCopies } });
  const oldLoan = async (userId: string, bookId: string, hoursAgo = 1) => {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const startedAt = new Date(clock!.now.getTime() - hoursAgo * 3_600_000);
    return db.loan.create({ data: { userId, bookId, startedAt, dueAt: new Date(startedAt.getTime() + 480 * 3_600_000) } });
  };
  try {
    await t.test('480 horas, privacidad, tres avisos y repetición sin duplicados', async () => {
      const student = await user();
      const target = await book();
      const result = await repository.requestLoan(student.id, target.id);
      assert.ok('loan' in result && result.created);
      assert.equal(result.loan.dueAt.getTime() - result.loan.startedAt.getTime(), 480 * 3_600_000);
      assert.deepEqual(Object.keys(result.loan).sort(), ['bookId', 'dueAt', 'id', 'startedAt']);
      assert.deepEqual(await repository.requestLoan(student.id, target.id), { loan: result.loan, created: false });
      assert.equal(await db.loan.count({ where: { userId: student.id, bookId: target.id } }), 1);
      const notifications = await db.notificationOutbox.findMany({ where: { loanId: result.loan.id }, orderBy: { scheduledAt: 'asc' } });
      assert.deepEqual(notifications.map(n => n.kind), ['LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED']);
      assert.deepEqual(notifications.map(n => n.scheduledAt.getTime() - result.loan.startedAt.getTime()), [240, 408, 480].map(h => h * 3_600_000));
      assert.ok(notifications.every(n => n.userId === student.id && n.recipientEmail === student.email && n.state === 'PENDING'));
      assert.deepEqual(await repository.requestLoan((await user()).id, target.id), { code: 'NO_AVAILABLE_COPIES' });
    });
    await t.test('rechaza el sexto; repetir el quinto conserva su préstamo', async () => {
      const student = await user();
      const targets = await Promise.all(Array.from({ length: 6 }, () => book()));
      for (const target of targets.slice(0, 5)) await oldLoan(student.id, target.id);
      assert.deepEqual(await repository.requestLoan(student.id, targets[5]!.id), { code: 'LOAN_LIMIT_REACHED' });
      assert.ok('loan' in await repository.requestLoan(student.id, targets[0]!.id));
    });
    await t.test('cierra vencido del mismo libro antes de conceder otro', async () => {
      const student = await user();
      const target = await book();
      const expired = await oldLoan(student.id, target.id, 481);
      for (let i = 0; i < 4; i++) await oldLoan(student.id, (await book()).id);
      const result = await repository.requestLoan(student.id, target.id);
      assert.ok('loan' in result && result.created);
      const processed = await db.loan.findUniqueOrThrow({ where: { id: expired.id } });
      assert.ok(processed.closedAt);
      assert.ok(processed.closedAt >= processed.dueAt);
      assert.equal(processed.dueAt.getTime(), expired.dueAt.getTime());
    });
    await t.test('procesa el vencido y no deja que una solicitud directa adelante a la cola', async () => {
      const owner = await user();
      const requester = await user();
      const target = await book();
      const expired = await oldLoan(owner.id, target.id, 481);
      const waiting = await db.queueEntry.create({ data: { userId: requester.id, bookId: target.id } });

      assert.deepEqual(await repository.requestLoan((await user()).id, target.id), { code: 'NO_AVAILABLE_COPIES' });
      const processed = await db.loan.findUniqueOrThrow({ where: { id: expired.id } });
      assert.ok(processed.closedAt);
      assert.ok(processed.closedAt >= processed.dueAt);
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: waiting.id } })).state, 'OFFERED');
      assert.equal(await db.reservation.count({ where: { bookId: target.id, state: 'HELD' } }), 1);
      assert.equal(await db.loan.count({ where: { bookId: target.id, dueAt: { gt: processed.closedAt } } }), 0);
    });
    await t.test('respeta reserva vigente, espera ajena y espera propia', async () => {
      const owner = await user();
      const requester = await user();
      const reserved = await book();
      const entry = await db.queueEntry.create({ data: { userId: owner.id, bookId: reserved.id, state: 'OFFERED' } });
      const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      await db.reservation.create({ data: { queueEntryId: entry.id, userId: owner.id, bookId: reserved.id,
        offeredAt: clock!.now, expiresAt: new Date(clock!.now.getTime() + 24 * 3_600_000) } });
      assert.deepEqual(await repository.requestLoan(requester.id, reserved.id), { code: 'NO_AVAILABLE_COPIES' });
      assert.deepEqual(await repository.requestLoan(owner.id, reserved.id), { code: 'OPEN_QUEUE_ENTRY' });
      const queued = await book();
      await db.queueEntry.create({ data: { userId: owner.id, bookId: queued.id } });
      assert.deepEqual(await repository.requestLoan(owner.id, queued.id), { code: 'OPEN_QUEUE_ENTRY' });
      assert.deepEqual(await repository.requestLoan(requester.id, queued.id), { code: 'NO_AVAILABLE_COPIES' });
      assert.equal(await db.loan.count({ where: { bookId: queued.id } }), 0);
    });
    await t.test('finaliza reserva vencida y entrada juntas', async () => {
      const owner = await user();
      const target = await book();
      const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const offeredAt = new Date(clock!.now.getTime() - 25 * 3_600_000);
      const entry = await db.queueEntry.create({ data: { userId: owner.id, bookId: target.id, state: 'OFFERED', joinedAt: offeredAt } });
      const reservation = await db.reservation.create({ data: { userId: owner.id, bookId: target.id, queueEntryId: entry.id,
        offeredAt, expiresAt: new Date(offeredAt.getTime() + 24 * 3_600_000) } });
      assert.ok('loan' in await repository.requestLoan(owner.id, target.id));
      assert.equal((await db.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })).state, 'EXPIRED');
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).state, 'EXPIRED');
    });
    await t.test('fallo antes del commit revierte préstamo y avisos', async () => {
      const student = await user();
      const target = await book();
      const failing = { $transaction: ((operation, options) => db.$transaction(async tx => {
        await operation(tx);
        throw new Error('fallo antes del commit');
      }, options)) as PrismaClient['$transaction'] };
      await assert.rejects(new LoanRepository(failing).requestLoan(student.id, target.id), /fallo antes del commit/);
      assert.equal(await db.loan.count({ where: { userId: student.id } }), 0);
      assert.equal(await db.notificationOutbox.count({ where: { userId: student.id } }), 0);
    });
    await t.test('reintenta la transacción completa y limita intentos', async () => {
      const student = await user();
      const target = await book();
      let attempts = 0;
      const retry = { $transaction: ((operation, options) => {
        assert.equal(options?.isolationLevel, 'Serializable');
        if (++attempts < 3) return Promise.reject({ meta: { driverAdapterError: { cause: { originalCode: '40001' } } } });
        return db.$transaction(operation, options);
      }) as PrismaClient['$transaction'] };
      assert.ok('loan' in await new LoanRepository(retry).requestLoan(student.id, target.id));
      assert.equal(attempts, 3);
      attempts = 0;
      const duplicate = { $transaction: ((operation, options) => {
        if (++attempts === 1) return Promise.reject(new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002', clientVersion: '7.10.1', meta: { modelName: 'Loan' },
        }));
        return db.$transaction(operation, options);
      }) as PrismaClient['$transaction'] };
      const repeated = await new LoanRepository(duplicate).requestLoan(student.id, target.id);
      assert.ok('loan' in repeated && !repeated.created);
      assert.equal(attempts, 2);
      attempts = 0;
      const exhausted = { $transaction: (async () => { attempts++; throw { code: 'P2034' }; }) as PrismaClient['$transaction'] };
      await assert.rejects(new LoanRepository(exhausted).requestLoan(student.id, target.id), { code: 'SERVICE_UNAVAILABLE' });
      assert.equal(attempts, 3);
    });
    await t.test('libro inexistente', async () => {
      assert.deepEqual(await repository.requestLoan((await user()).id, '00000000-0000-4000-8000-000000000000'), { code: 'BOOK_NOT_FOUND' });
    });
  } finally { await fixture.close(); }
});
