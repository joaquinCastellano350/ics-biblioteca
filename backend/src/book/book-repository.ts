import type { PrismaClient } from '../generated/prisma/client.js';
import type { CatalogBook } from './book.js';
import type { BookRepositoryInterface, BookSearchCriteria } from './book-repository-interface.js';

export class BookRepository implements BookRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, 'book' | '$queryRaw'>) {}

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
    const rows = await this.database.book.findMany({
      ...(matchingIds ? { where: { id: { in: matchingIds.map(({ id }) => id) } } } : {}),
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
