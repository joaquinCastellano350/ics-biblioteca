import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { tokenHash } from '../src/accounts/sessions.js';
import type { ReservationResult } from '../src/circulation/reservation.js';

test('SCRUM-26 HTTP: sesión, CSRF, identidad, repetición y errores sin secretos', async t => {
  const at = new Date(); const token = 'a'.repeat(43);
  const id = '11111111-1111-4111-8111-111111111111';
  const user = { id: 'owner', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid', university: { id: 'uni', name: 'Universidad' } };
  let revoked = false;
  const accounts = new AccountsService({ findUser: async () => null, createSession: async () => { throw Error('unused'); },
    revokeSession: async () => {}, listUniversities: async () => [],
    findSession: async hash => hash === tokenHash(token) ? { serverTime: at,
      session: { id: 'session', user, createdAt: at, expiresAt: new Date(+at + 6 * 3_600_000), revokedAt: revoked ? at : null } } : null });
  let calls = 0; let failure: unknown;
  const loan = { id: 'loan', bookId: 'book', startedAt: at, dueAt: new Date(+at + 480 * 3_600_000) };
  let result: ReservationResult = { loan, created: true, active: true };
  const app = createApp({ accounts, checkDatabase: async () => {}, checkStorage: async () => {}, reservations: {
    async acceptReservation(owner, reservation) {
      calls++; assert.equal(owner, user.id); assert.equal(reservation, id);
      if (failure) throw failure;
      return result;
    },
  } });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reservations/${id}/accept`;
  const headers = { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', Cookie: `biblioteca_session=${token}` };
  const post = (custom = headers, target = url) => fetch(target, { method: 'POST', headers: custom, body: JSON.stringify({ userId: 'attacker' }) });
  assert.equal((await fetch(url)).status, 405); assert.equal(calls, 0);
  assert.equal((await post({ ...headers, 'X-Biblioteca-Request': '' })).status, 403);
  assert.equal((await post({ ...headers, Cookie: '' })).status, 401);
  revoked = true; assert.equal((await post()).status, 401); revoked = false;
  assert.equal((await post(headers, url.replace(id, 'invalid'))).status, 400);
  assert.equal(calls, 0);
  const response = await post();
  assert.equal(response.status, 201); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { ...result, loan: { ...loan, startedAt: at.toISOString(), dueAt: loan.dueAt.toISOString() } });
  result = { loan, created: false, active: true }; assert.equal((await post()).status, 200);
  for (const code of ['RESERVATION_NOT_FOUND', 'RESERVATION_EXPIRED', 'RESERVATION_CANCELLED', 'RESERVATION_REJECTED_LIMIT'] as const) {
    result = { code };
    const denied = await post(); assert.equal(denied.status, code === 'RESERVATION_NOT_FOUND' ? 404 : 409);
    assert.equal((await denied.json()).error.code, code);
  }
  failure = Object.assign(new Error('private-database-password'), { code: 'P1001' });
  const unavailable = await post(); assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('private-database-password'), false);
});
