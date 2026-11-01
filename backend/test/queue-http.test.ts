import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import type { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { tokenHash } from '../src/accounts/sessions.js';
import type { QueueCancellationFailure, QueueCancellationResult, QueueFailure, QueueResult } from '../src/circulation/queue.js';

const bookId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-29T12:00:00Z');
const later = new Date(now.getTime() + 3_600_000);
const tokens = { ana: 'a'.repeat(43), bea: 'b'.repeat(43) };
const entryId = '44444444-4444-4444-8444-444444444444';

async function fixture(t: TestContext, options: {
  code?: QueueFailure; state?: 'WAITING' | 'OFFERED'; existing?: boolean; error?: unknown; sessionError?: unknown;
  cancelCode?: QueueCancellationFailure; cancelError?: unknown; cancelOwner?: 'ana' | 'bea';
  cancelGate?: Promise<void>; cancelStarted?: () => void;
} = {}) {
  const calls: Array<{ userId: string; bookId: string }> = [];
  const cancelCalls: Array<{ userId: string; entryId: string }> = [];
  let sessionState: 'valid' | 'expired' | 'revoked' = 'valid';
  const unused = async (): Promise<never> => { throw new Error('Dependencia inesperada'); };
  const repository: AccountsRepository = {
    findUser: unused, createSession: unused, revokeSession: unused, listUniversities: unused,
    async findSession(hash) {
      if (options.sessionError) throw options.sessionError;
      const userId = Object.entries(tokens).find(([, token]) => tokenHash(token) === hash)?.[0];
      return userId ? { serverTime: now, session: {
        id: `session-${userId}`, createdAt: now,
        expiresAt: sessionState === 'expired' ? now : later,
        revokedAt: sessionState === 'revoked' ? now : null,
        user: { id: userId, firstName: userId, lastName: 'Prueba', email: `${userId}@example.invalid`,
          university: { id: 'university', name: 'Universidad' } },
      } } : null;
    },
  };
  const server = createApp({ checkDatabase: unused, checkStorage: unused, accounts: new AccountsService(repository),
    queue: { async joinQueue(userId, requestedBook): Promise<QueueResult> {
      calls.push({ userId, bookId: requestedBook });
      if (options.error) throw options.error;
      if (options.code) return { code: options.code };
      // Campos extra deliberados: el controlador debe serializar solo el DTO.
      const entry = { id: `entry-${userId}`, book: { id: requestedBook, title: 'Redes', pdfObjectKey: 'private.pdf' },
        joinedAt: now, userId, tokenHash: 'private-hash', orderSeq: 9999999999999999999n };
      return { serverTime: now, created: !options.existing,
        entry: options.state === 'OFFERED' ? { ...entry, state: 'OFFERED', position: null }
          : { ...entry, state: 'WAITING', position: 3 } };
    }, async cancelQueue(userId, requestedEntry): Promise<QueueCancellationResult> {
      cancelCalls.push({ userId, entryId: requestedEntry });
      options.cancelStarted?.();
      if (options.cancelGate) await options.cancelGate;
      if (options.cancelError) throw options.cancelError;
      if (requestedEntry !== entryId || userId !== (options.cancelOwner ?? 'ana')) return { code: 'QUEUE_ENTRY_NOT_FOUND' };
      if (options.cancelCode) return { code: options.cancelCode };
      return { closed: true };
    } },
    loans: { async requestLoan() { return { code: 'NO_AVAILABLE_COPIES' }; } },
    circulationQueries: { async findPersonalCirculation() { return { serverTime: now, loans: [], waits: [], reservations: [],
      requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } }; } },
  }).listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { calls, cancelCalls, base,
    setSessionState(value: typeof sessionState) { sessionState = value; },
    post(body: string = JSON.stringify({ bookId }), headers: Record<string, string> = {}) {
      return fetch(`${base}/api/queue-entries`, { method: 'POST', body,
        headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}`, ...headers } });
    },
  };
}

test('HTTP 201: contrato público, fechas ISO, no-store y ninguna cookie ni datos sensibles', async t => {
  const f = await fixture(t);
  const response = await f.post();
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  assert.deepEqual(body, { serverTime: now.toISOString(), entry: { id: 'entry-ana', book: { id: bookId, title: 'Redes' },
    state: 'WAITING', joinedAt: now.toISOString(), position: 3 } });
  for (const forbidden of ['userId', 'tokenHash', 'orderSeq', 'pdfObjectKey', 'private.pdf', 'private-hash', tokens.ana]) {
    assert.equal(JSON.stringify(body).includes(forbidden), false);
  }
  assert.deepEqual(f.calls, [{ userId: 'ana', bookId }]);
});

for (const fails of [false, true]) {
  test(`cancelación HTTP espera el commit/reasignación y oculta al sucesor; fallo=${fails}`, async t => {
    let release!: () => void; let fail!: (error: Error) => void; let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
    const f = await fixture(t, { cancelGate: gate, cancelStarted: started });
    let responded = false;
    const pending = fetch(`${f.base}/api/queue-entries/${entryId}/cancel?userId=bea`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1',
        Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}',
    }).then(response => { responded = true; return response; });
    await began;
    assert.equal(responded, false);
    assert.deepEqual(f.cancelCalls, [{ userId: 'ana', entryId }]);
    if (fails) fail(new Error('outbox: datos privados del sucesor'));
    else release();
    const response = await pending;
    assert.equal(response.status, fails ? 500 : 204);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    if (fails) assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' } });
    else assert.equal(await response.text(), '');
  });
}

test('cancelación HTTP: 204 vacío, no-store, sin cookie y titular exclusivamente de sesión', async t => {
  for (const owner of ['ana', 'bea'] as const) {
    const f = await fixture(t, { cancelOwner: owner });
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel?userId=otra-cuenta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1',
        Cookie: `biblioteca_session=${tokens[owner]}`, 'X-User-Id': 'otra-cuenta' }, body: '{}',
    });
    assert.equal(response.status, 204); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(f.cancelCalls, [{ userId: owner, entryId }]); assert.deepEqual(f.calls, []);
  }
});

test('cancelación HTTP: ajena e inexistente tienen exactamente el mismo 404', async t => {
  const f = await fixture(t);
  const cancel = (id: string, token: string) => fetch(`${f.base}/api/queue-entries/${id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${token}` }, body: '{}',
  });
  const foreign = await cancel(entryId, tokens.bea);
  const missing = await cancel(bookId, tokens.ana);
  assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
});

test('cancelación HTTP no necesita datos en el cuerpo: acepta ausencia, vacío y {}', async t => {
  const f = await fixture(t);
  for (const body of [undefined, '', '{}']) {
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` },
      ...(body === undefined ? {} : { body }),
    });
    assert.equal(response.status, 204); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(f.cancelCalls, Array.from({ length: 3 }, () => ({ userId: 'ana', entryId })));
  assert.deepEqual(f.calls, []);
});

for (const body of ['null', '[]', '"texto"', '{', '{"userId":"bea"}', '{"bookId":"otro"}']) {
  test(`cancelación HTTP: rechaza propiedades adicionales o JSON inválido (${body})`, async t => {
    const f = await fixture(t);
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body,
    });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    assert.deepEqual(f.cancelCalls, []);
  });
}

test('cancelación HTTP: UUID inválido no alcanza persistencia', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}/api/queue-entries/no-uuid/cancel`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
  assert.equal(response.status, 400); assert.deepEqual(f.cancelCalls, []);
});

for (const protection of ['', '0', 'true']) {
  test('cancelación HTTP: protección ausente/incorrecta devuelve 403', async t => {
    const f = await fixture(t);
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(protection ? { 'X-Biblioteca-Request': protection } : {}),
        Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
    assert.equal(response.status, 403); assert.deepEqual(f.cancelCalls, []);
  });
}

for (const state of ['absent', 'malformed', 'unknown', 'expired', 'revoked'] as const) {
  test(`cancelación HTTP: sesión ${state} devuelve 401 sin persistencia`, async t => {
    const f = await fixture(t);
    if (state === 'expired' || state === 'revoked') f.setSessionState(state);
    const cookie = state === 'absent' ? '' : `biblioteca_session=${state === 'malformed' ? 'invalid' : state === 'unknown' ? 'z'.repeat(43) : tokens.ana}`;
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: cookie }, body: '{}' });
    assert.equal(response.status, 401); assert.deepEqual(f.cancelCalls, []);
  });
}

for (const code of ['QUEUE_ENTRY_FULFILLED', 'CIRCULATION_RECONCILIATION_REQUIRED'] as const) {
  test(`cancelación HTTP: traduce ${code} sin informar éxito`, async t => {
    const f = await fixture(t, { cancelCode: code });
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
    assert.equal(response.status, code === 'QUEUE_ENTRY_FULFILLED' ? 409 : 503);
    assert.equal((await response.json()).error.code, code); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
  });
}

for (const unavailable of [false, true]) {
  test(`cancelación HTTP: error sanitizado de persistencia, dependencia no disponible=${unavailable}`, async t => {
    const f = await fixture(t, { cancelError: unavailable ? { code: 'P1001', message: 'credencial privada' } : new Error('credencial privada') });
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
    assert.equal(response.status, unavailable ? 503 : 500);
    const body = await response.json(); assert.equal(body.error.code, unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('credencial'), false); assert.equal(response.headers.get('set-cookie'), null);
  });
}

test('cancelación HTTP: reintentos explícitos devuelven 204 y no invocan la inscripción', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
    assert.equal(response.status, 204); assert.equal(await response.text(), '');
  }
  assert.equal(f.cancelCalls.length, 2); assert.deepEqual(f.calls, []);
  assert.equal((await f.post()).status, 201);
});

test('cancelación HTTP conserva el requisito JSON y el límite de 16 KiB', async t => {
  const f = await fixture(t);
  for (const type of ['', 'text/plain']) {
    const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
      headers: { ...(type ? { 'Content-Type': type } : {}), 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: '{}' });
    assert.equal(response.status, 415);
  }
  const response = await fetch(`${f.base}/api/queue-entries/${entryId}/cancel`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` }, body: JSON.stringify({ large: 'x'.repeat(16384) }) });
  assert.equal(response.status, 413); assert.deepEqual(f.cancelCalls, []);
});

test('titular exclusivamente desde sesión; ignora intentos de selección por URL y encabezados', async t => {
  const f = await fixture(t);
  for (const userId of ['ana', 'bea'] as const) {
    const response = await fetch(`${f.base}/api/queue-entries?userId=otra-cuenta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1',
        Cookie: `biblioteca_session=${tokens[userId]}`, 'X-User-Id': 'otra-cuenta' }, body: JSON.stringify({ bookId }),
    });
    assert.equal(response.status, 201); assert.equal((await response.json()).entry.id, `entry-${userId}`);
  }
  assert.deepEqual(f.calls, [{ userId: 'ana', bookId }, { userId: 'bea', bookId }]);
});

for (const state of ['WAITING', 'OFFERED'] as const) {
  test(`HTTP 200 devuelve entrada existente ${state}; OFFERED no inventa posición`, async t => {
    const f = await fixture(t, { existing: true, state });
    const response = await f.post();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entry.state, state); assert.equal(body.entry.id, 'entry-ana');
    assert.equal(body.entry.position, state === 'OFFERED' ? null : 3);
    assert.equal(body.entry.joinedAt, now.toISOString()); assert.equal(f.calls.length, 1);
  });
}

for (const cookie of ['', 'biblioteca_session=invalid', `biblioteca_session=${'z'.repeat(43)}`]) {
  test('cookie ausente, malformada o desconocida impide llamar al repositorio de cola', async t => {
    const f = await fixture(t);
    const response = await f.post(undefined, { Cookie: cookie });
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    assert.deepEqual(f.calls, []);
  });
}
for (const state of ['expired', 'revoked'] as const) {
  test(`sesión ${state}: 401 sin inscripción`, async t => {
    const f = await fixture(t); f.setSessionState(state);
    const response = await f.post();
    assert.equal(response.status, 401); assert.deepEqual(f.calls, []);
  });
}

for (const protection of ['', '0', 'true']) {
  test('protección de escritura ausente/incorrecta: 403 antes del repositorio', async t => {
    const f = await fixture(t);
    const response = protection ? await f.post(undefined, { 'X-Biblioteca-Request': protection })
      : await fetch(`${f.base}/api/queue-entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId }) });
    assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'REQUEST_NOT_ALLOWED');
    assert.deepEqual(f.calls, []);
  });
}

for (const body of [{}, null, [], { bookId: 1 }, { bookId: 'invalid' }, { bookId, userId: 'otra-cuenta' }]) {
  test(`body inválido o identidad extra: 400 sin persistencia (${JSON.stringify(body)})`, async t => {
    const f = await fixture(t);
    const response = await f.post(JSON.stringify(body));
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    assert.deepEqual(f.calls, []);
  });
}

test('JSON malformado y tamaño excesivo conservan errores del parser compartido', async t => {
  const f = await fixture(t);
  const malformed = await f.post('{');
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'VALIDATION_ERROR');
  const large = await f.post(JSON.stringify({ bookId, padding: 'x'.repeat(16 * 1024) }));
  assert.equal(large.status, 413); assert.equal((await large.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.deepEqual(f.calls, []);
});

test('Content-Type ausente o no JSON: 415 sin persistencia', async t => {
  const f = await fixture(t);
  const response = await f.post(undefined, { 'Content-Type': 'text/plain' });
  assert.equal(response.status, 415); assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  const absent = await fetch(`${f.base}/api/queue-entries`, { method: 'POST',
    headers: { 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` } });
  assert.equal(absent.status, 415); assert.deepEqual(f.calls, []);
});

const failures: Array<[QueueFailure, number]> = [
  ['BOOK_NOT_FOUND', 404], ['BOOK_ALREADY_BORROWED', 409], ['LOAN_LIMIT_REACHED', 409],
  ['AVAILABLE_COPIES', 409], ['CIRCULATION_RECONCILIATION_REQUIRED', 503],
];
for (const [code, status] of failures) {
  test(`traduce ${code} a ${status} sin cookie`, async t => {
    const f = await fixture(t, { code }); const response = await f.post();
    assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
  });
}

for (const stage of ['session', 'queue'] as const) {
  for (const unavailable of [true, false]) {
    test(`fallo sanitizado de ${stage}, dependencia no disponible=${unavailable}`, async t => {
      const error = Object.assign(new Error('detalle-interno'), unavailable ? { code: 'P1001' } : {});
      const f = await fixture(t, stage === 'session' ? { sessionError: error } : { error });
      const response = await f.post(); const text = await response.text();
      assert.equal(response.status, unavailable ? 503 : 500);
      assert.equal(JSON.parse(text).error.code, unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
      assert.equal(text.includes('detalle-interno'), false);
      assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
      if (stage === 'session') assert.deepEqual(f.calls, []);
    });
  }
}

test('no altera salud, consulta personal ni POST /api/loans', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/api/health`)).status, 200);
  const personal = await fetch(`${f.base}/api/me/circulation`, { headers: { Cookie: `biblioteca_session=${tokens.ana}` } });
  assert.equal(personal.status, 200); assert.deepEqual((await personal.json()).waits, []);
  const response = await fetch(`${f.base}/api/loans`, { method: 'POST', body: JSON.stringify({ bookId }),
    headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${tokens.ana}` } });
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'NO_AVAILABLE_COPIES');
  assert.deepEqual(f.calls, []);
});
