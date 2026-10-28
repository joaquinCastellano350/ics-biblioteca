import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import type { AccountsRepository } from '../src/accounts/accounts.repository.js';
import type { PersonalCirculation } from '../src/circulation/circulation-query.js';
import { tokenHash } from '../src/accounts/sessions.js';

const now = new Date('2026-10-28T12:00:00Z');
const later = new Date(now.getTime() + 3_600_000);
const tokens = { ana: 'a'.repeat(43), bea: 'b'.repeat(43) };

function snapshot(userId: string): PersonalCirculation {
  const book = { id: `book-${userId}`, title: `Libro de ${userId}`, pdfObjectKey: 'private.pdf' };
  return {
    serverTime: now,
    loans: [{ id: `loan-${userId}`, book, startedAt: now, dueAt: later }],
    waits: [{ id: `wait-${userId}`, book, joinedAt: now, position: 3 }],
    reservations: [{ id: `reservation-${userId}`, queueEntryId: `offered-${userId}`, book, offeredAt: now, expiresAt: later }],
    requestConstraints: { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: [book.id] },
  };
}

async function fixture(t: TestContext, options: { queryError?: Error; sessionError?: Error; empty?: boolean } = {}) {
  const calls: string[] = [];
  let sessionState: 'valid' | 'expired' | 'revoked' = 'valid';
  const unused = async (): Promise<never> => { throw new Error('Dependencia inesperada'); };
  const repository: AccountsRepository = {
    findUser: unused, createSession: unused, revokeSession: unused, listUniversities: unused,
    findSession: async (hash) => {
      if (options.sessionError) throw options.sessionError;
      const userId = Object.entries(tokens).find(([, token]) => tokenHash(token) === hash)?.[0];
      if (!userId) return null;
      return { serverTime: now, session: {
        id: `session-${userId}`, createdAt: now,
        expiresAt: sessionState === 'expired' ? now : later,
        revokedAt: sessionState === 'revoked' ? now : null,
        user: { id: userId, firstName: userId, lastName: 'Prueba', email: `${userId}@example.invalid`,
          university: { id: 'university', name: 'Universidad' } },
      } };
    },
  };
  const server = createApp({
    accounts: new AccountsService(repository), checkDatabase: unused, checkStorage: unused,
    circulationQueries: { async findPersonalCirculation(userId) {
      calls.push(userId);
      if (options.queryError) throw options.queryError;
      if (options.empty) return { serverTime: now, loans: [], waits: [], reservations: [],
        requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
      // Campos extra deliberados: el router debe serializar solo el contrato.
      return { ...snapshot(userId), passwordHash: 'internal-secret', otherUsers: ['not-public'] };
    } },
  }).listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/circulation`;
  return {
    calls,
    setSessionState(value: typeof sessionState) { sessionState = value; },
    get(cookie?: string, query = '') { return fetch(`${url}${query}`, { headers: cookie ? { Cookie: cookie } : {} }); },
  };
}

test('GET personal: contrato, fechas ISO, no-store y ninguna cookie nueva', async (t) => {
  const f = await fixture(t);
  const response = await f.get(`biblioteca_session=${tokens.ana}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['loans', 'requestConstraints', 'reservations', 'serverTime', 'waits']);
  assert.deepEqual(body.loans, [{ id: 'loan-ana', book: { id: 'book-ana', title: 'Libro de ana' },
    startedAt: now.toISOString(), dueAt: later.toISOString() }]);
  assert.deepEqual(body.waits, [{ id: 'wait-ana', book: { id: 'book-ana', title: 'Libro de ana' },
    joinedAt: now.toISOString(), position: 3 }]);
  assert.deepEqual(body.reservations, [{ id: 'reservation-ana', queueEntryId: 'offered-ana',
    book: { id: 'book-ana', title: 'Libro de ana' }, offeredAt: now.toISOString(), expiresAt: later.toISOString() }]);
  assert.equal(body.serverTime, now.toISOString());
  assert.deepEqual(body.requestConstraints, { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: ['book-ana'] });
  const json = JSON.stringify(body);
  for (const forbidden of ['pdfObjectKey', 'private.pdf', 'passwordHash', 'internal-secret', 'otherUsers', tokens.ana]) {
    assert.equal(json.includes(forbidden), false);
  }
});

test('la identidad proviene de la cookie y no de userId en la URL; cuentas aisladas', async (t) => {
  const f = await fixture(t);
  for (const user of ['ana', 'bea'] as const) {
    const response = await f.get(`biblioteca_session=${tokens[user]}`, '?userId=otra-persona&ownerId=otra-persona');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.loans[0].id, `loan-${user}`);
    assert.equal(body.waits[0].id, `wait-${user}`);
    assert.equal(body.reservations[0].id, `reservation-${user}`);
    assert.deepEqual(body.requestConstraints.openQueueBookIds, [`book-${user}`]);
  }
  assert.deepEqual(f.calls, ['ana', 'bea']);
});

test('cookie ausente, malformada o desconocida: 401 antes del repositorio personal', async (t) => {
  const f = await fixture(t);
  for (const cookie of [undefined, 'biblioteca_session=invalid', `biblioteca_session=${'z'.repeat(43)}`]) {
    const response = await f.get(cookie);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(f.calls, []);
});

for (const state of ['expired', 'revoked'] as const) {
  test(`sesión ${state}: no consulta ni revela datos personales`, async (t) => {
    const f = await fixture(t);
    f.setSessionState(state);
    const response = await f.get(`biblioteca_session=${tokens.ana}`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    assert.deepEqual(f.calls, []);
  });
}

test('colecciones vacías: 200 sin inventar préstamos, posiciones ni ofertas', async (t) => {
  const f = await fixture(t, { empty: true });
  assert.deepEqual(await (await f.get(`biblioteca_session=${tokens.ana}`)).json(), {
    serverTime: now.toISOString(), loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] },
  });
});

for (const stage of ['session', 'query'] as const) {
  for (const unavailable of [true, false]) {
    test(`errores seguros en ${stage}; dependencia no disponible=${unavailable}`, async (t) => {
      const error = Object.assign(new Error('detalle-privado'), unavailable ? { code: 'P1001' } : {});
      const f = await fixture(t, stage === 'session' ? { sessionError: error } : { queryError: error });
      const response = await f.get(`biblioteca_session=${tokens.ana}`);
      assert.equal(response.status, unavailable ? 503 : 500);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      const body = await response.text();
      assert.equal(JSON.parse(body).error.code, unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
      assert.equal(body.includes('detalle-privado'), false);
      if (stage === 'session') assert.deepEqual(f.calls, []);
    });
  }
}
