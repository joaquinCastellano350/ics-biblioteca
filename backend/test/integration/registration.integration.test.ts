import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../../src/app.js';
import { RegistrationService, REGISTRATION_SESSION_DURATION_MS } from '../../src/modules/accounts/registration.service.js';
import type { RegistrationPublicResponse } from '../../src/modules/accounts/registration.service.js';
import { PostgresRegistrationRepository } from '../../src/modules/accounts/registration.repository.js';
import { verifyPassword } from '../../src/modules/accounts/registration.security.js';
import { openPostgresFixture, testUniversity } from './postgres-fixture.js';
import type { PostgresFixture } from './postgres-fixture.js';

// Ejecutar SOLO con autorización de escrituras locales y TEST_DATABASE_URL validada.
// No se importa la composición productiva, env.ts ni el singleton de desarrollo.
describe('HU-02: PostgreSQL aislado real', { concurrency: false }, () => {
  let fixture: PostgresFixture;
  let server: Server | undefined;
  let baseUrl: string;
  const data = {
    firstName: 'Ana', lastName: 'Pérez', universityId: testUniversity.id,
    email: 'registro@example.org', password: ' a ',
  };

  before(async () => {
    fixture = await openPostgresFixture();
    const registrationService = new RegistrationService(new PostgresRegistrationRepository(fixture.database));
    server = createApp({
      registrationService, production: true,
      checkDatabase: async () => { throw new Error('No se usa readiness en esta suite.'); },
      checkStorage: async () => { throw new Error('No se usa almacenamiento en esta suite.'); },
      listUniversities: async () => [{ ...testUniversity }],
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => { await fixture.reset(); });

  after(async () => {
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    } finally { await fixture?.close(); }
  });

  const register = (body = data) => fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' },
    body: JSON.stringify(body),
  });

  async function counts() {
    const rows = await fixture.query<{ users: number; sessions: number }>(`
      SELECT (SELECT count(*)::int FROM public.users) AS users,
        (SELECT count(*)::int FROM public.sessions) AS sessions
    `);
    return rows[0];
  }

  it('registro exitoso persiste exactamente usuario y sesión vinculados y devuelve datos públicos', async () => {
    const response = await register({ ...data, firstName: ' Ana ', lastName: ' Pérez ', email: ' REGISTRO@EXAMPLE.ORG ' });
    assert.equal(response.status, 201);
    const body = await response.json() as RegistrationPublicResponse;
    assert.deepEqual(Object.keys(body).sort(), ['serverTime', 'session', 'user']);
    assert.equal(body.user.firstName, 'Ana');
    assert.equal(body.user.lastName, 'Pérez');
    assert.equal(body.user.email, data.email);
    assert.deepEqual(body.user.university, testUniversity);
    assert.match(body.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const rows = await fixture.query<{ user_id: string; university_id: string; session_user_id: string; session_id: string }>(`
      SELECT u.id AS user_id, u.university_id, s.user_id AS session_user_id, s.id AS session_id
      FROM public.users u JOIN public.sessions s ON s.user_id = u.id WHERE u.id = $1::uuid
    `, [body.user.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.user_id, rows[0]!.session_user_id);
    assert.equal(rows[0]!.university_id, testUniversity.id);
    assert.match(rows[0]!.session_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(rows[0]!.session_id, rows[0]!.user_id);
    assert.deepEqual(await counts(), { users: 1, sessions: 1 });
    for (const key of ['password', 'passwordHash', 'password_hash', 'token', 'tokenHash', 'cookie']) {
      assert.ok(!JSON.stringify(body).includes(`"${key}"`), 'El JSON no debe exponer campos sensibles.');
    }
  });

  it('almacena Argon2id verificable y solo SHA-256 del token de cookie', async () => {
    const response = await register();
    assert.equal(response.status, 201);
    const body = await response.json() as RegistrationPublicResponse;
    const cookie = response.headers.get('set-cookie')!;
    const token = /^biblioteca_session=([^;]+)/.exec(cookie)?.[1];
    assert.ok(token && /^[A-Za-z0-9_-]{43}$/.test(token), 'Token de sesión no válido.');
    const rows = await fixture.query<{ password_hash: string; token_hash: string }>(`
      SELECT u.password_hash, s.token_hash FROM public.users u
      JOIN public.sessions s ON s.user_id = u.id WHERE u.id = $1::uuid
    `, [body.user.id]);
    const stored = rows[0]!;
    assert.ok(stored.password_hash.startsWith('$argon2id$'), 'Se requiere Argon2id.');
    assert.ok(stored.password_hash !== data.password, 'No guardar contraseña en texto plano.');
    assert.ok(await verifyPassword(stored.password_hash, data.password), 'El hash debe verificar la contraseña original.');
    assert.ok(!(await verifyPassword(stored.password_hash, 'otra')), 'Otra contraseña no debe verificar.');
    assert.ok(stored.token_hash === createHash('sha256').update(token).digest('hex'), 'Debe persistirse solo SHA-256 del token.');
    for (const sensitive of [data.password, token, stored.password_hash, stored.token_hash]) {
      assert.ok(!JSON.stringify(body).includes(sensitive), 'La respuesta no debe incluir datos sensibles.');
    }
  });

  it('correo normalizado duplicado devuelve 409 sin agregar usuario ni sesión', async () => {
    const first = await register();
    assert.equal(first.status, 201);
    await first.json();
    const second = await register({ ...data, email: ' REGISTRO@EXAMPLE.ORG ' });
    assert.equal(second.status, 409);
    assert.equal(second.headers.get('set-cookie'), null);
    assert.equal((await second.json()).error.code, 'EMAIL_ALREADY_REGISTERED');
    assert.deepEqual(await counts(), { users: 1, sessions: 1 });
  });

  it('universidad inexistente devuelve 400 sin persistencia parcial', async () => {
    const response = await register({ ...data, universityId: randomUUID() });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).error.code, 'UNIVERSITY_NOT_FOUND');
    assert.deepEqual(await counts(), { users: 0, sessions: 0 });
  });

  it('fallo REAL al insertar sesión revierte también el usuario', async () => {
    await fixture.installSessionFailure();
    try {
      const response = await register();
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
      const attempts = await fixture.query<{ is_called: boolean }>('SELECT is_called FROM public.hu02_session_attempts');
      assert.equal(attempts[0]!.is_called, true, 'El trigger debe alcanzar la sesión después de ver al usuario insertado.');
      // Esta conexión es independiente de la transacción de Prisma.
      assert.deepEqual(await counts(), { users: 0, sessions: 0 });
    } finally { await fixture.removeSessionFailure(); }
    const recovered = await register();
    assert.equal(recovered.status, 201);
    await recovered.json();
    assert.deepEqual(await counts(), { users: 1, sessions: 1 });
  });

  it('dos registros concurrentes del mismo correo producen un 201 y un 409', async () => {
    const responses = await Promise.all([register(), register({ ...data, email: ' REGISTRO@EXAMPLE.ORG ' })]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    for (const response of responses) {
      if (response.status === 409) assert.equal(response.headers.get('set-cookie'), null);
      await response.json();
    }
    assert.deepEqual(await counts(), { users: 1, sessions: 1 });
  });

  it('cookie de producción no vence después de la sesión real de seis horas', async () => {
    const response = await register();
    assert.equal(response.status, 201);
    const body = await response.json() as RegistrationPublicResponse;
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    const cookie = cookies[0]!;
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      assert.ok(cookie.split('; ').includes(attribute), 'Falta atributo de seguridad de cookie.');
    }
    assert.ok(!cookie.includes('Max-Age='), 'No recalcular el vencimiento absoluto.');
    const rows = await fixture.query<{ created_at: Date; expires_at: Date; user_created_at: Date }>(`
      SELECT s.created_at, s.expires_at, u.created_at AS user_created_at
      FROM public.sessions s JOIN public.users u ON u.id = s.user_id WHERE u.id = $1::uuid
    `, [body.user.id]);
    const session = rows[0]!;
    assert.equal(session.expires_at.getTime() - session.created_at.getTime(), REGISTRATION_SESSION_DURATION_MS);
    assert.equal(session.user_created_at.getTime(), session.created_at.getTime());
    assert.equal(session.created_at.toISOString(), body.session.createdAt);
    assert.equal(session.expires_at.toISOString(), body.session.expiresAt);
    const cookieExpiry = Date.parse(/; Expires=([^;]+)/.exec(cookie)![1]!);
    assert.ok(cookieExpiry <= session.expires_at.getTime());
    assert.ok(session.expires_at.getTime() - cookieExpiry < 1000);
    assert.ok(cookieExpiry > Date.now());
  });
});
