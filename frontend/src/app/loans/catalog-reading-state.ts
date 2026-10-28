import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { LoanReadingService } from './loan-reading-service';

interface ReadingSnapshot {
  readonly owner: string;
  readonly loans: readonly { id: string; bookId: string; monotonic: number; wall: number }[];
}

/** Estado privado acotado a la vida del catálogo; no consulta esperas ni reservas. */
@Injectable()
export class CatalogReadingState {
  private readonly auth = inject(AuthService);
  private readonly reading = inject(LoanReadingService);
  private readonly revision = signal(0);
  private readonly clock = signal(0);
  private readonly snapshot = signal<ReadingSnapshot | null>(null);
  private readonly owner = computed(() => {
    const session = this.auth.session();
    return this.auth.status() === 'authenticated' && !this.auth.authenticating() && session
      ? JSON.stringify([session.user.id, session.session.createdAt, session.session.expiresAt]) : null;
  });
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly checking = computed(() => this.owner() !== null && this.snapshot()?.owner !== this.owner());
  readonly loans = computed(() => {
    this.clock();
    const snapshot = this.snapshot();
    if (!snapshot || snapshot.owner !== this.owner()) return new Map<string, string>();
    return new Map(snapshot.loans.filter(loan => this.remaining(loan) > 0).map(loan => [loan.bookId, loan.id]));
  });

  constructor() {
    effect(onCleanup => {
      this.revision();
      const owner = this.owner();
      if (!owner) { this.snapshot.set(null); this.status.set('idle'); return; }
      // Descontar la petición completa es conservador ante latencia y reloj local desfasado.
      const monotonic = performance.now();
      const wall = Date.now();
      const userId = this.auth.session()!.user.id;
      this.status.set('loading');
      const request = this.reading.findReadable().subscribe({
        next: result => {
          if (this.owner() !== owner) return;
          const serverTime = Date.parse(result.serverTime);
          if (result.ownerId !== userId || !Number.isFinite(serverTime)
            || result.loans.some(loan => !Number.isFinite(Date.parse(loan.dueAt)))) {
            this.snapshot.set(null);
            this.status.set('error');
            return;
          }
          this.snapshot.set({ owner, loans: result.loans.map(loan => ({
            id: loan.id, bookId: loan.bookId,
            monotonic: monotonic + Date.parse(loan.dueAt) - serverTime,
            wall: wall + Date.parse(loan.dueAt) - serverTime,
          })) });
          this.status.set('ready');
        },
        error: () => { if (this.owner() === owner) this.status.set('error'); },
      });
      onCleanup(() => request.unsubscribe());
    });
    effect(onCleanup => {
      this.clock();
      const snapshot = this.snapshot();
      if (!snapshot) return;
      const remaining = snapshot.loans.map(loan => this.remaining(loan)).filter(value => value > 0);
      if (!remaining.length) return;
      // Solo un temporizador de vencimiento: no hace polling ni escribe cierres.
      const timeout = setTimeout(() => this.clock.update(value => value + 1), Math.min(2_147_483_647, Math.ceil(Math.min(...remaining))));
      onCleanup(() => clearTimeout(timeout));
    });
  }

  refresh(): void { this.revision.update(value => value + 1); }

  private remaining(loan: ReadingSnapshot['loans'][number]): number {
    return Math.min(loan.monotonic - performance.now(), loan.wall - Date.now());
  }
}
