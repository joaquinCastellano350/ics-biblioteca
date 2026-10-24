import type { CatalogBook } from './book.js';

export interface BookRepositoryInterface {
  findAll(): Promise<readonly CatalogBook[]>;
}
