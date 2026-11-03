import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoanRepository } from '../src/circulation/loan-repository.js';
import { NotificationRepository } from '../src/notifications/notification-repository.js';
import { NotificationWorker } from '../src/notifications/notification-worker.js';
import { EmailDeliveryError, type EmailMessage } from '../src/notifications/notification.js';
import { ResendEmailSender } from '../src/notifications/resend-email-sender.js';
import { scheduleLoanNotifications } from '../src/notifications/schedule-loan-notifications.js';
import { catalogDatabase } from './catalog-database.js';

test('Resend: HTTPS, idempotencia, errores controlados y tiempo acotado', async () => {
  const message = { to: 'destino@example.org', subject: 'Préstamo', text: 'Libro y vencimiento',
    html: '<p>Libro y vencimiento</p>', idempotencyKey: 'loan:uuid:expired' };
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options?.method, 'POST');
    assert.ok(options?.signal);
    assert.deepEqual(options?.headers, { Authorization: 'Bearer fixture', 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey });
    assert.deepEqual(JSON.parse(String(options?.body)), { from: 'biblioteca@example.org', to: [message.to],
      subject: message.subject, text: message.text, html: message.html });
    return Response.json({ id: 'provider-id' });
  };
  assert.equal(await new ResendEmailSender('fixture', 'biblioteca@example.org', request).send(message), 'provider-id');
  for (const status of [400, 401, 403, 409, 413, 422, 429, 500, 503]) {
    await assert.rejects(new ResendEmailSender('fixture', 'fixture', async () => new Response('private-body', { status })).send(message),
      error => error instanceof EmailDeliveryError && error.code === `RESEND_HTTP_${status}`
        && error.permanent === [400, 413, 422].includes(status));
  }
  for (const result of [null, {}, { id: 123 }]) {
    await assert.rejects(new ResendEmailSender('fixture', 'fixture', async () => Response.json(result)).send(message), { message: 'RESEND_INVALID_RESPONSE' });
  }
  await assert.rejects(new ResendEmailSender('fixture', 'fixture', async () => { throw new Error('private-key'); }).send(message),
    { message: 'RESEND_NETWORK_ERROR' });
});

test('SCRUM-28: programación, entrega durable y recuperación con PostgreSQL aislado', async t => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  const repository = new NotificationRepository(db);
  const messages: EmailMessage[] = [];
  const sender = { send: async (message: EmailMessage) => { messages.push(message); return 'provider-id'; } };
  const worker = () => new NotificationWorker(new NotificationRepository(db), sender, 'https://biblioteca.example.org');
  const hour = 3_600_000;
  try {
    const university = await db.university.create({ data: { name: 'Universidad de prueba' } });
    let sequence = 0;
    const createUser = () => db.user.create({ data: { firstName: 'Ana', lastName: 'Prueba', passwordHash: 'fixture',
      email: `aviso-${++sequence}@example.org`, universityId: university.id } });
    const createBook = () => db.book.create({ data: { title: '<Libro & título>', titleSearch: 'libro titulo', pdfObjectKey: 'private.pdf', totalCopies: 1 } });
    const loanAt = async (age: number, closed = false) => {
      const user = await createUser();
      const book = await createBook();
      return db.$transaction(async tx => {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        const startedAt = new Date(clock!.now.getTime() - age * hour);
        const loan = await tx.loan.create({ data: { userId: user.id, bookId: book.id, startedAt,
          dueAt: new Date(startedAt.getTime() + 480 * hour), ...(closed ? { closedAt: clock!.now } : {}) } });
        await scheduleLoanNotifications(tx, loan);
        return loan;
      });
    };
    t.beforeEach(async () => { await db.notificationOutbox.deleteMany(); messages.length = 0; });

    await t.test('concesión: tres fechas exactas, destinatario, deduplicación y ningún envío futuro', async () => {
      const user = await createUser();
      const book = await createBook();
      const loans = new LoanRepository(db);
      const result = await loans.requestLoan(user.id, book.id);
      assert.ok('loan' in result);
      const notices = await db.notificationOutbox.findMany({ where: { loanId: result.loan.id }, orderBy: { scheduledAt: 'asc' } });
      assert.deepEqual(notices.map(n => n.kind), ['LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED']);
      assert.deepEqual(notices.map(n => n.scheduledAt.getTime() - result.loan.startedAt.getTime()), [240, 408, 480].map(h => h * hour));
      assert.ok(notices.every(n => n.nextAttemptAt.getTime() === n.scheduledAt.getTime()
        && n.recipientEmail === user.email && n.userId === user.id && n.firstAttemptAt === null));
      assert.deepEqual(notices.map(n => n.dedupKey), ['day10', 'due3', 'expired'].map(suffix => `loan:${result.loan.id}:${suffix}`));
      await loans.requestLoan(user.id, book.id);
      await worker().runBatch();
      assert.equal(await db.notificationOutbox.count(), 3);
      assert.equal(messages.length, 0);
    });

    await t.test('procesa solo los hitos alcanzados; un aviso con next_attempt_at futuro espera', async () => {
      const loan = await loanAt(409);
      await db.notificationOutbox.updateMany({ where: { loanId: loan.id, kind: 'LOAN_DUE_IN_3_DAYS' },
        data: { nextAttemptAt: new Date(Date.now() + hour) } });
      await worker().runBatch();
      assert.equal(messages.length, 1);
      assert.equal(messages[0]?.idempotencyKey, `loan:${loan.id}:day10`);
      await db.notificationOutbox.updateMany({ where: { loanId: loan.id, kind: 'LOAN_DUE_IN_3_DAYS' }, data: { nextAttemptAt: new Date(0) } });
      await worker().runBatch();
      assert.equal(messages.length, 2);
      assert.equal(messages[1]?.idempotencyKey, `loan:${loan.id}:due3`);
      assert.equal(await db.notificationOutbox.count({ where: { state: 'PENDING' } }), 1);
    });

    await t.test('ciclo tardío envía los tres incluso después de cerrar el préstamo', async () => {
      const loan = await loanAt(481, true);
      await worker().runBatch();
      assert.equal(messages.length, 3);
      for (const message of messages) {
        assert.ok(message.text.includes('<Libro & título>'));
        assert.ok(message.text.includes(loan.dueAt.toISOString()));
        assert.ok(message.text.includes('UTC'));
        assert.ok(message.text.includes('https://biblioteca.example.org/prestamos'));
        assert.ok(!message.text.includes('puede retrasarse'));
        assert.ok(!message.html.includes('puede retrasarse'));
        assert.ok(!message.text.includes('private.pdf'));
      }
      assert.ok(messages[2]?.text.includes('El acceso de lectura finalizó'));
      assert.equal(await db.notificationOutbox.count({ where: { state: 'SENT', providerMessageId: 'provider-id' } }), 3);
      await db.$transaction(tx => scheduleLoanNotifications(tx, loan));
      await worker().runBatch();
      assert.equal(messages.length, 3);
      assert.equal(await db.notificationOutbox.count(), 3);
    });

    await t.test('dos emisores y otra ejecución no duplican la entrega', async () => {
      await loanAt(241);
      await Promise.all([worker().runBatch(), worker().runBatch()]);
      await worker().runBatch();
      assert.equal(messages.length, 1);
      const sent = await db.notificationOutbox.findFirstOrThrow({ where: { state: 'SENT' } });
      assert.equal(sent.attemptCount, 1);
      assert.equal(sent.claimToken, null);
      assert.ok(sent.sentAt);
    });

    await t.test('fallo de correo conserva fila, espera creciente y clave después de reiniciar emisor', async () => {
      const loan = await loanAt(241);
      const fail = new NotificationWorker(repository, { send: async () => { throw new Error('private-key'); } }, 'https://biblioteca.example.org');
      await fail.runBatch();
      const notice = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `loan:${loan.id}:day10` } });
      assert.equal(notice.state, 'PENDING');
      assert.equal(notice.lastError, 'EMAIL_DELIVERY_FAILED');
      assert.equal(notice.attemptCount, 1);
      assert.ok(notice.firstAttemptAt);
      assert.equal(await repository.claim(), null);
      await db.notificationOutbox.update({ where: { id: notice.id }, data: { nextAttemptAt: new Date(0) } });
      await fail.runBatch();
      const again = await db.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } });
      assert.equal(again.attemptCount, 2);
      assert.ok(again.nextAttemptAt.getTime() - Date.now() > 55_000);
      assert.equal(again.firstAttemptAt?.getTime(), notice.firstAttemptAt?.getTime());
      await db.notificationOutbox.update({ where: { id: notice.id }, data: { nextAttemptAt: new Date(0) } });
      await worker().runBatch();
      assert.equal(messages[0]?.idempotencyKey, notice.dedupKey);
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } })).state, 'SENT');
      assert.equal(await db.notificationOutbox.count(), 3);
    });

    await t.test('respuesta perdida después de aceptación reutiliza el mismo correo y clave', async () => {
      const loan = await loanAt(241);
      const accepted = new Map<string, string>();
      const requests: EmailMessage[] = [];
      const provider = { send: async (message: EmailMessage) => {
        requests.push(message);
        if (accepted.has(message.idempotencyKey)) return accepted.get(message.idempotencyKey)!;
        accepted.set(message.idempotencyKey, 'accepted-once');
        throw new Error('respuesta perdida');
      } };
      await new NotificationWorker(repository, provider, 'https://biblioteca.example.org').runBatch();
      await db.notificationOutbox.updateMany({ where: { loanId: loan.id, kind: 'LOAN_DAY_10' }, data: { nextAttemptAt: new Date(0) } });
      await new NotificationWorker(new NotificationRepository(db), provider, 'https://biblioteca.example.org').runBatch();
      assert.equal(accepted.size, 1);
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `loan:${loan.id}:day10` } })).providerMessageId, 'accepted-once');
    });

    await t.test('caída tras reclamar: otro emisor recupera y el token anterior no puede confirmar', async () => {
      await loanAt(241);
      const old = await repository.claim();
      assert.ok(old);
      assert.equal(await repository.claim(), null);
      await db.$executeRaw`UPDATE notification_outbox SET claimed_at = clock_timestamp() - interval '2 minutes',
        lease_expires_at = clock_timestamp() - interval '1 minute' WHERE id = ${old.id}::uuid`;
      const current = await new NotificationRepository(db).claim();
      assert.ok(current);
      assert.equal(current.id, old.id);
      assert.notEqual(current.claimToken, old.claimToken);
      assert.equal(current.attemptCount, 2);
      assert.equal(await repository.canSend(old), false);
      await repository.finish(old, { state: 'SENT', providerMessageId: 'stale' });
      await repository.finish(old, { state: 'CANCELLED' });
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: old.id } })).state, 'PROCESSING');
      await repository.finish(current, { state: 'SENT', providerMessageId: 'current' });
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: old.id } })).providerMessageId, 'current');
    });

    await t.test('fuera de ventana segura conserva FAILED y no vuelve a llamar al proveedor', async () => {
      const loan = await loanAt(241);
      await db.notificationOutbox.updateMany({ where: { loanId: loan.id, kind: 'LOAN_DAY_10' },
        data: { firstAttemptAt: new Date(Date.now() - 23 * hour), attemptCount: 1 } });
      await worker().runBatch();
      const notice = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `loan:${loan.id}:day10` } });
      assert.equal(notice.state, 'FAILED');
      assert.equal(notice.lastError, 'DELIVERY_WINDOW_EXPIRED');
      assert.equal(messages.length, 0);
      assert.equal(await repository.claim(), null);
      assert.equal(await db.notificationOutbox.count(), 3);
    });

    await t.test('primer envío atrasado no consume la ventana antes de reclamar', async () => {
      await loanAt(2_000, true);
      await worker().runBatch();
      assert.equal(messages.length, 3);
    });

    await t.test('payload inválido y fallo permanente quedan FAILED; se recupera la misma fila', async () => {
      const loan = await loanAt(241);
      const key = `loan:${loan.id}:day10`;
      const original = await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: key } });
      await db.notificationOutbox.update({ where: { id: original.id }, data: { payload: { bookTitle: 'Libro', dueAt: 'inválido' } } });
      await worker().runBatch();
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: original.id } })).lastError, 'INVALID_NOTIFICATION_PAYLOAD');
      assert.equal(messages.length, 0);
      await db.notificationOutbox.update({ where: { id: original.id }, data: { payload: original.payload!, state: 'PENDING', nextAttemptAt: new Date(0) } });
      await new NotificationWorker(repository, { send: async () => { throw new EmailDeliveryError('RESEND_HTTP_422', true); } }, 'https://biblioteca.example.org').runBatch();
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: original.id } })).state, 'FAILED');
      await db.notificationOutbox.update({ where: { id: original.id }, data: { state: 'PENDING', nextAttemptAt: new Date(0) } });
      await worker().runBatch();
      assert.equal(messages[0]?.idempotencyKey, key);
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: original.id } })).state, 'SENT');
    });

    await t.test('origen con titular ajeno no envía datos a otra cuenta', async () => {
      const loan = await loanAt(241);
      await db.notificationOutbox.updateMany({ where: { loanId: loan.id, kind: 'LOAN_DAY_10' }, data: { userId: (await createUser()).id } });
      await worker().runBatch();
      assert.equal(messages.length, 0);
      assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { dedupKey: `loan:${loan.id}:day10` } })).state, 'CANCELLED');
    });

    await t.test('conserva turnos vigentes y rechazos; cancela turnos vencidos antes de HTTPS', async () => {
      for (const expired of [false, true]) {
        const user = await createUser();
        const book = await createBook();
        const now = new Date();
        const offeredAt = new Date(now.getTime() - (expired ? 25 : 1) * hour);
        const expiresAt = new Date(offeredAt.getTime() + 24 * hour);
        const entry = await db.queueEntry.create({ data: { userId: user.id, bookId: book.id, state: 'OFFERED', joinedAt: offeredAt } });
        const reservation = await db.reservation.create({ data: { userId: user.id, bookId: book.id, queueEntryId: entry.id, offeredAt, expiresAt } });
        const notice = await db.notificationOutbox.create({ data: { userId: user.id, reservationId: reservation.id,
          kind: 'TURN_AVAILABLE', dedupKey: `reservation:${reservation.id}:turn`, recipientEmail: user.email,
          payload: { bookTitle: book.title, expiresAt: expiresAt.toISOString() }, scheduledAt: offeredAt, nextAttemptAt: offeredAt } });
        const before = messages.length;
        await worker().runBatch();
        assert.equal(messages.length - before, expired ? 0 : 1);
        assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } })).state, expired ? 'CANCELLED' : 'SENT');
      }
      const user = await createUser();
      const book = await createBook();
      const entry = await db.queueEntry.create({ data: { userId: user.id, bookId: book.id, state: 'REJECTED_LIMIT', joinedAt: new Date(0), closedAt: new Date() } });
      await db.notificationOutbox.create({ data: { userId: user.id, queueEntryId: entry.id,
        kind: 'QUEUE_LIMIT_REJECTED', dedupKey: `queue:${entry.id}:limit`, recipientEmail: user.email,
        payload: { bookTitle: book.title }, scheduledAt: new Date(0), nextAttemptAt: new Date(0) } });
      await worker().runBatch();
      assert.equal(messages.length, 2);
      assert.ok(messages[1]?.text.includes('cinco préstamos activos'));
    });
  } finally { await fixture.close(); }
});
