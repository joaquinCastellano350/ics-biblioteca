import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';
import type { GrantedLoan } from './loan-service';

export interface AcceptedReservation {
  readonly loan: GrantedLoan;
  readonly created: boolean;
  readonly active: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReservationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  accept(id: string) {
    return this.auth.protectedRequest(() => this.http.post<AcceptedReservation>(
      `/api/reservations/${encodeURIComponent(id)}/accept`, {}, { headers: { 'X-Biblioteca-Request': '1' } },
    ));
  }
}
