import type { BookRepositoryInterface, BookSearchCriteria } from './book-repository-interface.js';
import type { AvailableCatalogBook } from './book.js';
import type { CirculationController } from '../circulation/circulation-controller.js';

export class BookController {
  constructor(
    private readonly books: BookRepositoryInterface,
    private readonly circulation: Pick<CirculationController, 'findAvailability'> | undefined,
  ) {}

  // Esta lectura pública no recibe datos de escritura ni necesita sesión.
  // Las validaciones de carga, cupos y circulación pertenecen a sus operaciones.
  async findAll(criteria: BookSearchCriteria = {}): Promise<{ readonly books: readonly AvailableCatalogBook[] }> {
    const books = await this.books.findAll(criteria);
    if (books.length === 0) return { books: [] };
    if (!this.circulation) throw new Error('La disponibilidad no está configurada.');
    // Una consulta por lote; la API entrega metadatos y conteo juntos.
    const availability = new Map((await this.circulation.findAvailability(books.map(({ id }) => id)))
      .map((item) => [item.bookId, item]));
    return {
      books: books.map(({ id, title, authors, subjects }) => {
        const counts = availability.get(id);
        if (!counts) throw new Error('No se pudo obtener la disponibilidad de un libro.');
        return {
          id,
          title,
          authors: authors.map(({ id, name }) => ({ id, name })),
          subjects: subjects.map(({ id, name }) => ({ id, name })),
          availability: { availableCopies: counts.availableCopies, totalCopies: counts.totalCopies },
        };
      }),
    };
  }

  async findAuthors(query?: string) {
    return { authors: await this.books.findAuthors(query) };
  }
}
