import type { CatalogBook } from './catalog-book';

/** Normaliza el texto para ignorar mayúsculas y tildes. */
export function normalizeCatalogTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Filtra por coincidencia parcial únicamente en el título. */
export function filterCatalogBooksByTitle(
  books: readonly CatalogBook[],
  query: string,
): CatalogBook[] {
  const normalizedQuery = normalizeCatalogTitle(query);
  if (!normalizedQuery) return [...books];

  return books.filter((book) => normalizeCatalogTitle(book.title).includes(normalizedQuery));
}
