import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { RegistrationRequest, RegistrationResponse } from './registration.types';

@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private readonly http = inject(HttpClient);

  register(data: RegistrationRequest): Observable<RegistrationResponse> {
    // Lista explícita: ningún estado del formulario ni dato adicional viaja al servidor.
    const { firstName, lastName, universityId, email, password } = data;
    return this.http.post<RegistrationResponse>('/api/auth/register', {
      firstName, lastName, universityId, email, password,
    }, { headers: { 'X-Biblioteca-Request': '1' } });
  }
}
