import type { PrismaClient } from '../generated/prisma/client.js';
import type { CatalogBook } from './book.js';
import type { BookRepositoryInterface } from './book-repository-interface.js';

export class BookRepository implements BookRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, 'book'>) {}

  async findAll(): Promise<readonly CatalogBook[]> {
    const rows = await this.database.book.findMany({
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
}
