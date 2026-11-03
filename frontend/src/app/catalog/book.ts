export interface CatalogTerm {
  readonly id: string;
  readonly name: string;
}

export interface Book {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly CatalogTerm[];
  readonly subjects: readonly CatalogTerm[];
  readonly availability: {
    readonly availableCopies: number;
    readonly totalCopies: number;
  };
}

export interface CatalogResponse {
  readonly books: readonly Book[];
  readonly total: number;
}
