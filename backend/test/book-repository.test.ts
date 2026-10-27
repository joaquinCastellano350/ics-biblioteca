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
        title: 'Introducción a Redes',
        titleSearch: 'introduccion a redes',
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
            { subject: { create: { name: 'Zoología avanzada' } } },
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
    assert.deepEqual(booksByAnySelectedAuthor.map(({ title }) => title), ['Algoritmos', 'Introducción a Redes']);
    assert.deepEqual((await repository.findAll({ authorIds: [zoe.id] })).map(({ title }) => title), ['Introducción a Redes']);
    assert.deepEqual(await repository.findAll({ authorIds: [authorWithoutBooks.id] }), []);
    await database.client.book.create({
      data: { title: 'Introducción a la Ciencia', titleSearch: 'INCONSISTENTE', pdfObjectKey: 'test.pdf', totalCopies: 1 },
    });
    await database.client.book.create({
      data: {
        title: 'Pingüino del año',
        titleSearch: 'intencionalmente-incorrecto',
        pdfObjectKey: 'test-pinguino.pdf',
        totalCopies: 1,
      },
    });
    const books = await repository.findAll();
    const networkSubject = await database.client.subject.findFirstOrThrow({ where: { name: 'Redes' } });
    const algorithmSubject = await database.client.subject.findFirstOrThrow({ where: { name: 'Algoritmos' } });
    assert.deepEqual(
      (await repository.findAll({
        title: 'introduccion',
        authorIds: [zoe.id],
        subjectIds: [networkSubject.id],
      })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(
      await repository.findAll({
        title: 'introduccion',
        authorIds: [zoe.id],
        subjectIds: [algorithmSubject.id],
      }),
      [],
    );
    const matchingEitherSubject = await repository.findAll({
      subjectIds: [networkSubject.id, algorithmSubject.id],
    });
    assert.deepEqual(matchingEitherSubject.map(({ title }) => title), ['Algoritmos', 'Introducción a Redes']);
    assert.deepEqual(
      (await repository.findAll({ title: 'INTRODUCCION', subjectIds: [networkSubject.id] })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(
      await repository.findAll({ title: 'INTRODUCCION', subjectIds: [algorithmSubject.id] }),
      [],
    );
    const subjectBeyondShortCard = await database.client.subject.findFirstOrThrow({
      where: { name: 'Zoología avanzada' },
    });
    const matchByLessVisibleSubject = await repository.findAll({ subjectIds: [subjectBeyondShortCard.id] });
    assert.deepEqual(matchByLessVisibleSubject.map(({ title }) => title), ['Introducción a Redes']);
    assert.ok(matchByLessVisibleSubject[0]?.subjects.some(({ id }) => id === subjectBeyondShortCard.id));
    assert.deepEqual((await repository.findAll({ subjectIds: [] })).length, 4);
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
      ['Redes', 'Sistemas', 'Zoología avanzada'],
    );
    assert.ok(!JSON.stringify(books).includes('private/'));
    assert.deepEqual((await repository.findAll({ title: 'INTRODUCCION A LA cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await repository.findAll({ title: 'introducci\u00f3n a la cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await repository.findAll({ title: 'red' })).map(({ title }) => title), ['Introducción a Redes']);
    assert.deepEqual((await repository.findAll({ title: 'PINGUINO DEL ANO' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await repository.findAll({ title: 'ping\u00fcino del a\u00f1o' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await repository.findAll({ title: 'ingui' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual(await repository.findAll({ title: 'no existe' }), []);
    assert.equal((await repository.findAll({ title: '   ' })).length, 4);
    assert.deepEqual(
      (await repository.findAll({ title: 'red', authorIds: [zoe.id] })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(await repository.findAll({ title: 'algo', authorIds: [zoe.id] }), []);
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
