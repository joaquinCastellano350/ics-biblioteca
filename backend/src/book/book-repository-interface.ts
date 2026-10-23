import type { CatalogBook } from './book.js';

export interface BookRepositoryInterface {
  findAll(criteria?: BookSearchCriteria): Promise<readonly CatalogBook[]>;
}

/** Optional catalog criteria; future filters can be added without changing the query flow. */
export interface BookSearchCriteria {
  readonly title?: string;
  readonly authorIds?: readonly string[];
  readonly subjectIds?: readonly string[];
}
