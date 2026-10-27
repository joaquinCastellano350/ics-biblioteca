import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { CatalogBook, CatalogTerm } from './book.js';
import type { BookRepositoryInterface, BookSearchCriteria } from './book-repository-interface.js';

export class BookRepository implements BookRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, 'book' | 'author' | '$queryRaw'>) {}

  async findAll(criteria: BookSearchCriteria = {}): Promise<readonly CatalogBook[]> {
    const title = criteria.title?.trim();
    const matchingIds = title
      ? await this.database.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM books
          WHERE strpos(
            regexp_replace(
              normalize(lower(title), NFD),
              '[' || chr(768) || '-' || chr(879) || ']',
              '',
              'g'
            ),
            regexp_replace(
              normalize(lower(${title}), NFD),
              '[' || chr(768) || '-' || chr(879) || ']',
              '',
              'g'
            )
          ) > 0
        `
      : undefined;
    if (matchingIds?.length === 0) return [];

    const authorIds = [...new Set(criteria.authorIds ?? [])];
    const subjectIds = [...new Set(criteria.subjectIds ?? [])];
    const where: Prisma.BookWhereInput = {
      ...(matchingIds ? { id: { in: matchingIds.map(({ id }) => id) } } : {}),
      ...(authorIds.length
        ? { authors: { some: { authorId: { in: authorIds } } } }
        : {}),
      ...(subjectIds.length
        ? { subjects: { some: { subjectId: { in: subjectIds } } } }
        : {}),
    };
    const rows = await this.database.book.findMany({
      // Un viaje a PostgreSQL para libros, autores y materias.
      relationLoadStrategy: 'join',
      ...(Object.keys(where).length ? { where } : {}),
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        authors: {
          orderBy: [{ author: { name: 'asc' } }, { authorId: 'asc' }],
          select: { author: { select: { id: true, name: true } } },
        },
        subjects: {
          orderBy: [{ subject: { name: 'asc' } }, { subjectId: 'asc' }],
          select: { subject: { select: { id: true, name: true } } },
        },
      },
    });
    return rows.map(({ id, title, authors, subjects }) => ({
      id,
      title,
      authors: authors.map(({ author }) => author),
      subjects: subjects.map(({ subject }) => subject),
    }));
  }

  async findAuthors(query = ''): Promise<readonly CatalogTerm[]> {
    const search = query.trim();
    return this.database.author.findMany({
      ...(search ? { where: { name: { contains: search, mode: 'insensitive' } } } : {}),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  }
}
