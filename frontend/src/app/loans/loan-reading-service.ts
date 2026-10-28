import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';

export interface ReadingAccess { readonly url: string; readonly expiresAt: string }
export interface ReadableLoans {
  readonly ownerId: string;
  readonly serverTime: string;
  readonly loans: readonly { readonly id: string; readonly bookId: string; readonly dueAt: string }[];
}

@Injectable({ providedIn: 'root' })
export class LoanReadingService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  findReadable() {
    return this.auth.protectedRequest(() => this.http.get<ReadableLoans>('/api/loans/readable'));
  }

  open(loanId: string) {
    return this.auth.protectedRequest(() => this.http.post<ReadingAccess>(
      `/api/loans/${encodeURIComponent(loanId)}/read-access`, null,
      { headers: { 'X-Biblioteca-Request': '1' } },
    ));
  }
}
