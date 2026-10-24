export interface CatalogTerm {
  readonly id: string;
  readonly name: string;
}

export interface Book {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly CatalogTerm[];
  readonly subjects: readonly CatalogTerm[];
}

export interface CatalogResponse {
  readonly books: readonly Book[];
}
