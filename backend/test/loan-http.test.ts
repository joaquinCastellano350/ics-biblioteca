import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { tokenHash } from '../src/accounts/sessions.js';
import type { LoanResult } from '../src/circulation/loan.js';

test('HTTP préstamo: sesión, protección de escritura, titularidad y errores seguros', async t => {
  const at = new Date('2026-10-27T12:00:00Z');
  const bookId = '11111111-1111-4111-8111-111111111111';
  const token = 'a'.repeat(43);
  const user = { id: 'usuario-autenticado', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org',
    university: { id: 'universidad', name: 'Prueba' } };
  let valid = true;
  const accounts = new AccountsService({
    findUser: async () => null, createSession: async () => { throw new Error('no usado'); },
    revokeSession: async () => {}, listUniversities: async () => [],
    findSession: async hash => hash === tokenHash(token) ? {
      session: { id: 'sesion', user, createdAt: at, expiresAt: new Date(at.getTime() + 6 * 3_600_000), revokedAt: valid ? null : at },
      serverTime: at,
    } : null,
  });
  let calls = 0;
  let failure: unknown;
  let result: LoanResult = { loan: { id: 'prestamo', bookId, startedAt: at, dueAt: new Date(at.getTime() + 480 * 3_600_000) }, created: true };
  const app = createApp({ accounts, checkDatabase: async () => {}, checkStorage: async () => {}, loans: {
    requestLoan: async (userId, targetId) => {
      calls++;
      assert.equal(userId, user.id);
      assert.equal(targetId, bookId);
      if (failure) throw failure;
      return result;
    },
  } });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/loans`;
  const headers = { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${token}` };
  const post = (body: unknown = { bookId }, customHeaders = headers) => fetch(url, { method: 'POST', headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await post({}, { 'Content-Type': 'application/json' } as typeof headers)).status, 403);
  assert.equal((await post({ bookId }, { ...headers, Cookie: '' })).status, 401);
  valid = false;
  assert.equal((await post()).status, 401);
  valid = true;
  assert.equal((await post({ bookId: 'invalido' })).status, 400);
  assert.equal(calls, 0);
  const created = await post({ bookId, userId: 'otra-persona' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await created.json(), { loan: { id: 'prestamo', bookId, startedAt: at.toISOString(), dueAt: new Date(at.getTime() + 480 * 3_600_000).toISOString() } });
  if (!('loan' in result)) throw new Error('Se esperaba un préstamo.');
  result = { loan: result.loan, created: false };
  assert.equal((await post()).status, 200);
  for (const code of ['NO_AVAILABLE_COPIES', 'LOAN_LIMIT_REACHED', 'OPEN_QUEUE_ENTRY', 'BOOK_NOT_FOUND'] as const) {
    result = { code };
    const response = await post();
    assert.equal(response.status, code === 'BOOK_NOT_FOUND' ? 404 : 409);
    assert.equal((await response.json()).error.code, code);
  }
  failure = Object.assign(new Error('datos-privados'), { code: 'P1001' });
  const unavailable = await post();
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('datos-privados'), false);
});
