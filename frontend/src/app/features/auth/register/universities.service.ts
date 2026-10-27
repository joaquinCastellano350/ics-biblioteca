import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { RegistrationUniversity } from './register';

export interface UniversitiesResponse {
  universities: RegistrationUniversity[];
}

@Injectable({ providedIn: 'root' })
export class UniversitiesService {
  private readonly http = inject(HttpClient);

  list(): Observable<RegistrationUniversity[]> {
    return this.http.get<UniversitiesResponse>('/api/universities').pipe(
      map((response) => response.universities),
    );
  }
}
