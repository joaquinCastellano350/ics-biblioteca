import type { CatalogTerm } from '../book/book.js';
import type { SubjectRepositoryInterface } from './subject-repository-interface.js';

export class SubjectController {
  constructor(private readonly subjects: SubjectRepositoryInterface) {}

  async findAll(): Promise<{ readonly subjects: readonly CatalogTerm[] }> {
    return { subjects: await this.subjects.findAll() };
  }
}
