import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('readiness ejecuta la comprobación de base y oculta errores de conexión', async (t) => {
  let failure = false;
  let checks = 0;
  const server = createApp({
    checkDatabase: async () => {
      checks += 1;
      if (failure) throw new Error('credencial-secreta-de-prueba');
    },
    checkStorage: async () => {},
    listUniversities: async () => [],
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(checks, 0);

  const ready = await fetch(`${url}/api/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', database: 'ok', storage: 'ok' });
  assert.equal(checks, 1);

  failure = true;
  const unavailable = await fetch(`${url}/api/ready`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    status: 'unavailable', database: 'unavailable', storage: 'ok',
  });
  assert.equal(checks, 2);
});
