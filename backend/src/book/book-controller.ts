import type { BookRepositoryInterface } from './book-repository-interface.js';
import type { CatalogBook } from './book.js';

export class BookController {
  constructor(private readonly books: BookRepositoryInterface) {}

  // Esta lectura pública no recibe datos de escritura ni necesita sesión.
  // Las validaciones de carga, cupos y circulación pertenecen a sus operaciones.
  async findAll(): Promise<{ readonly books: readonly CatalogBook[] }> {
    const books = await this.books.findAll();
    return {
      books: books.map(({ id, title, authors, subjects }) => ({
        id,
        title,
        authors: authors.map(({ id, name }) => ({ id, name })),
        subjects: subjects.map(({ id, name }) => ({ id, name })),
      })),
    };
  }
}
