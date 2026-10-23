import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('Express sirve Angular en el origen de la API y conserva los 404 de API como JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ics-static-'));
  const index = join(directory, 'index.html');
  await writeFile(index, '<!doctype html><title>Angular shell de prueba</title>');
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    frontendDirectory: directory,
    books: { findAll: async () => [], findAuthors: async () => [] },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const path of ['/', '/catalogo']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /text\/html/);
      assert.ok((await response.text()).includes('Angular shell de prueba'));
    }
    const missing = await fetch(`${url}/api/inexistente`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'NOT_FOUND' });
    const catalog = await fetch(`${url}/api/books`);
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { books: [] });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(index);
    await rmdir(directory);
  }
});
