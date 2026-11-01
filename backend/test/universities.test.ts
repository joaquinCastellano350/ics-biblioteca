import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { PublicUser } from '../src/accounts/accounts.repository.js';

test('GET /api/universities es público y conserva UUID, nombres y orden del repositorio', async (t) => {
  const universities: PublicUser['university'][] = [
    { id: '00000000-0000-4000-8000-000000000001', name: 'Facultad Regional Avellaneda (Buenos Aires)' },
    { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
  ];
  let calls = 0;
  const server = createApp({
    checkDatabase: async () => { throw Object.assign(new Error('No debe comprobar disponibilidad global.'), { code: 'P1001' }); },
    checkStorage: async () => { throw Object.assign(new Error('Este endpoint no depende del almacenamiento.'), { code: 'P1001' }); },
    listUniversities: async () => { calls += 1; return universities; },
    registrationService: { register: async () => { throw Object.assign(new Error('No debe registrar.'), { code: 'P1001' }); } },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/universities`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { universities });
  assert.equal(calls, 1);
});

test('GET /api/universities devuelve 200 cuando la lista está vacía', async (t) => {
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    listUniversities: async () => [],
    registrationService: { register: async () => { throw Object.assign(new Error('No debe registrar.'), { code: 'P1001' }); } },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/universities`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { universities: [] });
});

test('GET /api/universities devuelve 503 sin revelar errores internos', async (t) => {
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    listUniversities: async () => { throw Object.assign(new Error('detalle-interno-de-prueba'), { code: 'P1001' }); },
    registrationService: { register: async () => { throw Object.assign(new Error('No debe registrar.'), { code: 'P1001' }); } },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/universities`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'El servicio no está disponible. Intentá nuevamente más tarde.',
    },
  });
});
