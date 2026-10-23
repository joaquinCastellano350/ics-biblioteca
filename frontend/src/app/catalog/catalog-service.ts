import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import type { CatalogResponse } from './book';

// Public endpoint: no session, credentials or personal data are required.
export const CATALOG_URL = new InjectionToken<string>('CATALOG_URL', {
  providedIn: 'root',
  factory: () => '/api/books',
});

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(CATALOG_URL);

  findAll() {
    return this.http.get<CatalogResponse>(this.url);
  }
}
