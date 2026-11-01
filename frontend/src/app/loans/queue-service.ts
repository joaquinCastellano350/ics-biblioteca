import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { map } from 'rxjs';

interface QueueEntryBase {
  readonly id: string;
  readonly book: { readonly id: string; readonly title: string };
  readonly joinedAt: string;
}

export type OpenQueueEntry = QueueEntryBase & (
  | { readonly state: 'WAITING'; readonly position: number }
  | { readonly state: 'OFFERED'; readonly position: null }
);

export interface QueueResponse {
  readonly serverTime: string;
  readonly entry: OpenQueueEntry;
}

@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  join(bookId: string) {
    return this.auth.protectedRequest(() => this.http.post<QueueResponse>('/api/queue-entries', { bookId }, {
      headers: { 'X-Biblioteca-Request': '1' },
    }));
  }

  cancel(entryId: string) {
    return this.auth.protectedRequest(() => this.http.post<void>(
      `/api/queue-entries/${encodeURIComponent(entryId)}/cancel`, {}, {
        headers: { 'X-Biblioteca-Request': '1', 'Content-Type': 'application/json' }, observe: 'response',
      },
    ).pipe(map(response => {
      if (response.status !== 204) throw new Error('No se confirmó la salida de la cola.');
    })));
  }
}
