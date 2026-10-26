import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { accountErrorHandler, accountsController, requireSession, type SessionIdentity } from '../src/accounts/accounts.controller.js';
import type { AccountsRepository, SessionRecord } from '../src/accounts/accounts.repository.js';
import { SESSION_DURATION_MS, tokenHash } from '../src/accounts/sessions.js';

test('el middleware comprueba cada lectura/escritura antes del handler, incluso con cookie conservada', async (t) => {
  const token = 'a'.repeat(43);
  const createdAt = new Date('2026-10-25T12:00:00Z');
  const expiresAt = new Date(createdAt.getTime() + SESSION_DURATION_MS);
  let serverTime = createdAt;
  let unavailable = false;
  let lookups = 0;
  const session: SessionRecord = {
    id: 'sesión', createdAt, expiresAt, revokedAt: null,
    user: { id: 'titular', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'universidad', name: 'Universidad' } },
  };
  const unused = async (): Promise<never> => { throw new Error('No debe ejecutarse'); };
  const repository: AccountsRepository = {
    findUser: unused, createSession: unused, revokeSession: unused, listUniversities: unused,
    findSession: async (hash) => {
      lookups++;
      if (unavailable) throw Object.assign(new Error('base privada'), { code: 'P1001' });
      return hash === tokenHash(token) ? { session, serverTime } : null;
    },
  };
  const accounts = new AccountsService(repository);
  const app = express();
  app.use('/api', accountsController(accounts, false));
  let reads = 0;
  let writes = 0;
  const identities: SessionIdentity[] = [];
  // Estos endpoints existen únicamente en la prueba, sin inventar circulación productiva.
  app.get('/api/private', requireSession(accounts), (_req, res) => {
    reads++;
    identities.push(res.locals['identity']);
    res.json({ userId: res.locals['identity'].userId });
  });
  app.post('/api/private', requireSession(accounts), (_req, res) => {
    writes++;
    identities.push(res.locals['identity']);
    res.status(204).end();
  });
  app.use(accountErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, cookie?: string) => fetch(`${base}/api/private?userId=otra-cuenta`, {
    method, headers: {
      'X-Biblioteca-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
    }, ...(method === 'POST' ? { body: JSON.stringify({ userId: 'otra-cuenta' }) } : {}),
  });
  const cookie = `biblioteca_session=${token}`;
  for (const method of ['GET', 'POST']) {
    for (const missing of [undefined, 'biblioteca_session=malformado', `biblioteca_session=${'b'.repeat(43)}`]) {
      const response = await call(method, missing);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
  // La hora de Node no interviene: el repositorio entrega el reloj autoritativo.
  serverTime = new Date(expiresAt.getTime() - 1);
  assert.equal((await call('GET', cookie)).status, 200);
  assert.equal((await call('POST', cookie)).status, 204);
  assert.deepEqual(identities, [
    { userId: 'titular', sessionId: 'sesión', expiresAt },
    { userId: 'titular', sessionId: 'sesión', expiresAt },
  ]);
  const beforeExpiry = { reads, writes };
  for (const time of [expiresAt, new Date(expiresAt.getTime() + 1)]) {
    serverTime = time;
    for (const method of ['GET', 'POST']) {
      const response = await call(method, cookie);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  assert.deepEqual({ reads, writes }, beforeExpiry);
  serverTime = createdAt;
  session.revokedAt = createdAt;
  assert.equal((await call('GET', cookie)).status, 401);
  session.revokedAt = null;
  unavailable = true;
  for (const method of ['GET', 'POST']) {
    const failed = await call(method, cookie);
    assert.equal(failed.status, 503);
    assert(!JSON.stringify(await failed.json()).includes('base privada'));
  }
  assert.deepEqual({ reads, writes }, beforeExpiry);
  assert.equal(lookups, 11);
  assert.equal(session.expiresAt, expiresAt);
});
