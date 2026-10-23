import type { CatalogBook, CatalogTerm } from './book.js';

export interface BookRepositoryInterface {
  findAll(criteria?: BookSearchCriteria): Promise<readonly CatalogBook[]>;
  findAuthors(query?: string): Promise<readonly CatalogTerm[]>;
}

export interface BookSearchCriteria {
  readonly authorIds?: readonly string[];
}
