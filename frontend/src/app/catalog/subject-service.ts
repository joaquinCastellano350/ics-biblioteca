import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CatalogTerm } from './book';

export interface SubjectsResponse {
  readonly subjects: readonly CatalogTerm[];
}

@Injectable({ providedIn: 'root' })
export class SubjectService {
  private readonly http = inject(HttpClient);

  findAll() {
    return this.http.get<SubjectsResponse>('/api/subjects');
  }
}
