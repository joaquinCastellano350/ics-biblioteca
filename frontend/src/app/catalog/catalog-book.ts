/** Campos que necesita la búsqueda pública por título. */
export interface CatalogBook {
  id: string;
  title: string;
  authors: readonly string[];
  subjects: readonly string[];
}
