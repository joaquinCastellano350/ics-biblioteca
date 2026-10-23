import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import type { CatalogResponse, CatalogTerm } from './book';

// Public endpoint: no session, credentials or personal data are required.
export const CATALOG_URL = new InjectionToken<string>('CATALOG_URL', {
  providedIn: 'root',
  factory: () => '/api/books',
});

export const AUTHOR_SEARCH_URL = new InjectionToken<string>('AUTHOR_SEARCH_URL', {
  providedIn: 'root',
  factory: () => '/api/authors',
});

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(CATALOG_URL);
  private readonly authorSearchUrl = inject(AUTHOR_SEARCH_URL);

  findAll(criteria: { readonly authorIds?: readonly string[] } = {}) {
    return this.http.get<CatalogResponse>(this.url, {
      params: criteria.authorIds?.length ? { authorIds: [...criteria.authorIds] } : {},
    });
  }

  searchAuthors(query: string) {
    const trimmedQuery = query.trim();
    return this.http.get<{ readonly authors: readonly CatalogTerm[] }>(this.authorSearchUrl, {
      params: trimmedQuery ? { q: trimmedQuery } : {},
    });
  }
}
