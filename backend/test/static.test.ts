import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { RegistrationError } from '../src/accounts/registration.service.js';

test('Express sirve Angular en el origen de la API y conserva los 404 de API como JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ics-static-'));
  const index = join(directory, 'index.html');
  await writeFile(index, '<!doctype html><title>Angular shell de prueba</title>');
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    listUniversities: async () => [],
    registrationService: { register: async () => { throw new RegistrationError('VALIDATION_ERROR'); } },
    frontendDirectory: directory,
    books: { findAll: async () => ({ books: [], total: 0 }), findAuthors: async () => [] },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const path of ['/', '/catalogo', '/registro']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /text\/html/);
      assert.ok((await response.text()).includes('Angular shell de prueba'));
    }
    const missing = await fetch(`${url}/api/inexistente`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: {
      code: 'NOT_FOUND', message: 'No se encontró el recurso.',
    } });
    const catalog = await fetch(`${url}/api/books`);
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { books: [], total: 0 });
    const universities = await fetch(`${url}/api/universities`);
    assert.equal(universities.status, 200);
    assert.deepEqual(await universities.json(), { universities: [] });
    const registration = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' },
      body: '{}',
    });
    assert.equal(registration.status, 400);
    assert.equal(registration.headers.get('set-cookie'), null);
    assert.equal((await registration.json()).error.code, 'VALIDATION_ERROR');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(index);
    await rmdir(directory);
  }
});
