import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import type { CatalogResponse } from './book';

export interface CatalogSearchCriteria {
  readonly title?: string;
  readonly authorIds?: readonly string[];
  readonly subjectIds?: readonly string[];
}

// Public endpoint: no session, credentials or personal data are required.
export const CATALOG_URL = new InjectionToken<string>('CATALOG_URL', {
  providedIn: 'root',
  factory: () => '/api/books',
});

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(CATALOG_URL);

  findAll(criteria: CatalogSearchCriteria = {}) {
    const params: Record<string, string | readonly string[]> = {};
    if (criteria.title?.trim()) params['title'] = criteria.title.trim();
    if (criteria.authorIds?.length) params['authorIds'] = criteria.authorIds;
    if (criteria.subjectIds?.length) params['subjectIds'] = criteria.subjectIds;
    return this.http.get<CatalogResponse>(this.url, {
      params,
    });
  }
}
