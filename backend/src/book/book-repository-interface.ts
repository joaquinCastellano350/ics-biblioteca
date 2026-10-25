import type { CatalogBook, CatalogTerm } from './book.js';

export interface BookRepositoryInterface {
  findAll(criteria?: BookSearchCriteria): Promise<readonly CatalogBook[]>;
  findAuthors(query?: string): Promise<readonly CatalogTerm[]>;
}

/** Optional catalog criteria; future filters can be added without changing the query flow. */
export interface BookSearchCriteria {
  readonly title?: string;
  readonly authorIds?: readonly string[];
  readonly subjectIds?: readonly string[];
}
