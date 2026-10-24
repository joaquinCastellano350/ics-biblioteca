import type { CatalogTerm } from '../book/book.js';

export interface SubjectRepositoryInterface {
  findAll(): Promise<readonly CatalogTerm[]>;
}
