import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { RegistrationError, REGISTRATION_SESSION_DURATION_MS } from '../src/accounts/registration.service.js';
import type { RegistrationResult } from '../src/accounts/registration.service.js';
import type { RegistrationHandlerService } from '../src/accounts/registration.service.js';

const token = 's'.repeat(43);
const input = {
  firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org', password: 'sencilla',
  universityId: '00000000-0000-4000-8000-000000000007',
};

function result(): RegistrationResult {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + REGISTRATION_SESSION_DURATION_MS);
  return {
    publicResponse: {
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        firstName: input.firstName, lastName: input.lastName, email: input.email,
        university: { id: input.universityId, name: 'Facultad Regional Córdoba (Córdoba)' },
      },
      session: { createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() },
      serverTime: createdAt.toISOString(),
    },
    cookie: { token, expiresAt, maxAgeMs: REGISTRATION_SESSION_DURATION_MS },
  };
}

async function start(t: TestContext, register: RegistrationHandlerService['register'] = async () => result(), production = false) {
  let calls = 0;
  let received: unknown;
  const server = createApp({
    checkDatabase: async () => { throw new Error('No debe acceder a PostgreSQL.'); },
    checkStorage: async () => { throw new Error('No debe acceder al almacenamiento.'); },
    listUniversities: async () => [],
    registrationService: { register: async (body) => { calls += 1; received = body; return register(body); } },
    production,
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    send: (body = JSON.stringify(input), headers: Record<string, string> = {
      'Content-Type': 'application/json', 'X-Biblioteca-Request': '1',
    }) => fetch(`${url}/api/auth/register`, { method: 'POST', headers, body }),
    get calls() { return calls; },
    get received() { return received; },
  };
}

test('registro HTTP responde 201 con el publicResponse exacto y llama una vez al servicio simulado', async (t) => {
  const expected = result();
  const app = await start(t, async () => expected);
  const response = await app.send();
  assert.equal(response.status, 201);
  assert.match(response.headers.get('content-type')!, /^application\/json/);
  assert.deepEqual(await response.json(), expected.publicResponse);
  assert.deepEqual(app.received, input);
  assert.equal(app.calls, 1);
});

for (const production of [false, true]) {
  test(`cookie HttpOnly, SameSite=Lax, Path=/ y vencimiento real; producción=${production}`, async (t) => {
    const expected = result();
    const app = await start(t, async () => expected, production);
    const response = await app.send();
    assert.equal(response.status, 201);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    const cookie = cookies[0]!;
    assert.match(cookie, new RegExp(`^biblioteca_session=${token};`));
    assert.match(cookie, /; HttpOnly(?:;|$)/);
    assert.match(cookie, /; SameSite=Lax(?:;|$)/);
    assert.match(cookie, /; Path=\/(?:;|$)/);
    assert.equal(cookie.includes('Max-Age='), false);
    assert.equal(/; Secure(?:;|$)/.test(cookie), production);
    const expiresAt = Date.parse(/; Expires=([^;]+)/.exec(cookie)![1]!);
    assert.equal(expiresAt, Math.floor(expected.cookie.expiresAt.getTime() / 1000) * 1000);
    assert.ok(expiresAt <= expected.cookie.expiresAt.getTime());
    await response.json();
  });
}

test('descuenta el tiempo transcurrido antes de emitir cookie y no utiliza el Max-Age original', async (t) => {
  const expected = result();
  const createdAt = Date.parse(expected.publicResponse.session.createdAt);
  // El servicio simulado termina 90 segundos después de crear la sesión.
  const responseTime = createdAt + 90_000;
  const app = await start(t, async () => {
    t.mock.method(Date, 'now', () => responseTime);
    return expected;
  });
  const response = await app.send();
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')!;
  const expiresAt = Date.parse(/; Expires=([^;]+)/.exec(cookie)![1]!);
  assert.ok(expiresAt - responseTime <= REGISTRATION_SESSION_DURATION_MS - 90_000);
  assert.ok(expiresAt - responseTime > REGISTRATION_SESSION_DURATION_MS - 91_000);
  assert.ok(expiresAt <= expected.cookie.expiresAt.getTime());
  assert.equal(cookie.includes('Max-Age='), false);
  assert.deepEqual(await response.json(), expected.publicResponse);
  assert.equal(app.calls, 1);
});

test('mantiene el vencimiento absoluto aunque Date.now avance durante la serialización de la cookie', async (t) => {
  const expected = result();
  const createdAt = Date.parse(expected.publicResponse.session.createdAt);
  let reads = 0;
  const app = await start(t, async () => {
    t.mock.method(Date, 'now', () => createdAt + 60_000 + (++reads * 100));
    return expected;
  });
  const response = await app.send();
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie')!;
  const expiresAt = Date.parse(/; Expires=([^;]+)/.exec(cookie)![1]!);
  assert.equal(expiresAt, Math.floor(expected.cookie.expiresAt.getTime() / 1000) * 1000);
  assert.equal(cookie.includes('Max-Age='), false);
  await response.json();
});

for (const scenario of ['vencida', 'vence ahora', 'sin segundo completo restante', 'fecha inválida'] as const) {
  test(`sesión ${scenario}: respuesta segura 503 sin cookie`, async (t) => {
    const expected = result();
    const expiry = expected.cookie.expiresAt.getTime();
    const responseTime = scenario === 'vencida' ? expiry + 1000
      : scenario === 'sin segundo completo restante' ? Math.floor(expiry / 1000) * 1000
      : expiry;
    if (scenario === 'fecha inválida') expected.cookie.expiresAt = new Date(NaN);
    expected.publicResponse.serverTime = new Date(responseTime).toISOString();
    const app = await start(t, async () => {
      t.mock.method(Date, 'now', () => responseTime);
      return expected;
    });
    const response = await app.send();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {
      error: { code: 'SERVICE_UNAVAILABLE', message: new RegistrationError('SERVICE_UNAVAILABLE').message },
    });
    assert.equal(app.calls, 1);
  });
}

test('la respuesta JSON no contiene token, contraseña, hashes ni contenedor cookie', async (t) => {
  const app = await start(t);
  const response = await app.send();
  const text = await response.text();
  assert.equal(response.status, 201);
  for (const sensitive of [token, input.password, 'password', 'passwordHash', 'tokenHash', 'cookie', '$argon2id$']) {
    assert.equal(text.includes(sensitive), false);
  }
});

for (const [code, status] of [
  ['VALIDATION_ERROR', 400],
  ['EMAIL_ALREADY_REGISTERED', 409], ['SERVICE_UNAVAILABLE', 503], ['INTERNAL_ERROR', 500],
] as const) {
  test(`error tipado ${code} devuelve ${status} sin cookie ni detalles internos`, async (t) => {
    const app = await start(t, async () => {
      const error = new RegistrationError(code);
      error.message = `detalle-interno-${token}`;
      throw error;
    });
    const response = await app.send();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: { code, message: new RegistrationError(code).message } });
    assert.equal(app.calls, 1);
  });
}

test('conserva errores de validación por campo del servicio', async (t) => {
  const fields = { email: 'Ingresá un correo válido.' };
  const app = await start(t, async () => { throw new RegistrationError('VALIDATION_ERROR', fields); });
  const response = await app.send();
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    error: { code: 'VALIDATION_ERROR', message: new RegistrationError('VALIDATION_ERROR').message, fields },
  });
});

test('error inesperado no expone mensajes, stack, token ni propiedades que imiten un error tipado', async (t) => {
  const app = await start(t, async () => {
    throw Object.assign(new Error(`detalle-${token}`), { code: 'EMAIL_ALREADY_REGISTERED' });
  });
  const response = await app.send();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' } });
});

test('encabezado ausente o incorrecto devuelve 403 antes de analizar el cuerpo', async (t) => {
  const app = await start(t);
  for (const headers of [
    { 'Content-Type': 'application/json' },
    { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '0' },
    { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1, 1' },
  ]) {
    const response = await app.send('{json inválido', headers);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).error.code, 'REQUEST_NOT_ALLOWED');
  }
  assert.equal(app.calls, 0);
});

test('contenido no JSON o sin Content-Type devuelve 415 sin invocar el servicio', async (t) => {
  const app = await start(t);
  for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const headers: Record<string, string> = { 'X-Biblioteca-Request': '1' };
    if (type) headers['Content-Type'] = type;
    const response = await app.send(JSON.stringify(input), headers);
    assert.equal(response.status, 415);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  }
  assert.equal(app.calls, 0);
});

test('acepta application/json con charset UTF-8', async (t) => {
  const app = await start(t);
  const response = await app.send(JSON.stringify(input), {
    'Content-Type': 'application/json; charset=utf-8', 'X-Biblioteca-Request': '1',
  });
  assert.equal(response.status, 201);
  await response.json();
  assert.equal(app.calls, 1);
});

test('JSON mal formado devuelve 400 sin filtrar el cuerpo ni llamar al servicio', async (t) => {
  const app = await start(t);
  const response = await app.send(`{"password":"${token}"`);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    error: { code: 'VALIDATION_ERROR', message: 'No se pudieron procesar los datos enviados.' },
  });
  assert.equal(app.calls, 0);
});

test('límite de 16 KiB: acepta el tamaño exacto y rechaza un byte adicional', async (t) => {
  const app = await start(t);
  const exactBody = JSON.stringify({ padding: 'a'.repeat(16 * 1024 - 14) });
  assert.equal(Buffer.byteLength(exactBody), 16 * 1024);
  const accepted = await app.send(exactBody);
  assert.equal(accepted.status, 201);
  await accepted.json();
  const rejected = await app.send(`${exactBody} `);
  assert.equal(rejected.status, 413);
  assert.equal(rejected.headers.get('set-cookie'), null);
  assert.deepEqual(await rejected.json(), {
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'No se pudieron procesar los datos enviados.' },
  });
  assert.equal(app.calls, 1);
});

test('el límite cuenta bytes UTF-8 y no caracteres', async (t) => {
  const app = await start(t);
  const body = JSON.stringify({ padding: 'á'.repeat(9000) });
  assert.ok(body.length < 16 * 1024);
  assert.ok(Buffer.byteLength(body) > 16 * 1024);
  const response = await app.send(body);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('set-cookie'), null);
  await response.json();
  assert.equal(app.calls, 0);
});

test('charset no compatible devuelve 415 sin cookie ni llamada al servicio', async (t) => {
  const app = await start(t);
  const response = await app.send('{}', {
    'Content-Type': 'application/json; charset=iso-8859-1', 'X-Biblioteca-Request': '1',
  });
  assert.equal(response.status, 415);
  assert.equal(response.headers.get('set-cookie'), null);
  await response.json();
  assert.equal(app.calls, 0);
});

test('no agrega login, logout ni otras rutas y mantiene público el listado', async (t) => {
  const app = await start(t);
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/auth/me']) {
    const response = await fetch(`${app.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' }, body: '{}' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
  const universities = await fetch(`${app.url}/api/universities`);
  assert.equal(universities.status, 200);
  assert.deepEqual(await universities.json(), { universities: [] });
  assert.equal(app.calls, 0);
});
