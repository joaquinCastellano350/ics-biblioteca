import { describe, expect, it } from 'vitest';
import type { CatalogBook } from './catalog-book';
import { filterCatalogBooksByTitle } from './filter-catalog-books-by-title';

describe('filterCatalogBooksByTitle', () => {
  const books: CatalogBook[] = [
    { id: 'book-1', title: 'La búsqueda del tiempo perdido', authors: [], subjects: [] },
    { id: 'book-2', title: 'Introducción a la programación', authors: [], subjects: [] },
    { id: 'book-3', title: 'Historia de la ciencia', authors: [], subjects: [] },
  ];

  it('encuentra coincidencias parciales solo en el título y permite recalcular mientras cambia el texto', () => {
    expect(filterCatalogBooksByTitle(books, 'búsqueda del tiempo').map((book) => book.id)).toEqual(['book-1']);
    expect(filterCatalogBooksByTitle(books, 'Ada Lovelace')).toEqual([]);
    expect(filterCatalogBooksByTitle(books, 'ciencia').map((book) => book.id)).toEqual(['book-3']);
  });

  it('ignora mayúsculas y tildes tanto en el título como en la búsqueda', () => {
    expect(filterCatalogBooksByTitle(books, 'INTRODUCCION A LA PROGRAMACION').map((book) => book.id)).toEqual([
      'book-2',
    ]);
  });

  it('al vaciar la búsqueda devuelve completa la lista recibida con autor y materia ya aplicados', () => {
    const booksWithExistingAuthorAndSubjectFilters = [books[2]];

    expect(filterCatalogBooksByTitle(booksWithExistingAuthorAndSubjectFilters, 'cualquier texto')).toEqual([]);
    expect(filterCatalogBooksByTitle(booksWithExistingAuthorAndSubjectFilters, '')).toEqual(
      booksWithExistingAuthorAndSubjectFilters,
    );
  });

  it('devuelve una lista vacía cuando ningún título coincide', () => {
    expect(filterCatalogBooksByTitle(books, 'título inexistente')).toEqual([]);
  });
});
