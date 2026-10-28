import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { BookRepositoryInterface } from '../src/book/book-repository-interface.js';
import type { CirculationRepositoryInterface } from '../src/circulation/circulation-repository-interface.js';

async function withCatalog(books: BookRepositoryInterface, check: (url: string) => Promise<void>,
  circulation: CirculationRepositoryInterface = {
    findOccupancy: async (ids) => ids.map((bookId) => ({ bookId, totalCopies: 4, activeLoans: 1, heldReservations: 1 })),
  }) {
  const app = createApp({
    checkDatabase: async () => {},
    checkStorage: async () => {},
    books,
    circulation,
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
    assert.deepEqual(Object.keys(result.books[0]), ['id', 'title', 'authors', 'subjects', 'availability']);
    assert.deepEqual(result.books[0].availability, { availableCopies: 2, totalCopies: 4 });
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

test('books endpoint accepts title, author IDs, and repeated subject IDs', async () => {
  let received: { title?: string; authorIds?: readonly string[]; subjectIds?: readonly string[] } | undefined;
  await withCatalog({
    findAll: async (criteria) => {
      received = criteria;
      return [];
    },
  }, async (url) => {
    const response = await fetch(
      `${url}/api/books?title=Redes&authorIds=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&subjectIds=11111111-1111-4111-8111-111111111111&subjectIds=22222222-2222-4222-8222-222222222222`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(received, {
      title: 'Redes',
      authorIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      subjectIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    });
    const invalid = await fetch(`${url}/api/books?subjectIds=not-a-uuid`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: { code: 'INVALID_QUERY' } });
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

test('el catálogo consulta disponibilidad en un solo lote y solo expone el conteo público', async () => {
  const ids = ['uno', 'dos'];
  let calls = 0;
  await withCatalog({
    findAll: async () => ids.map((id) => ({ id, title: id, authors: [], subjects: [] })),
    findAuthors: async () => [],
  }, async (url) => {
    const response = await fetch(`${url}/api/books`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(calls, 1);
    assert.deepEqual(result.books.map((book: { availability: unknown }) => book.availability), [
      { availableCopies: 0, totalCopies: 2 }, { availableCopies: 0, totalCopies: 2 },
    ]);
    assert.ok(!JSON.stringify(result).includes('activeLoans'));
    assert.equal((await fetch(`${url}/api/availability`)).status, 404);
  }, {
    findOccupancy: async (bookIds) => {
      calls++;
      assert.deepEqual(bookIds, ids);
      return bookIds.map((bookId) => ({ bookId, totalCopies: 2, activeLoans: 1, heldReservations: 1 }));
    },
  });
});

test('un fallo o un resultado incompleto de disponibilidad no inventa cupos', async () => {
  for (const fail of [false, true]) {
    await withCatalog({
      findAll: async () => [{ id: 'uno', title: 'Libro', authors: [], subjects: [] }],
      findAuthors: async () => [],
    }, async (url) => {
      const response = await fetch(`${url}/api/books`);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.equal(JSON.parse(body).error.code, 'CATALOG_UNAVAILABLE');
      assert.ok(!body.includes('privado'));
    }, { findOccupancy: async () => { if (fail) throw new Error('detalle privado'); return []; } });
  }
});
