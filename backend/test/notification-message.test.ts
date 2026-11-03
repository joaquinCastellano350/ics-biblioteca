import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NotificationOutbox } from '../src/generated/prisma/client.js';
import { notificationMessage } from '../src/notifications/notification-message.js';

function notice(kind: string, title = 'Cien años de soledad'): NotificationOutbox {
  return {
    id: 'notice', userId: 'student', loanId: 'loan', reservationId: null, queueEntryId: null,
    kind, dedupKey: `test:${kind}`, recipientEmail: 'student@example.invalid',
    payload: { bookTitle: title, dueAt: '2026-11-20T14:30:00.000Z', expiresAt: '2026-11-01T14:30:00.000Z' },
    scheduledAt: new Date(0), nextAttemptAt: new Date(0), state: 'PENDING', attemptCount: 0,
    firstAttemptAt: null, claimedAt: null, leaseExpiresAt: null, claimToken: null,
    sentAt: null, providerMessageId: null, lastError: null, createdAt: new Date(0),
  };
}

const cases = [
  ['LOAN_DAY_10', 'diez días', '2026-11-20T14:30:00.000Z'],
  ['LOAN_DUE_IN_3_DAYS', 'tres días', '2026-11-20T14:30:00.000Z'],
  ['LOAN_EXPIRED', 'finalizó', '2026-11-20T14:30:00.000Z'],
  ['TURN_AVAILABLE', '24 horas', '2026-11-01T14:30:00.000Z'],
  ['QUEUE_LIMIT_REJECTED', 'cinco préstamos', null],
] as const;

for (const [kind, explanation, deadline] of cases) {
  test(`correo ${kind}: HTML y texto conservan libro, motivo, plazo y destino`, () => {
    const input = notice(kind);
    const message = notificationMessage(input, 'https://biblioteca.example.org/prestamos');
    assert.ok(message);
    assert.equal(message.to, 'student@example.invalid');
    assert.equal(message.idempotencyKey, `test:${kind}`);
    for (const content of [message.html, message.text]) {
      assert.ok(content.includes('Cien años de soledad'));
      assert.ok(content.includes(explanation));
      assert.ok(content.includes('https://biblioteca.example.org/prestamos'));
    }
    if (deadline) {
      assert.ok(message.text.includes(deadline));
      assert.ok(message.html.includes(kind === 'TURN_AVAILABLE' ? '1 de noviembre de 2026' : '20 de noviembre de 2026'));
      assert.ok(message.html.includes('14:30 (UTC)'));
      assert.ok(!message.html.includes(deadline));
    }
    assert.match(message.html, /^<!doctype html>/i);
    assert.match(message.html, /<html[^>]*lang="es"[^>]*dir="ltr"/);
    assert.match(message.html, /<title>[^<]+<\/title>/);
    assert.equal((message.html.match(/<h1\b/g) ?? []).length, 1);
    assert.ok([...message.html.matchAll(/<table\b[^>]*>/g)].every(([table]) => table.includes('role="presentation"')));
    assert.match(message.html, /href="https:\/\/biblioteca.example.org\/prestamos"/);
    assert.ok(!message.html.includes('{{'));
    assert.ok(!message.html.includes('<script'));
    assert.ok(!message.html.includes('<img'));
    assert.deepEqual(notificationMessage(input, 'https://biblioteca.example.org/prestamos'), message);
  });
}

test('el título del libro nunca se interpreta como HTML ni como otro placeholder', () => {
  const title = '<img src=x onerror="alert(1)"> & \' {{actionUrl}}';
  const message = notificationMessage(notice('LOAN_DAY_10', title), 'https://biblioteca.example.org/prestamos');
  assert.ok(message);
  assert.ok(message.text.includes(title));
  assert.ok(message.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39; {{actionUrl}}'));
  assert.ok(!message.html.includes('<img'));
  assert.ok(!message.html.includes('href="<'));
});

test('contenido incompleto o tipo desconocido no produce un correo', () => {
  for (const kind of ['LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED', 'TURN_AVAILABLE', 'UNKNOWN']) {
    const input = notice(kind);
    input.payload = { bookTitle: 'Libro', dueAt: 'no-fecha', expiresAt: 'no-fecha' };
    assert.equal(notificationMessage(input, 'https://biblioteca.example.org/prestamos'), null);
  }
  for (const payload of [null, [], { bookTitle: ' ' }]) {
    assert.equal(notificationMessage({ ...notice('QUEUE_LIMIT_REJECTED'), payload }, 'https://biblioteca.example.org/prestamos'), null);
  }
});

test('SCRUM-26: nuevos turnos enlazan la aceptación y avisos históricos conservan su mensaje', () => {
  const historical = notice('TURN_AVAILABLE');
  historical.loanId = null;
  historical.reservationId = '11111111-1111-4111-8111-111111111111';
  const oldMessage = notificationMessage(historical, 'https://biblioteca.example.org/prestamos');
  assert.ok(oldMessage?.text.includes('https://biblioteca.example.org/prestamos'));
  assert.ok(oldMessage?.html.includes('>Ver préstamos y reservas</a>'));
  const current = { ...historical, payload: { bookTitle: 'Libro', expiresAt: '2026-11-02T12:00:00Z',
    acceptancePath: `/turno/${historical.reservationId}` } };
  const message = notificationMessage(current, 'https://biblioteca.example.org/prestamos');
  assert.ok(message?.text.includes(`https://biblioteca.example.org/turno/${historical.reservationId}`));
  assert.ok(message?.html.includes(`href="https://biblioteca.example.org/turno/${historical.reservationId}"`));
  assert.ok(message?.html.includes('>Aceptar préstamo</a>'));
  assert.ok(message?.text.includes('la aceptación continuará automáticamente'));
  assert.deepEqual(notificationMessage(historical, 'https://biblioteca.example.org/prestamos'), oldMessage);
  for (const acceptancePath of ['https://evil.example.org/', '/turno/otra-reserva']) {
    assert.equal(notificationMessage({ ...current, payload: { ...current.payload, acceptancePath } }, 'https://biblioteca.example.org/prestamos'), null);
  }
});
