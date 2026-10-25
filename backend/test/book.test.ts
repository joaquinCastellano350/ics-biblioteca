import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { BookRepositoryInterface } from '../src/book/book-repository-interface.js';

async function withCatalog(books: BookRepositoryInterface, check: (url: string) => Promise<void>) {
  const app = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    books,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await check(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('el catálogo público conserva todos los libros y metadatos y oculta datos internos', async () => {
  const books = [
    {
      id: '1',
      title: 'Redes',
      authors: [
        { id: 'a1', name: 'Ana' },
        { id: 'a2', name: 'Ana' },
      ],
      subjects: [
        { id: 's1', name: 'Redes' },
        { id: 's2', name: 'Sistemas' },
      ],
      pdfObjectKey: 'private.pdf',
    },
    {
      id: '2',
      title: 'Algoritmos',
      authors: [{ id: 'a3', name: 'Autora' }],
      subjects: [{ id: 's3', name: 'Algoritmos' }],
    },
  ];
  let receivedCriteria: unknown;
  await withCatalog({
    findAll: async (criteria) => { receivedCriteria = criteria; return books; },
    findAuthors: async (query) => query ? [{ id: 'a1', name: 'Ana' }] : [],
  }, async (url) => {
    const response = await fetch(`${url}/api/books`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.books.length, 2);
    assert.equal(result.books[0].authors.length, 2);
    assert.equal(result.books[0].subjects.length, 2);
    assert.ok(!JSON.stringify(result).includes('private.pdf'));
    assert.deepEqual(Object.keys(result.books[0]), ['id', 'title', 'authors', 'subjects']);
    const filtered = await fetch(`${url}/api/books?title=red%20parcial&authorIds=a1&authorIds=a3`);
    assert.equal(filtered.status, 200);
    assert.deepEqual(receivedCriteria, { title: 'red parcial', authorIds: ['a1', 'a3'] });
    const authors = await fetch(`${url}/api/authors?q=ana`);
    assert.equal(authors.status, 200);
    assert.deepEqual(await authors.json(), { authors: [{ id: 'a1', name: 'Ana' }] });
  });
});

test('un catálogo vacío es una colección válida, no un fallo', async () => {
  await withCatalog({ findAll: async () => [], findAuthors: async () => [] }, async (url) => {
    const response = await fetch(`${url}/api/books`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { books: [] });
  });
});

test('un error del repositorio devuelve 503 sin revelar detalles de Prisma o Neon', async () => {
  await withCatalog(
    {
      findAll: async () => {
        throw new Error('credencial-secreta');
      },
      findAuthors: async () => [],
    },
    async (url) => {
      const response = await fetch(`${url}/api/books`);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.equal(JSON.parse(body).error.code, 'CATALOG_UNAVAILABLE');
      assert.ok(!body.includes('credencial-secreta'));
    },
  );
});

test('SCRUM-13 no expone escrituras ni una ficha de detalle', async () => {
  await withCatalog({ findAll: async () => [], findAuthors: async () => [] }, async (url) => {
    const response = await fetch(`${url}/api/books`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    assert.equal((await fetch(`${url}/api/books/1`)).status, 404);
  });
});
