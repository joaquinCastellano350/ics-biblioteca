import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';

export interface ReadingAccess { readonly url: string; readonly expiresAt: string }

@Injectable({ providedIn: 'root' })
export class LoanReadingService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  open(loanId: string) {
    return this.auth.protectedRequest(() => this.http.post<ReadingAccess>(
      `/api/loans/${encodeURIComponent(loanId)}/read-access`, null,
      { headers: { 'X-Biblioteca-Request': '1' } },
    ));
  }
}
