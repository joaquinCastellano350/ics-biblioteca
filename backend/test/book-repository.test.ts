import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookRepository } from '../src/book/book-repository.js';
import { catalogDatabase } from './catalog-database.js';
import type { BookSearchCriteria } from '../src/book/book-repository-interface.js';

async function findBooks(repository: BookRepository, criteria?: BookSearchCriteria) {
  return (await repository.findAll(criteria)).books;
}

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
    assert.deepEqual(await findBooks(repository), []);
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
    const booksByAnySelectedAuthor = await findBooks(repository, { authorIds: [zoe.id, otherAuthor.id] });
    assert.deepEqual(booksByAnySelectedAuthor.map(({ title }) => title), ['Algoritmos', 'Introducción a Redes']);
    assert.deepEqual((await findBooks(repository, { authorIds: [zoe.id] })).map(({ title }) => title), ['Introducción a Redes']);
    assert.deepEqual(await findBooks(repository, { authorIds: [authorWithoutBooks.id] }), []);
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
    const books = await findBooks(repository);
    const networkSubject = await database.client.subject.findFirstOrThrow({ where: { name: 'Redes' } });
    const algorithmSubject = await database.client.subject.findFirstOrThrow({ where: { name: 'Algoritmos' } });
    assert.deepEqual(
      (await findBooks(repository, {
        title: 'introduccion',
        authorIds: [zoe.id],
        subjectIds: [networkSubject.id],
      })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(
      await findBooks(repository, {
        title: 'introduccion',
        authorIds: [zoe.id],
        subjectIds: [algorithmSubject.id],
      }),
      [],
    );
    const matchingEitherSubject = await findBooks(repository, {
      subjectIds: [networkSubject.id, algorithmSubject.id],
    });
    assert.deepEqual(matchingEitherSubject.map(({ title }) => title), ['Algoritmos', 'Introducción a Redes']);
    assert.deepEqual(
      (await findBooks(repository, { title: 'INTRODUCCION', subjectIds: [networkSubject.id] })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(
      await findBooks(repository, { title: 'INTRODUCCION', subjectIds: [algorithmSubject.id] }),
      [],
    );
    const subjectBeyondShortCard = await database.client.subject.findFirstOrThrow({
      where: { name: 'Zoología avanzada' },
    });
    const matchByLessVisibleSubject = await findBooks(repository, { subjectIds: [subjectBeyondShortCard.id] });
    assert.deepEqual(matchByLessVisibleSubject.map(({ title }) => title), ['Introducción a Redes']);
    assert.ok(matchByLessVisibleSubject[0]?.subjects.some(({ id }) => id === subjectBeyondShortCard.id));
    assert.deepEqual((await findBooks(repository, { subjectIds: [] })).length, 4);
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
    assert.deepEqual((await findBooks(repository, { title: 'INTRODUCCION A LA cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await findBooks(repository, { title: 'introducci\u00f3n a la cien' })).map(({ title }) => title), ['Introducci\u00f3n a la Ciencia']);
    assert.deepEqual((await findBooks(repository, { title: 'red' })).map(({ title }) => title), ['Introducción a Redes']);
    assert.deepEqual((await findBooks(repository, { title: 'PINGUINO DEL ANO' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await findBooks(repository, { title: 'ping\u00fcino del a\u00f1o' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual((await findBooks(repository, { title: 'ingui' })).map(({ title }) => title), [`Ping\u00fcino del a\u00f1o`]);
    assert.deepEqual(await findBooks(repository, { title: 'no existe' }), []);
    assert.equal((await findBooks(repository, { title: '   ' })).length, 4);
    assert.deepEqual(
      (await findBooks(repository, { title: 'red', authorIds: [zoe.id] })).map(({ title }) => title),
      ['Introducción a Redes'],
    );
    assert.deepEqual(await findBooks(repository, { title: 'algo', authorIds: [zoe.id] }), []);
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

test('pagina 25 libros con total filtrado y orden estable entre titulos repetidos', async () => {
  const database = await catalogDatabase();
  try {
    const [author, subject] = await Promise.all([
      database.client.author.create({ data: { name: 'Autora de paginación' } }),
      database.client.subject.create({ data: { name: 'Materia de paginación' } }),
    ]);
    await database.client.book.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        title: 'Paginable', titleSearch: 'paginable',
        pdfObjectKey: `test/paginable-${index}.pdf`, totalCopies: 1,
      })),
    });
    const created = await database.client.book.findMany({ select: { id: true } });
    await Promise.all([
      database.client.bookAuthor.createMany({ data: created.map(({ id }) => ({ bookId: id, authorId: author.id })) }),
      database.client.bookSubject.createMany({ data: created.map(({ id }) => ({ bookId: id, subjectId: subject.id })) }),
    ]);
    const repository = new BookRepository(database.client);
    const pages = await Promise.all([1, 2, 3].map((page) => repository.findAll({ page })));
    assert.deepEqual(pages.map(({ books }) => books.length), [12, 12, 1]);
    assert.deepEqual(pages.map(({ total }) => total), [25, 25, 25]);
    const expected = (await database.client.book.findMany({ orderBy: [{ title: 'asc' }, { id: 'asc' }], select: { id: true } }))
      .map(({ id }) => id);
    const traversed = pages.flatMap(({ books }) => books.map(({ id }) => id));
    assert.deepEqual(traversed, expected);
    assert.equal(new Set(traversed).size, 25);
    const filtered = await Promise.all([1, 2, 3].map((page) => repository.findAll({ title: 'PAGINABLE', page })));
    assert.deepEqual(filtered.map(({ books }) => books.length), [12, 12, 1]);
    assert.deepEqual(filtered.map(({ total }) => total), [25, 25, 25]);
    const byAuthorAndSubject = await Promise.all([1, 2, 3].map((page) => repository.findAll({
      authorIds: [author.id], subjectIds: [subject.id], page,
    })));
    assert.deepEqual(byAuthorAndSubject.map(({ books }) => books.length), [12, 12, 1]);
    assert.deepEqual(byAuthorAndSubject.map(({ total }) => total), [25, 25, 25]);
    assert.deepEqual(await repository.findAll({ title: 'sin coincidencias' }), { books: [], total: 0 });
  } finally {
    await database.close();
  }
});
