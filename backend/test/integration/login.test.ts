import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { database } from '../../src/database.js';
import { createApp } from '../../src/app.js';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { PrismaAccountsRepository } from '../../src/accounts/prisma-accounts.repository.js';
import { hashPassword } from '../../src/accounts/credentials.js';
import { tokenHash, SESSION_DURATION_MS } from '../../src/accounts/sessions.js';

test('login y sesión de seis horas con PostgreSQL real, sin secretos ni sesiones duplicadas por fallo', async (t) => {
  const id = randomUUID();
  const email = `integration-${id}@example.com`;
  const password = ' con espacios ñ 漢字 ';
  const universityId = '00000000-0000-4000-8000-000000000029';
  const server = createApp({
    checkDatabase: async () => {}, checkStorage: async () => {},
    accounts: new AccountsService(new PrismaAccountsRepository(database)), production: true,
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.session.deleteMany({ where: { userId: id } });
    await database.user.deleteMany({ where: { id } });
    await database.$disconnect();
  });
  await once(server, 'listening');
  await database.user.create({ data: {
    id, firstName: 'Prueba', lastName: 'Integración', email, universityId,
    passwordHash: await hashPassword(password),
  } });
  await assert.rejects(database.user.create({ data: {
    firstName: 'Otra', lastName: 'Cuenta', email, universityId, passwordHash: 'no-usado',
  } }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = (credentials: { email: string; password: string }, cookie?: string) => fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(credentials),
  });
  const first = await login({ email: `  ${email.toUpperCase()}  `, password });
  assert.equal(first.status, 200);
  const setCookie = first.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=21600/);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const cookie = setCookie.split(';')[0]!;
  const token = cookie.slice('biblioteca_session='.length);
  const body = await first.json();
  assert.equal(body.user.email, email);
  assert.equal(body.user.university.id, universityId);
  assert.equal(Date.parse(body.session.expiresAt) - Date.parse(body.session.createdAt), SESSION_DURATION_MS);
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal(JSON.stringify(body).includes('password'), false);
  const stored = await database.session.findFirstOrThrow({ where: { userId: id } });
  assert.equal(stored.tokenHash, tokenHash(token));
  assert.notEqual(stored.tokenHash, token);
  const current = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(current.status, 200);
  assert.equal(current.headers.get('set-cookie'), null);
  assert.equal((await current.json()).session.expiresAt, body.session.expiresAt);
  const bad = await login({ email, password: 'incorrecta' }, cookie);
  const missing = await login({ email: 'no-existe@example.com', password });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), await missing.json());
  assert.equal(await database.session.count({ where: { userId: id } }), 1);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })).status, 200);
  const second = await login({ email, password }, cookie);
  assert.equal(second.status, 200);
  const nextCookie = second.headers.get('set-cookie')!.split(';')[0]!;
  assert.notEqual(nextCookie, cookie);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: nextCookie } })).status, 200);
  const nextToken = nextCookie.slice('biblioteca_session='.length);
  await database.$executeRaw`
    WITH instant AS (SELECT clock_timestamp()::timestamptz(3) AS now)
    UPDATE sessions SET created_at = instant.now - interval '6 hours', expires_at = instant.now
    FROM instant WHERE token_hash = ${tokenHash(nextToken)}
  `;
  const expired = await fetch(`${base}/api/auth/session`, { headers: { Cookie: nextCookie } });
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('set-cookie'), null);
  const universities = await fetch(`${base}/api/universities`);
  assert.equal((await universities.json()).universities.length, 30);
});
