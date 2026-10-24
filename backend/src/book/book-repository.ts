import type { PrismaClient } from '../generated/prisma/client.js';
import type { CatalogBook, CatalogTerm } from './book.js';
import type { BookRepositoryInterface, BookSearchCriteria } from './book-repository-interface.js';

export class BookRepository implements BookRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, 'book' | 'author'>) {}

  async findAll(criteria: BookSearchCriteria = {}): Promise<readonly CatalogBook[]> {
    const authorIds = [...new Set(criteria.authorIds ?? [])];
    const rows = await this.database.book.findMany({
      ...(authorIds.length ? { where: { authors: { some: { authorId: { in: authorIds } } } } } : {}),
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
    const authors = await this.database.author.findMany({
      ...(search ? { where: { name: { contains: search, mode: 'insensitive' } } } : {}),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    return authors;
  }
}
