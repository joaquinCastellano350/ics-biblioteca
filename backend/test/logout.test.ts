import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import type { AccountsRepository, SessionRecord } from '../src/accounts/accounts.repository.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { SESSION_DURATION_MS, tokenHash } from '../src/accounts/sessions.js';

// Persistencia exclusivamente en memoria. No importa configuración ni clientes de base.
async function fixture(t: TestContext, production = false) {
  const now = new Date('2026-10-24T12:00:00Z');
  const tokens = { current: 'a'.repeat(43), otherDevice: 'b'.repeat(43), otherUser: 'c'.repeat(43) };
  const user = {
    id: 'user-a', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid',
    university: { id: 'university', name: 'Universidad de prueba' },
  };
  const sessions = new Map<string, SessionRecord>(Object.entries(tokens).map(([name, token]) => [
    tokenHash(token), {
      id: name, user: { ...user, id: name === 'otherUser' ? 'user-b' : user.id },
      createdAt: now, expiresAt: new Date(now.getTime() + SESSION_DURATION_MS), revokedAt: null,
    },
  ]));
  const calls: string[] = [];
  let persistenceError: Error | undefined;
  let waitForPersistence: Promise<void> | undefined;
  const unused = async (): Promise<never> => { throw new Error('Dependencia no prevista en logout.'); };
  const repository: AccountsRepository = {
    findUser: unused, createSession: unused, listUniversities: unused,
    findSession: async (hash) => {
      const session = sessions.get(hash);
      return session ? { session, serverTime: now } : null;
    },
    revokeSession: async (hash) => {
      calls.push(hash);
      await waitForPersistence;
      if (persistenceError) throw persistenceError;
      const session = sessions.get(hash);
      if (session && session.revokedAt === null) session.revokedAt = now;
    },
  };
  const accounts = new AccountsService(repository);
  const server = createApp({
    accounts, production, checkDatabase: unused, checkStorage: unused,
  }).listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const logout = (cookie?: string, options: { headers?: Record<string, string>; body?: string; query?: string } = {}) =>
    fetch(`${base}/api/auth/logout${options.query ?? ''}`, {
      method: 'POST',
      headers: { 'X-Biblioteca-Request': '1', ...(cookie === undefined ? {} : { Cookie: cookie }), ...options.headers },
      ...(options.body === undefined ? {} : { body: options.body }),
    });
  const currentSession = (token: string) => fetch(`${base}/api/auth/session`, {
    headers: { Cookie: `biblioteca_session=${token}` },
  });
  return {
    accounts, tokens, sessions, calls, logout, currentSession, now,
    failPersistence(error: Error) { persistenceError = error; },
    holdPersistence(promise: Promise<void>) { waitForPersistence = promise; },
  };
}

function clearedCookie(response: Response, production: boolean) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  const cookie = cookies[0]!;
  assert.match(cookie, /^biblioteca_session=;/);
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(attribute));
  assert.equal(cookie.includes('; Secure'), production);
  assert.equal(cookie.includes('Domain='), false);
  assert.equal(cookie.includes('Max-Age='), false);
  const expires = /Expires=([^;]+)/.exec(cookie)?.[1];
  assert.ok(expires);
  assert.ok(new Date(expires).getTime() < Date.now());
}

for (const production of [false, true]) {
  test(`logout sin cuerpo ni Content-Type confirma 204 y limpia cookie; producción=${production}`, async (t) => {
    const f = await fixture(t, production);
    assert.equal((await f.currentSession(f.tokens.current)).status, 200);
    const response = await f.logout(`biblioteca_session=${f.tokens.current}`);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    clearedCookie(response, production);
    assert.deepEqual(f.calls, [tokenHash(f.tokens.current)]);
    assert.equal((await f.currentSession(f.tokens.current)).status, 401);
    assert.equal((await f.currentSession(f.tokens.otherDevice)).status, 200);
    assert.equal((await f.currentSession(f.tokens.otherUser)).status, 200);
  });
}

test('cuerpo y parámetros no permiten seleccionar otra sesión ni otro usuario', async (t) => {
  const f = await fixture(t);
  const response = await f.logout(`biblioteca_session=${f.tokens.current}`, {
    query: `?userId=user-b&sessionId=otherUser&token=${f.tokens.otherUser}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.tokens.otherUser}` },
    body: JSON.stringify({ userId: 'user-b', sessionId: 'otherUser', token: f.tokens.otherUser, tokenHash: tokenHash(f.tokens.otherUser) }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(f.calls, [tokenHash(f.tokens.current)]);
  assert.equal((await f.currentSession(f.tokens.otherDevice)).status, 200);
  assert.equal((await f.currentSession(f.tokens.otherUser)).status, 200);
});

test('sin cookie o con cookie malformada limpia el navegador sin acceder al repositorio', async (t) => {
  const f = await fixture(t);
  for (const cookie of [undefined, 'biblioteca_session=', 'biblioteca_session=invalid',
    'biblioteca_session=%E0%A4%A', 'biblioteca_session=j%3A%7B%22id%22%3A1%7D']) {
    const response = await f.logout(cookie);
    assert.equal(response.status, 204);
    clearedCookie(response, false);
  }
  assert.deepEqual(f.calls, []);
  assert.equal((await f.currentSession(f.tokens.current)).status, 200);
});

for (const state of ['inexistente', 'vencida', 'revocada'] as const) {
  test(`sesión ${state}: logout idempotente sin reactivar ni extender sesiones`, async (t) => {
    const f = await fixture(t);
    const hash = tokenHash(f.tokens.current);
    const session = f.sessions.get(hash)!;
    if (state === 'inexistente') f.sessions.delete(hash);
    if (state === 'vencida') session.expiresAt = new Date(f.now.getTime() - 1);
    if (state === 'revocada') session.revokedAt = new Date(f.now.getTime() - 1000);
    const expiry = session.expiresAt;
    const previousRevocation = session.revokedAt;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.logout(`biblioteca_session=${f.tokens.current}`);
      assert.equal(response.status, 204);
      clearedCookie(response, false);
    }
    assert.deepEqual(f.calls, [hash, hash]);
    assert.equal(session.expiresAt, expiry);
    if (state === 'revocada') assert.equal(session.revokedAt, previousRevocation);
    assert.equal((await f.currentSession(f.tokens.current)).status, 401);
    assert.equal((await f.currentSession(f.tokens.otherDevice)).status, 200);
  });
}

test('encabezado ausente o incorrecto rechaza antes de revocar o limpiar la cookie', async (t) => {
  const f = await fixture(t);
  // Headers permite quitar el encabezado para comprobar ausencia real.
  for (const value of [undefined, '', '0', '2']) {
    const headers: Record<string, string> = { Cookie: `biblioteca_session=${f.tokens.current}` };
    if (value !== undefined) headers['X-Biblioteca-Request'] = value;
    // URL local del mismo servidor, sin usar el helper que agrega la protección.
    const sessionResponse = await f.currentSession(f.tokens.current);
    const response = await fetch(new URL('/api/auth/logout', sessionResponse.url), { method: 'POST', headers });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'REQUEST_NOT_ALLOWED');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(f.calls, []);
});

test('fallo de persistencia devuelve 503 sanitizado y conserva cookie y sesión', async (t) => {
  const f = await fixture(t);
  const detail = 'detalle-interno-de-persistencia';
  f.failPersistence(new Error(detail));
  const response = await f.logout(`biblioteca_session=${f.tokens.current}`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, 'SERVICE_UNAVAILABLE');
  for (const sensitive of [detail, f.tokens.current, tokenHash(f.tokens.current)]) assert.equal(body.includes(sensitive), false);
  assert.deepEqual(f.calls, [tokenHash(f.tokens.current)]);
  assert.equal((await f.currentSession(f.tokens.current)).status, 200);
});

test('el servicio espera la confirmación de persistencia antes de resolver logout', async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  f.holdPersistence(new Promise<void>((resolve) => { release = resolve; }));
  let completed = false;
  const result = f.accounts.logout(f.tokens.current).then(() => { completed = true; });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    assert.deepEqual(f.calls, [tokenHash(f.tokens.current)]);
  } finally { release(); }
  await result;
  assert.equal(completed, true);
});
