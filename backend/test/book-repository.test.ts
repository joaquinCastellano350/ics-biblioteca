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
    await database.client.book.create({
      data: { title: 'Introducci\u00f3n a la Ciencia', titleSearch: 'INCONSISTENTE', pdfObjectKey: 'test.pdf', totalCopies: 1 },
    });
    await database.client.book.create({
      data: {
        title: `Ping\u00fcino del a\u00f1o`,
        titleSearch: 'intencionalmente-incorrecto',
        pdfObjectKey: 'test-pinguino.pdf',
        totalCopies: 1,
      },
    });
    const books = await repository.findAll();
    assert.equal(books.length, 4);
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
    assert.deepEqual((await repository.findAll({ title: 'INTRODUCCION A LA cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await repository.findAll({ title: 'introducci\u00f3n a la cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await repository.findAll({ title: 'red' })).map(({ title }) => title), ['Redes']);
    assert.deepEqual((await repository.findAll({ title: 'PINGUINO DEL ANO' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await repository.findAll({ title: 'ping\u00fcino del a\u00f1o' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await repository.findAll({ title: 'ingui' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual(await repository.findAll({ title: 'no existe' }), []);
    assert.equal((await repository.findAll({ title: '   ' })).length, 4);
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
