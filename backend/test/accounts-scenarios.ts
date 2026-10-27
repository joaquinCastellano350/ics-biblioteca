import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { QueryResultRow } from 'pg';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { PrismaAccountsRepository } from '../src/accounts/prisma-accounts.repository.js';
import { RegistrationService } from '../src/accounts/registration.service.js';
import { PostgresRegistrationRepository } from '../src/accounts/registration.repository.js';
import { tokenHash, SESSION_DURATION_MS } from '../src/accounts/sessions.js';
import { verifyPassword } from '../src/accounts/credentials.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { universities } from '../prisma/universities.js';

export interface AccountsFixture {
  database: PrismaClient;
  reset(): Promise<void>;
  close(): Promise<void>;
  query<T extends QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]>;
  installSessionFailure(): Promise<void>;
  removeSessionFailure(): Promise<void>;
}

/** El mismo contrato se ejecuta contra PGlite y contra PostgreSQL local explícito. */
export function accountsScenarios(name: string, open: () => Promise<AccountsFixture>) {
  describe(name, { concurrency: false }, () => {
    let fixture: AccountsFixture;
    let server: Server | undefined;
    let base: string;
    const data = {
      firstName: 'Ana', lastName: 'Pérez', universityId: universities[6]!.id,
      email: 'ana@example.org', password: ' con espacios ñ 漢字 ',
    };
    const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
    const post = (path: string, body: object, session?: string) => fetch(`${base}/api/auth/${path}`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Biblioteca-Request': '1', ...(session ? { Cookie: session } : {}),
      }, body: JSON.stringify(body),
    });
    const current = (session: string) => fetch(`${base}/api/auth/session`, { headers: { Cookie: session } });
    const counts = async () => ({ users: await fixture.database.user.count(), sessions: await fixture.database.session.count() });

    before(async () => {
      fixture = await open();
      server = createApp({
        checkDatabase: async () => {}, checkStorage: async () => {}, production: true,
        accounts: new AccountsService(new PrismaAccountsRepository(fixture.database)),
        registrationService: new RegistrationService(new PostgresRegistrationRepository(fixture.database)),
      }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    beforeEach(async () => { await fixture.reset(); });
    after(async () => {
      try { if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve())); }
      finally { await fixture?.close(); }
    });

    it('registro, restauración y login comparten credenciales, DTO y cookie sin secretos', async () => {
      const registered = await post('register', { ...data, firstName: ' Ana ', email: ' ANA@EXAMPLE.ORG ' });
      assert.equal(registered.status, 201);
      const body = await registered.json();
      assert.equal(body.user.email, data.email);
      assert.equal(body.user.firstName, 'Ana');
      assert.equal(body.user.university.id, data.universityId);
      assert.equal(Date.parse(body.session.expiresAt) - Date.parse(body.session.createdAt), SESSION_DURATION_MS);
      const oldCookie = cookie(registered);
      const stored = await fixture.database.user.findUniqueOrThrow({ where: { email: data.email } });
      assert(await verifyPassword(stored.passwordHash, data.password));
      const storedSession = await fixture.database.session.findFirstOrThrow({ where: { userId: stored.id } });
      assert.equal(storedSession.tokenHash, tokenHash(oldCookie.slice('biblioteca_session='.length)));
      for (const secret of [data.password, stored.passwordHash, storedSession.tokenHash, oldCookie.slice('biblioteca_session='.length)]) {
        assert(!JSON.stringify(body).includes(secret));
      }
      const restored = await current(oldCookie);
      assert.equal(restored.status, 200);
      assert.equal((await restored.json()).user.id, body.user.id);
      assert.equal(restored.headers.get('set-cookie'), null);
      const logged = await post('login', { email: ' ANA@EXAMPLE.ORG ', password: data.password }, oldCookie);
      assert.equal(logged.status, 200);
      const loggedBody = await logged.json();
      assert.deepEqual(loggedBody.user, body.user);
      assert.equal((await current(oldCookie)).status, 401);
      assert.equal((await current(cookie(logged))).status, 200);
      for (const response of [registered, logged, restored]) assert.equal(response.headers.get('cache-control'), 'no-store');
      for (const response of [registered, logged]) {
        const header = response.headers.get('set-cookie')!;
        for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert(header.includes(attribute));
        assert(!header.includes('Max-Age='));
        const dto = response === registered ? body : loggedBody;
        const cookieExpiry = Date.parse(/Expires=([^;]+)/.exec(header)![1]!);
        assert(cookieExpiry <= Date.parse(dto.session.expiresAt));
        assert(Date.parse(dto.session.expiresAt) - cookieExpiry < 1000);
      }
    });

    it('registro reemplaza solo la sesión previa del navegador y conserva otro dispositivo', async () => {
      const first = await post('register', data); const a = cookie(first); await first.json();
      const other = await post('login', data); const otherCookie = cookie(other); await other.json();
      const second = await post('register', { ...data, email: 'otra@example.org' }, a);
      assert.equal(second.status, 201); const b = cookie(second); const secondBody = await second.json();
      assert.equal((await current(a)).status, 401);
      assert.equal((await current(otherCookie)).status, 200);
      assert.equal((await (await current(b)).json()).user.id, secondBody.user.id);
      const duplicate = await post('register', data, b);
      assert.equal(duplicate.status, 409); assert.equal(duplicate.headers.get('set-cookie'), null);
      assert.equal((await current(b)).status, 200);
    });

    it('credenciales incorrectas o cuenta inexistente no crean sesiones ni revocan la anterior', async () => {
      const first = await post('register', data); const a = cookie(first); await first.json();
      const wrong = await post('login', { ...data, password: 'incorrecta' }, a);
      const missing = await post('login', { ...data, email: 'ausente@example.org' }, a);
      assert.equal(wrong.status, 401); assert.equal(missing.status, 401);
      assert.deepEqual(await wrong.json(), await missing.json());
      assert.equal((await current(a)).status, 200); assert.deepEqual(await counts(), { users: 1, sessions: 1 });
    });

    it('cookie desconocida o mal formada no impide registrar una cuenta', async () => {
      for (const [index, token] of ['mal-formado', 'a'.repeat(43), 'j:%7B%22token%22%3A1%7D'].entries()) {
        const response = await post('register', { ...data, email: `cookie-${index}@example.org` }, `biblioteca_session=${token}`);
        assert.equal(response.status, 201); await response.json();
      }
      assert.deepEqual(await counts(), { users: 3, sessions: 3 });
    });

    it('dos registros del mismo correo normalizado producen un 201 y un 409', async () => {
      const responses = await Promise.all([post('register', data), post('register', { ...data, email: ' ANA@EXAMPLE.ORG ' })]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      assert.deepEqual(await counts(), { users: 1, sessions: 1 });
    });

    it('universidad inexistente señala el campo con VALIDATION_ERROR sin persistencia parcial', async () => {
      const response = await post('register', { ...data, universityId: '00000000-0000-4000-8000-000000000099' });
      assert.equal(response.status, 400); const body = await response.json();
      assert.equal(body.error.code, 'VALIDATION_ERROR'); assert(body.error.fields.universityId);
      assert.deepEqual(await counts(), { users: 0, sessions: 0 });
    });

    it('fallar al crear sesión revierte el usuario nuevo y la revocación tanto en registro como login', async () => {
      const first = await post('register', data); const a = cookie(first); await first.json();
      await fixture.installSessionFailure();
      try {
        for (const [path, body] of [['register', { ...data, email: 'rollback@example.org' }], ['login', data]] as const) {
          const failed = await post(path, body, a);
          assert.equal(failed.status, 500); assert.equal((await failed.json()).error.code, 'INTERNAL_ERROR');
          assert.equal(failed.headers.get('set-cookie'), null);
          assert.equal((await current(a)).status, 200);
          assert.deepEqual(await counts(), { users: 1, sessions: 1 });
        }
      } finally { await fixture.removeSessionFailure(); }
    });

    it('la base decide vencimiento y revocación; una cookie vencida permite otro login', async () => {
      const registered = await post('register', data); const a = cookie(registered); await registered.json();
      const hash = tokenHash(a.slice('biblioteca_session='.length));
      await fixture.query(`WITH instant AS (SELECT clock_timestamp()::timestamptz(3) AS now)
        UPDATE sessions SET created_at = instant.now - interval '6 hours', expires_at = instant.now
        FROM instant WHERE token_hash = $1 RETURNING id`, [hash]);
      const expired = await current(a); assert.equal(expired.status, 401); assert.equal(expired.headers.get('set-cookie'), null);
      const again = await post('login', data, a); assert.equal(again.status, 200); const b = cookie(again); await again.json();
      await fixture.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE token_hash = $1 RETURNING id', [tokenHash(b.slice('biblioteca_session='.length))]);
      assert.equal((await current(b)).status, 401);
    });

    it('la actividad no cambia el vencimiento persistido y reautenticar inicia otras seis horas', async () => {
      const registered = await post('register', data);
      const oldCookie = cookie(registered);
      const body = await registered.json();
      const where = { tokenHash: tokenHash(oldCookie.slice('biblioteca_session='.length)) };
      const original = await fixture.database.session.findUniqueOrThrow({ where });
      for (let index = 0; index < 3; index++) {
        const response = await current(oldCookie);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).session, body.session);
        assert.equal(response.headers.get('set-cookie'), null);
      }
      assert.deepEqual(await fixture.database.session.findUniqueOrThrow({ where }), original);
      await fixture.query(`WITH instant AS (SELECT clock_timestamp()::timestamptz(3) AS now)
        UPDATE sessions SET created_at = instant.now - interval '6 hours', expires_at = instant.now
        FROM instant WHERE token_hash = $1 RETURNING id`, [where.tokenHash]);
      const expired = await current(oldCookie);
      assert.equal(expired.status, 401);
      assert.equal((await expired.json()).error.code, 'AUTH_REQUIRED');
      const logged = await post('login', data, oldCookie);
      assert.equal(logged.status, 200);
      const renewed = await logged.json();
      assert.equal(Date.parse(renewed.session.expiresAt) - Date.parse(renewed.session.createdAt), SESSION_DURATION_MS);
      assert.notEqual(cookie(logged), oldCookie);
      assert.equal((await current(cookie(logged))).status, 200);
      assert.equal((await current(oldCookie)).status, 401);
    });

    it('correos internacionales y contraseña de 1024 bytes funcionan en ambas historias', async () => {
      const password = 'ñ'.repeat(512);
      for (const email of ['iñaki@example.org', 'ana@bücher.de']) {
        const registered = await post('register', { ...data, email, password }); assert.equal(registered.status, 201);
        const logged = await post('login', { email, password }); assert.equal(logged.status, 200); await logged.json();
      }
      const oversized = await post('register', { ...data, password: password + 'a' }); assert.equal(oversized.status, 400);
    });

    it('correo quoted con espacios devuelve 400 por campo, nunca un error de SQL', async () => {
      for (const path of ['register', 'login']) {
        const response = await post(path, { ...data, email: '"ana test"@example.org' });
        assert.equal(response.status, 400); const body = await response.json();
        assert.equal(body.error.code, 'VALIDATION_ERROR'); assert(body.error.fields.email);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      assert.deepEqual(await counts(), { users: 0, sessions: 0 });
    });

    it('las dos escrituras comparten CSRF, JSON, charset y no-store', async () => {
      for (const path of ['register', 'login']) {
        for (const [headers, body, status, code] of [
          [{ 'Content-Type': 'application/json' }, '{', 403, 'REQUEST_NOT_ALLOWED'],
          [{ 'Content-Type': 'text/plain', 'X-Biblioteca-Request': '1' }, '{}', 415, 'UNSUPPORTED_MEDIA_TYPE'],
          [{ 'Content-Type': 'application/json; charset=iso-8859-1', 'X-Biblioteca-Request': '1' }, '{}', 415, 'UNSUPPORTED_MEDIA_TYPE'],
          [{ 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' }, '{', 400, 'VALIDATION_ERROR'],
        ] as const) {
          const response = await fetch(`${base}/api/auth/${path}`, { method: 'POST', headers, body });
          assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          assert.equal(response.headers.get('set-cookie'), null);
        }
      }
    });

    it('un único endpoint devuelve las treinta universidades con orden español e id estable', async () => {
      const response = await fetch(`${base}/api/universities`); assert.equal(response.status, 200);
      const expected = [...universities].sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
      assert.deepEqual((await response.json()).universities, expected);
    });
  });
}
