import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../../src/app.js';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { PrismaAccountsRepository } from '../../src/accounts/prisma-accounts.repository.js';
import { newSessionToken, tokenHash } from '../../src/accounts/sessions.js';
import { LoanRepository } from '../../src/circulation/loan-repository.js';
import { NotificationRepository } from '../../src/notifications/notification-repository.js';
import { NotificationWorker } from '../../src/notifications/notification-worker.js';
import { ResendEmailSender } from '../../src/notifications/resend-email-sender.js';
import { scheduleLoanNotifications } from '../../src/notifications/schedule-loan-notifications.js';
import type { EmailMessage } from '../../src/notifications/notification.js';
import { openNotificationsPostgresFixture, type NotificationsPostgresFixture } from './notifications-postgres-fixture.js';

describe('SCRUM-28: PostgreSQL 17 con conexiones independientes y proveedor simulado', { concurrency: false, timeout: 120_000 }, () => {
  let fixture: NotificationsPostgresFixture;
  before(async () => { fixture = await openNotificationsPostgresFixture(); });
  beforeEach(async () => { await fixture.reset(); });
  after(async () => { await fixture?.close(); });

  async function studentAndBook() {
    const university = await fixture.database.university.create({ data: { name: 'Universidad de pruebas' } });
    const user = await fixture.database.user.create({ data: { firstName: 'Ana', lastName: 'Prueba',
      email: 'ana@example.invalid', universityId: university.id, passwordHash: 'fixture-no-login' } });
    const book = await fixture.database.book.create({ data: { title: 'Lecturas <seguras> & compartidas',
      titleSearch: 'lecturas seguras compartidas', pdfObjectKey: 'fixture/no-existe.pdf', totalCopies: 1 } });
    return { user, book };
  }
  async function readyLoan(ageHours = 241) {
    const { user, book } = await studentAndBook();
    const [{ now } = { now: new Date(NaN) }] = await fixture.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    return fixture.database.$transaction(async tx => {
      const startedAt = new Date(now.getTime() - ageHours * 3_600_000);
      const loan = await tx.loan.create({ data: { userId: user.id, bookId: book.id,
        startedAt, dueAt: new Date(startedAt.getTime() + 480 * 3_600_000) } });
      await scheduleLoanNotifications(tx, loan);
      return loan;
    });
  }
  async function expireLease(id: string) {
    await fixture.query(`UPDATE notification_outbox SET claimed_at = clock_timestamp() - interval '2 minutes',
      lease_expires_at = clock_timestamp() - interval '1 minute' WHERE id = $1`, [id]);
  }
  const worker = (sender: { send(message: EmailMessage): Promise<string> }, database = fixture.database) =>
    new NotificationWorker(new NotificationRepository(database), sender, 'https://biblioteca.example.org');

  it('HTTP autenticado → tres hitos → HTML enviado por el adaptador → repetición sin otro correo', async t => {
    const { user, book } = await studentAndBook();
    const token = newSessionToken();
    const createdAt = new Date();
    await fixture.database.session.create({ data: { userId: user.id, tokenHash: tokenHash(token), createdAt,
      expiresAt: new Date(createdAt.getTime() + 6 * 3_600_000) } });
    const server = createApp({ checkDatabase: async () => {}, checkStorage: async () => {},
      accounts: new AccountsService(new PrismaAccountsRepository(fixture.database)),
      loans: new LoanRepository(fixture.database) }).listen(0, '127.0.0.1');
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/loans`;
    const post = () => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${token}` }, body: JSON.stringify({ bookId: book.id }),
      signal: AbortSignal.timeout(10_000) });
    const response = await post();
    assert.equal(response.status, 201);
    const { loan } = await response.json();
    const repeated = await post(); assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).loan.id, loan.id);
    const notices = await fixture.database.notificationOutbox.findMany({ orderBy: { scheduledAt: 'asc' } });
    assert.deepEqual(notices.map(n => n.scheduledAt.getTime() - Date.parse(loan.startedAt)),
      [864_000_000, 1_468_800_000, 1_728_000_000]);
    const requests: { html: string; text: string; to: string[] }[] = [];
    const sender = new ResendEmailSender('test-only', 'avisos@example.invalid', async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ id: `email-${requests.length}` });
    });
    await worker(sender).runBatch(); assert.equal(requests.length, 0);
    // Solo estos datos sintéticos: el préstamo sigue durando exactamente 480 horas.
    await fixture.query(`UPDATE loans SET started_at = started_at - interval '481 hours',
      due_at = due_at - interval '481 hours' WHERE id = $1`, [loan.id]);
    await fixture.query(`UPDATE notification_outbox SET scheduled_at = scheduled_at - interval '481 hours',
      next_attempt_at = next_attempt_at - interval '481 hours',
      payload = jsonb_set(payload, '{dueAt}', to_jsonb((SELECT due_at FROM loans WHERE id = $1)::text))
      WHERE loan_id = $1`, [loan.id]);
    await worker(sender).runBatch(); await worker(sender).runBatch();
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.deepEqual(request.to, [user.email]);
      assert.ok(request.html.includes('Lecturas &lt;seguras&gt; &amp; compartidas'));
      assert.ok(request.html.includes('https://biblioteca.example.org/prestamos'));
      assert.ok(request.text.includes('Lecturas <seguras> & compartidas'));
      assert.ok(!request.html.includes('fixture/no-existe.pdf'));
      assert.ok(!request.html.includes(token));
    }
    assert.equal(await fixture.database.notificationOutbox.count({ where: { state: 'SENT' } }), 3);
  });

  it('un fallo al insertar el segundo aviso revierte también el préstamo y el primer aviso', async () => {
    const { user, book } = await studentAndBook();
    await fixture.query('CREATE SEQUENCE notification_fault_attempts');
    await fixture.query(`CREATE FUNCTION fail_second_notice() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('notification_fault_attempts');
        IF NEW.kind = 'LOAN_DUE_IN_3_DAYS' THEN RAISE EXCEPTION 'TEST_NOTICE_ROLLBACK'; END IF;
        RETURN NEW; END $$`);
    await fixture.query(`CREATE TRIGGER fail_second_notice BEFORE INSERT ON notification_outbox
      FOR EACH ROW EXECUTE FUNCTION fail_second_notice()`);
    try {
      await assert.rejects(new LoanRepository(fixture.database).requestLoan(user.id, book.id));
      const [attempt] = await fixture.query<{ count: string }>('SELECT last_value::text AS count FROM notification_fault_attempts');
      assert.equal(attempt?.count, '2');
      assert.equal(await fixture.database.loan.count(), 0);
      assert.equal(await fixture.database.notificationOutbox.count(), 0);
    } finally {
      await fixture.query('DROP TRIGGER fail_second_notice ON notification_outbox');
      await fixture.query('DROP FUNCTION fail_second_notice()');
      await fixture.query('DROP SEQUENCE notification_fault_attempts');
    }
  });

  it('SKIP LOCKED salta una fila bloqueada por otra conexión sin esperar ni enviar esa fila', async () => {
    await readyLoan(481);
    const notices = await fixture.database.notificationOutbox.findMany({ orderBy: { scheduledAt: 'asc' } });
    const independent = fixture.newClient();
    await independent.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM notification_outbox WHERE id = ${notices[0]!.id}::uuid FOR UPDATE`;
      const first = await new NotificationRepository(fixture.database).claim();
      assert.equal(first?.id, notices[1]!.id);
      const second = await new NotificationRepository(fixture.database).claim();
      assert.equal(second?.id, notices[2]!.id);
      assert.equal(await new NotificationRepository(fixture.database).claim(), null);
    }, { timeout: 15_000 });
    assert.equal((await new NotificationRepository(fixture.database).claim())?.id, notices[0]!.id);
  });

  it('dos emisores se solapan realmente y cada uno entrega un aviso distinto una sola vez', async () => {
    await readyLoan(481);
    const firstDatabase = fixture.newClient(); const secondDatabase = fixture.newClient();
    let release!: () => void;
    const bothSending = new Promise<void>(resolve => { release = resolve; });
    let reject!: (error: Error) => void;
    const deadline = new Promise<never>((_, fail) => { reject = fail; });
    const timer = setTimeout(() => reject(new Error('Los dos emisores no alcanzaron el envío concurrente.')), 5_000);
    const keys: string[] = [];
    const sender = { async send(message: EmailMessage) {
      keys.push(message.idempotencyKey);
      if (keys.length === 2) release();
      await Promise.race([bothSending, deadline]);
      return `provider:${message.idempotencyKey}`;
    } };
    // El primer envío no puede terminar hasta que el segundo ya haya comenzado.
    try {
      await Promise.all([worker(sender, firstDatabase).runBatch(1), worker(sender, secondDatabase).runBatch(1)]);
    } finally { clearTimeout(timer); release(); }
    assert.equal(keys.length, 2); assert.equal(new Set(keys).size, 2);
    await worker(sender).runBatch(); await worker(sender).runBatch();
    assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 3);
    const notices = await fixture.database.notificationOutbox.findMany();
    assert.ok(notices.every(n => n.state === 'SENT' && n.attemptCount === 1 && n.claimToken === null));
  });

  it('caída después de aceptar el proveedor: otro cliente recupera la misma clave sin duplicar', async () => {
    await readyLoan();
    const original = fixture.newClient();
    const oldRepository = new NotificationRepository(original);
    const notice = await oldRepository.claim(); assert.ok(notice);
    const accepted = new Map<string, { body: string; id: string }>();
    let calls = 0;
    const sender = new ResendEmailSender('test-only', 'avisos@example.invalid', async (_url, init) => {
      calls++;
      const key = (init?.headers as Record<string, string>)['Idempotency-Key']!;
      const body = String(init?.body);
      if (accepted.has(key)) assert.equal(body, accepted.get(key)!.body);
      else accepted.set(key, { body, id: `provider-${accepted.size + 1}` });
      return Response.json({ id: accepted.get(key)!.id });
    });
    // Simula la frontera de caída: el proveedor acepta y no se confirma SENT.
    const { notificationMessage } = await import('../../src/notifications/notification-message.js');
    await sender.send(notificationMessage(notice, 'https://biblioteca.example.org/prestamos')!);
    await original.$disconnect();
    assert.equal((await fixture.database.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } })).state, 'PROCESSING');
    await worker(sender).runBatch(); assert.equal(calls, 1); // El plazo aún protege el aviso.
    await expireLease(notice.id);
    await worker(sender, fixture.newClient()).runBatch();
    assert.equal(calls, 2); assert.equal(accepted.size, 1);
    const sent = await fixture.database.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } });
    assert.equal(sent.state, 'SENT'); assert.equal(sent.attemptCount, 2);
    assert.equal(sent.firstAttemptAt?.getTime(), notice.firstAttemptAt?.getTime());
    // Un proceso antiguo no puede sobrescribir el resultado confirmado por el nuevo.
    await new NotificationRepository(fixture.database).finish(notice, { state: 'PENDING', error: 'STALE' });
    assert.deepEqual(await fixture.database.notificationOutbox.findUniqueOrThrow({ where: { id: notice.id } }), sent);
  });

  it('un proceso caído antes de enviar queda recuperable, pero el token vencido no puede enviar ni confirmar', async () => {
    await readyLoan();
    const repository = new NotificationRepository(fixture.newClient());
    const old = await repository.claim(); assert.ok(old);
    await expireLease(old.id);
    assert.equal(await repository.canSend(old), false);
    await repository.finish(old, { state: 'SENT', providerMessageId: 'stale' });
    assert.equal((await fixture.database.notificationOutbox.findUniqueOrThrow({ where: { id: old.id } })).state, 'PROCESSING');
    const messages: EmailMessage[] = [];
    await worker({ send: async message => { messages.push(message); return 'recovered'; } }).runBatch();
    assert.equal(messages.length, 1); assert.equal(messages[0]!.idempotencyKey, old.dedupKey);
  });

  it('una caída de 23 horas conserva el aviso para revisión sin volver a contactar al proveedor', async () => {
    await readyLoan();
    await fixture.query(`UPDATE notification_outbox SET first_attempt_at = clock_timestamp() - interval '23 hours',
      attempt_count = 1 WHERE kind = 'LOAN_DAY_10'`);
    let calls = 0;
    await worker({ send: async () => { calls++; return 'unexpected'; } }).runBatch();
    assert.equal(calls, 0);
    const failed = await fixture.database.notificationOutbox.findFirstOrThrow({ where: { kind: 'LOAN_DAY_10' } });
    assert.equal(failed.state, 'FAILED'); assert.equal(failed.lastError, 'DELIVERY_WINDOW_EXPIRED');
    assert.equal(await fixture.database.notificationOutbox.count(), 3);
  });

  it('HTTP 429 conserva el aviso y el contenido; otro emisor reintenta solo cuando corresponde', async () => {
    await readyLoan();
    const requests: string[] = [];
    const sender = new ResendEmailSender('test-only', 'avisos@example.invalid', async (_url, init) => {
      requests.push(String(init?.body));
      return requests.length === 1 ? new Response('private-provider-details', { status: 429 }) : Response.json({ id: 'recovered' });
    });
    await worker(sender).runBatch();
    const pending = await fixture.database.notificationOutbox.findFirstOrThrow({ where: { kind: 'LOAN_DAY_10' } });
    assert.equal(pending.state, 'PENDING'); assert.equal(pending.lastError, 'RESEND_HTTP_429');
    assert.equal(pending.attemptCount, 1); assert.ok(pending.firstAttemptAt);
    assert.equal(pending.claimToken, null);
    const [clock] = await fixture.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    assert.ok(pending.nextAttemptAt > clock!.now);
    await worker(sender, fixture.newClient()).runBatch(); assert.equal(requests.length, 1);
    await fixture.query('UPDATE notification_outbox SET next_attempt_at = scheduled_at WHERE id = $1', [pending.id]);
    await worker(sender, fixture.newClient()).runBatch();
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
    const sent = await fixture.database.notificationOutbox.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(sent.state, 'SENT'); assert.equal(sent.providerMessageId, 'recovered');
    assert.equal(sent.firstAttemptAt?.getTime(), pending.firstAttemptAt.getTime());
    assert.equal(sent.lastError, null);
  });

  it('un error permanente no bloquea el lote ni vuelve a enviarse automáticamente', async () => {
    const loan = await readyLoan(481);
    const requests: string[] = [];
    const sender = new ResendEmailSender('test-only', 'avisos@example.invalid', async (_url, init) => {
      const key = (init?.headers as Record<string, string>)['Idempotency-Key']!;
      requests.push(key);
      return key.endsWith(':day10') ? new Response('private-provider-details', { status: 422 }) : Response.json({ id: key });
    });
    await worker(sender).runBatch(1); assert.equal(requests.length, 1);
    await worker(sender).runBatch(); await worker(sender).runBatch();
    assert.deepEqual(requests, [`loan:${loan.id}:day10`, `loan:${loan.id}:due3`, `loan:${loan.id}:expired`]);
    const failed = await fixture.database.notificationOutbox.findFirstOrThrow({ where: { state: 'FAILED' } });
    assert.equal(failed.lastError, 'RESEND_HTTP_422'); assert.equal(failed.attemptCount, 1);
    assert.equal(await fixture.database.notificationOutbox.count({ where: { state: 'SENT' } }), 2);
  });
});
