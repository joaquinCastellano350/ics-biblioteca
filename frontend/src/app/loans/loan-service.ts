import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthService } from '../auth/auth.service';

export interface GrantedLoan {
  readonly id: string;
  readonly bookId: string;
  readonly startedAt: string;
  readonly dueAt: string;
}

@Injectable({ providedIn: 'root' })
export class LoanService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  request(bookId: string) {
    return this.auth.protectedRequest(() => this.http.post<{ readonly loan: GrantedLoan }>('/api/loans', { bookId }, {
      headers: { 'X-Biblioteca-Request': '1' },
    }));
  }
}
