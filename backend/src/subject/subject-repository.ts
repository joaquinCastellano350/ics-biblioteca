import type { PrismaClient } from '../generated/prisma/client.js';
import type { CatalogTerm } from '../book/book.js';
import type { SubjectRepositoryInterface } from './subject-repository-interface.js';

export class SubjectRepository implements SubjectRepositoryInterface {
  constructor(private readonly database: Pick<PrismaClient, 'subject'>) {}

  async findAll(): Promise<readonly CatalogTerm[]> {
    return this.database.subject.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  }
}
