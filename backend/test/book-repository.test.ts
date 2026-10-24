import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookRepository } from '../src/book/book-repository.js';
import { catalogDatabase } from './catalog-database.js';

test('Prisma lee las relaciones del catálogo sin duplicar libros ni autores homónimos', async () => {
  const database = await catalogDatabase();
  try {
    assert.deepEqual(
      await Promise.all([
        database.client.university.findMany(),
        database.client.user.findMany(),
        database.client.session.findMany(),
      ]),
      [[], [], []],
    );
    const repository = new BookRepository(database.client);
    assert.deepEqual(await repository.findAll(), []);
    const book = await database.client.book.create({
      data: {
        title: 'Redes',
        titleSearch: 'redes',
        pdfObjectKey: 'private/redes.pdf',
        totalCopies: 2,
        authors: {
          create: [
            { author: { create: { name: 'Zoe' } } },
            { author: { create: { name: 'Ana' } } },
            { author: { create: { name: 'Ana' } } },
          ],
        },
        subjects: {
          create: [
            { subject: { create: { name: 'Sistemas' } } },
            { subject: { create: { name: 'Redes' } } },
          ],
        },
      },
    });
    await database.client.book.create({
      data: {
        title: 'Algoritmos',
        titleSearch: 'algoritmos',
        pdfObjectKey: 'private/algoritmos.pdf',
        totalCopies: 0,
        authors: { create: { author: { create: { name: 'Otra autora' } } } },
        subjects: { create: { subject: { create: { name: 'Algoritmos' } } } },
      },
    });
    const authorWithoutBooks = await database.client.author.create({ data: { name: 'Autora sin libros' } });
    const authors = await repository.findAuthors();
    assert.deepEqual(authors.map(({ name }) => name), ['Ana', 'Ana', 'Autora sin libros', 'Otra autora', 'Zoe']);
    assert.deepEqual((await repository.findAuthors('OTRA')).map(({ name }) => name), ['Otra autora']);
    assert.deepEqual(await repository.findAuthors('no existe'), []);
    const zoe = authors.find(({ name }) => name === 'Zoe')!;
    const otherAuthor = authors.find(({ name }) => name === 'Otra autora')!;
    const booksByAnySelectedAuthor = await repository.findAll({ authorIds: [zoe.id, otherAuthor.id] });
    assert.deepEqual(booksByAnySelectedAuthor.map(({ title }) => title), ['Algoritmos', 'Redes']);
    assert.deepEqual((await repository.findAll({ authorIds: [zoe.id] })).map(({ title }) => title), ['Redes']);
    assert.deepEqual(await repository.findAll({ authorIds: [authorWithoutBooks.id] }), []);
    const books = await repository.findAll();
    assert.equal(books.length, 2);
    assert.equal(books[0]?.title, 'Algoritmos');
    const networks = books.find((entry) => entry.id === book.id)!;
    assert.deepEqual(
      networks.authors.map((author) => author.name),
      ['Ana', 'Ana', 'Zoe'],
    );
    assert.equal(new Set(networks.authors.map((author) => author.id)).size, 3);
    assert.deepEqual(
      networks.subjects.map((subject) => subject.name),
      ['Redes', 'Sistemas'],
    );
    assert.ok(!JSON.stringify(books).includes('private/'));
    await assert.rejects(
      database.client.book.create({
        data: {
          title: 'Inválido',
          titleSearch: 'invalido',
          pdfObjectKey: 'test.pdf',
          totalCopies: -1,
        },
      }),
    );
  } finally {
    await database.close();
  }
});
