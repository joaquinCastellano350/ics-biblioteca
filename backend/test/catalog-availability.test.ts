import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { BookRepository } from '../src/book/book-repository.js';
import { CirculationRepository } from '../src/circulation/circulation-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('GET /api/books integra metadatos, filtros y disponibilidad real en una respuesta pública', async () => {
  const fixture = await catalogDatabase();
  const db = fixture.client;
  const server = createApp({
    checkDatabase: async () => {}, checkStorage: async () => {},
    books: new BookRepository(db), circulation: new CirculationRepository(db),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const book = await db.book.create({ data: {
      title: 'Redes de datos', titleSearch: 'redes de datos', pdfObjectKey: 'privado/redes.pdf', totalCopies: 2,
      authors: { create: { author: { create: { name: 'Autora' } } } },
      subjects: { create: { subject: { create: { name: 'Redes' } } } },
    }, include: { authors: true, subjects: true } });
    const zero = await db.book.create({ data: {
      title: 'Sin capacidad', titleSearch: 'sin capacidad', pdfObjectKey: 'privado/otro.pdf', totalCopies: 0,
    } });
    const response = await fetch(`${base}/api/books`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const all = await response.json();
    assert.equal(all.books.length, 2);
    assert.deepEqual(all.books.find((item: { id: string }) => item.id === zero.id).availability, { availableCopies: 0, totalCopies: 0 });
    assert.ok(!JSON.stringify(all).includes('privado/'));

    const university = await db.university.create({ data: { name: 'Universidad' } });
    const user = await db.user.create({ data: {
      firstName: 'Estudiante', lastName: 'Prueba', universityId: university.id, email: 'disponibilidad@example.org', passwordHash: 'fixture',
    } });
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT transaction_timestamp() AS now`;
    await db.loan.create({ data: {
      userId: user.id, bookId: book.id, startedAt: clock!.now,
      dueAt: new Date(clock!.now.getTime() + 480 * 3_600_000),
    } });
    const filtered = await fetch(`${base}/api/books?title=REDES&authorIds=${book.authors[0]!.authorId}&subjectIds=${book.subjects[0]!.subjectId}`);
    assert.equal(filtered.status, 200);
    const selected = await filtered.json();
    assert.equal(selected.books.length, 1);
    assert.equal(selected.books[0].title, book.title);
    assert.equal(selected.books[0].authors.length, 1);
    assert.equal(selected.books[0].subjects.length, 1);
    assert.deepEqual(selected.books[0].availability, { availableCopies: 1, totalCopies: 2 });
    assert.ok(!JSON.stringify(selected).includes(user.id));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.close();
  }
});
