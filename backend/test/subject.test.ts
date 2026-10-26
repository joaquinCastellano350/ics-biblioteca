import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { SubjectRepository } from '../src/subject/subject-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('GET /api/subjects returns an ordered independent list, including subjects without books', async () => {
  const database = await catalogDatabase();
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    subjects: new SubjectRepository(database.client),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await database.client.subject.createMany({
      data: [{ name: 'Redes' }, { name: 'Algoritmos' }, { name: 'Materia sin libros' }],
    });
    const response = await fetch(`${url}/api/subjects`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const subjects = await response.json();
    assert.deepEqual(subjects.subjects.map(({ name }: { name: string }) => name), [
      'Algoritmos', 'Materia sin libros', 'Redes',
    ]);
    assert.equal(subjects.subjects.length, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.close();
  }
});

test('GET /api/subjects hides repository errors and disallows writes', async () => {
  const server = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    subjects: { findAll: async () => { throw new Error('private database detail'); } },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const failed = await fetch(`${url}/api/subjects`);
    assert.equal(failed.status, 503);
    const body = await failed.text();
    assert.equal(JSON.parse(body).error.code, 'SUBJECTS_UNAVAILABLE');
    assert.ok(!body.includes('private database detail'));
    const write = await fetch(`${url}/api/subjects`, { method: 'POST' });
    assert.equal(write.status, 405);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
