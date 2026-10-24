import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import type { AccountsRepository, SessionRecord } from '../src/accounts/accounts.repository.js';
import { hashPassword } from '../src/accounts/credentials.js';
import { SESSION_DURATION_MS, sessionIsValid, tokenHash } from '../src/accounts/sessions.js';

test('la vigencia de la sesión tiene límite exclusivo y respeta revocación', () => {
  const createdAt = new Date('2026-10-22T12:00:00Z');
  const expiresAt = new Date(createdAt.getTime() + SESSION_DURATION_MS);
  const session = { createdAt, expiresAt, revokedAt: null };
  assert.equal(sessionIsValid(session, new Date(expiresAt.getTime() - 1)), true);
  assert.equal(sessionIsValid(session, expiresAt), false);
  assert.equal(sessionIsValid(session, new Date(expiresAt.getTime() + 1)), false);
  assert.equal(sessionIsValid({ ...session, revokedAt: createdAt }, createdAt), false);
});

test('HTTP rechaza escrituras sin protección, cuerpos inválidos y oculta fallos de base', async (t) => {
  const fail = async (): Promise<never> => { throw Object.assign(new Error('credencial-privada-no-exponer'), { code: 'P1001' }); };
  const accounts = new AccountsService({
    findUser: fail, findSession: fail, createSession: fail, revokeSession: fail, listUniversities: fail,
  });
  const server = createApp({ checkDatabase: async () => {}, checkStorage: async () => {}, accounts }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = (body: string, headers: Record<string, string> = {}) => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers, body,
  });
  const blocked = await login('{}', { 'Content-Type': 'application/json' });
  assert.equal(blocked.status, 403);
  const media = await login('{}', { 'X-Biblioteca-Request': '1' });
  assert.equal(media.status, 415);
  const headers = { 'X-Biblioteca-Request': '1', 'Content-Type': 'application/json' };
  assert.equal((await login('{', headers)).status, 400);
  assert.equal((await login('"' + 'x'.repeat(17000) + '"', headers)).status, 413);
  assert.equal((await login(JSON.stringify({ email: 'incorrecto', password: '' }), headers)).status, 400);
  const failed = await login(JSON.stringify({ email: 'persona@example.com', password: 'clave' }), headers);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.equal((await failed.text()).includes('credencial-privada'), false);
  assert.equal((await fetch(`${base}/api/auth/session`)).status, 401);
});

test('login y consulta conservan la respuesta pública y la cookie de seis horas', async (t) => {
  const createdAt = new Date('2026-10-22T12:00:00Z');
  const user = {
    id: 'usuario', firstName: 'Prueba', lastName: 'Login', email: 'persona@example.com',
    university: { id: 'universidad', name: 'Universidad de prueba' },
  };
  const passwordHash = await hashPassword('contraseña de prueba');
  let stored: { hash: string; session: SessionRecord } | undefined;
  const repository: AccountsRepository = {
    findUser: async (email) => email === user.email ? { id: user.id, passwordHash } : null,
    createSession: async (input) => {
      assert.equal(input.userId, user.id);
      assert.equal(input.durationMs, SESSION_DURATION_MS);
      assert.equal(input.previousTokenHash, tokenHash('a'.repeat(43)));
      const session = {
        id: 'sesión', user, createdAt, revokedAt: null,
        expiresAt: new Date(createdAt.getTime() + input.durationMs),
      };
      stored = { hash: input.tokenHash, session };
      return { session, serverTime: createdAt };
    },
    findSession: async (hash) => stored?.hash === hash ? { session: stored.session, serverTime: createdAt } : null,
    revokeSession: async (hash) => {
      if (stored?.hash === hash && stored.session.revokedAt === null) stored.session.revokedAt = createdAt;
    },
    listUniversities: async () => [user.university],
  };
  const server = createApp({
    checkDatabase: async () => {}, checkStorage: async () => {},
    accounts: new AccountsService(repository), production: true,
    books: { findAll: async () => [{ id: 'libro', title: 'Libro público', authors: [], subjects: [] }] },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await fetch(`${base}/api/books`);
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), {
    books: [{ id: 'libro', title: 'Libro público', authors: [], subjects: [] }],
  });
  assert.equal((await fetch(`${base}/api/books`, { method: 'POST' })).status, 405);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Biblioteca-Request': '1',
      Cookie: `biblioteca_session=${'a'.repeat(43)}`,
    },
    body: JSON.stringify({ email: '  PERSONA@example.com  ', password: 'contraseña de prueba' }),
  });
  assert.equal(login.status, 200);
  const expected = {
    user,
    session: { createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + SESSION_DURATION_MS).toISOString() },
    serverTime: createdAt.toISOString(),
  };
  assert.deepEqual(await login.json(), expected);
  const setCookie = login.headers.get('set-cookie')!;
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Expires=']) {
    assert.ok(setCookie.includes(attribute));
  }
  const cookie = setCookie.split(';')[0]!;
  assert.equal(stored?.hash, tokenHash(cookie.slice('biblioteca_session='.length)));
  const current = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), expected);
  assert.equal(current.headers.get('set-cookie'), null);
  const rejected = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' },
    body: JSON.stringify({ email: user.email, password: 'incorrecta' }),
  });
  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { error: {
    code: 'INVALID_CREDENTIALS', message: 'El correo o la contraseña son incorrectos.',
  } });
});

test('el origen común sirve la SPA sin convertir errores de API en HTML', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'biblioteca-spa-'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><h1>Biblioteca de prueba</h1>');
  const server = createApp({
    checkDatabase: async () => {}, checkStorage: async () => {}, frontendDirectory: folder,
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const deepLink = await fetch(`${base}/reservas/una-reserva`, { headers: { Accept: 'text/html' } });
  assert.equal(deepLink.status, 200);
  assert.match(await deepLink.text(), /Biblioteca de prueba/);
  const api = await fetch(`${base}/api/no-existe`, { headers: { Accept: 'text/html' } });
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error.code, 'NOT_FOUND');
});
