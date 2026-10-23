// Entidad persistida: corresponde a books en el modelo de Confluence.
export interface Book {
  readonly id: string;
  readonly title: string;
  readonly titleSearch: string;
  readonly pdfObjectKey: string;
  readonly totalCopies: number;
  readonly createdAt: Date;
}

export interface CatalogTerm {
  readonly id: string;
  readonly name: string;
}

// Proyección de lectura pública, separada de los campos internos de la entidad.
export interface CatalogBook extends Pick<Book, 'id' | 'title'> {
  readonly authors: readonly CatalogTerm[];
  readonly subjects: readonly CatalogTerm[];
}
