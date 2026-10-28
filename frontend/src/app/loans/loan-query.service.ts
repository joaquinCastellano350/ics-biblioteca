import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { defer, finalize, fromEvent, shareReplay, Subject, Subscription, takeUntil, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { PersonalCirculation } from './loan-query.types';

interface Snapshot {
  readonly owner: string;
  readonly data: PersonalCirculation | null;
  readonly loading: boolean;
  readonly error: string;
  readonly serverTime: number;
  readonly receivedAt: number;
}

export interface BookCirculationState {
  readonly label: string;
  readonly detail: string;
  readonly disabledReason: string;
  readonly checking: boolean;
}

@Injectable({ providedIn: 'root' })
export class LoanQueryService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly consumers = signal(0);
  private readonly state = signal<Snapshot | null>(null);
  private readonly tick = signal(0);
  private readonly cancelled = new Subject<void>();
  private epoch = 0;
  private observedOwner: string | null = null;
  private inFlight: { owner: string; epoch: number; request: Observable<PersonalCirculation> } | undefined;
  private managed: Subscription | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly owner = computed(() => {
    const session = this.auth.session();
    return this.auth.status() === 'authenticated' && !this.auth.authenticating() && session
      ? JSON.stringify([session.user.id, session.session.createdAt, session.session.expiresAt]) : null;
  });
  private readonly current = computed(() => this.state()?.owner === this.owner() ? this.state() : null);
  readonly data = computed(() => this.current()?.data ?? null);
  readonly error = computed(() => this.current()?.error ?? '');
  readonly loading = computed(() => !!this.owner() && (!this.current() || this.current()!.loading));
  private readonly serverNow = computed(() => {
    const state = this.current();
    return state ? state.serverTime + Math.max(0, this.tick() - state.receivedAt) : 0;
  });
  readonly loans = computed(() => this.data()?.loans.filter(loan =>
    Date.parse(loan.startedAt) <= this.serverNow() && Date.parse(loan.dueAt) > this.serverNow()) ?? []);
  readonly reservations = computed(() => this.data()?.reservations.filter(reservation =>
    Date.parse(reservation.expiresAt) > this.serverNow()) ?? []);
  readonly limitReached = computed(() => !!this.data()
    && this.loans().length >= this.data()!.requestConstraints.maxActiveLoans);

  constructor() {
    effect(() => {
      const owner = this.owner();
      const consumers = this.consumers();
      untracked(() => {
        if (owner !== this.observedOwner) {
          this.observedOwner = owner;
          this.invalidate();
        }
        if (owner && consumers > 0 && !this.current()) this.refresh();
      });
    });
    fromEvent(window, 'focus').pipe(takeUntilDestroyed()).subscribe(() => {
      this.tick.set(performance.now());
      if (this.consumers() > 0 && this.owner()) this.refresh();
    });
    this.destroyRef.onDestroy(() => {
      this.cancelled.next();
      this.cancelled.complete();
      this.managed?.unsubscribe();
      clearInterval(this.timer);
    });
  }

  /** Un estado compartido mientras haya pantallas consumidoras; sin polling HTTP. */
  connect(destroyRef: DestroyRef): void {
    this.consumers.update(value => value + 1);
    if (this.consumers() === 1) {
      this.timer = setInterval(() => this.tick.set(performance.now()), 1000);
    }
    destroyRef.onDestroy(() => {
      this.consumers.update(value => value - 1);
      if (this.consumers() === 0) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.invalidate();
      }
    });
  }

  invalidate(): void {
    this.epoch += 1;
    this.cancelled.next();
    this.managed?.unsubscribe();
    this.inFlight = undefined;
    this.state.set(null);
  }

  refresh(): void {
    if (!this.owner() || this.current()?.loading) return;
    this.managed = this.findMine().subscribe({ error: () => {} });
  }

  findMine() {
    return defer(() => {
      const owner = this.owner();
      if (!owner) return this.auth.protectedRequest(() => this.http.get<PersonalCirculation>('/api/me/circulation'));
      if (owner !== this.observedOwner) {
        this.observedOwner = owner;
        this.invalidate();
      }
      if (this.inFlight?.owner === owner && this.inFlight.epoch === this.epoch) return this.inFlight.request;
      const epoch = this.epoch;
      const startedAt = performance.now();
      const current = () => this.owner() === owner && this.epoch === epoch;
      this.state.set({ owner, data: null, loading: true, error: '', serverTime: 0, receivedAt: startedAt });
      const request = this.auth.protectedRequest(() => this.http.get<PersonalCirculation>('/api/me/circulation')).pipe(
        takeUntil(this.cancelled),
        takeUntilDestroyed(this.destroyRef),
        tap({
          next: (data) => {
            if (!current()) return;
            const receivedAt = performance.now();
            const serverTime = Date.parse(data.serverTime) + Math.max(0, receivedAt - startedAt);
            this.tick.set(receivedAt);
            this.state.set({ owner, data, loading: false, error: '', serverTime, receivedAt });
          },
          error: () => {
            if (current()) this.state.update(state => state ? {
              ...state, data: null, error: 'No pudimos cargar tus préstamos y esperas. Intentá nuevamente.',
            } : null);
          },
        }),
        finalize(() => {
          if (this.inFlight?.owner === owner && this.inFlight.epoch === epoch) this.inFlight = undefined;
          if (current()) this.state.update(state => state ? { ...state, loading: false } : null);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.inFlight = { owner, epoch, request };
      return request;
    });
  }

  bookState(bookId: string): BookCirculationState | null {
    const checking = { label: 'Comprobando tus préstamos', detail: '', disabledReason: 'Comprobando tus préstamos', checking: true };
    if (this.auth.status() === 'loading' || this.auth.authenticating()) return checking;
    if (!this.owner()) return null;
    if (this.loading()) return checking;
    if (!this.data()) return null; // Un error no equivale a una denegación ni permite conservar bloqueos viejos.
    const loan = this.loans().find(item => item.book.id === bookId);
    if (loan) return { label: 'Lo tenés prestado', detail: `Vence el ${this.date(loan.dueAt)}`,
      disabledReason: 'Ya tenés este libro prestado.', checking: false };
    const reservation = this.reservations().find(item => item.book.id === bookId);
    if (reservation) return { label: 'Tu turno llegó', detail: `Hasta el ${this.date(reservation.expiresAt)}`,
      disabledReason: 'Tenés una reserva vigente para este libro.', checking: false };
    const wait = this.data()!.waits.find(item => item.book.id === bookId);
    if (wait) return { label: 'En espera', detail: `Tu posición en cola: ${wait.position}`,
      disabledReason: 'Ya estás esperando este libro.', checking: false };
    if (this.limitReached()) return { label: 'Tenés cinco préstamos activos', detail: '',
      disabledReason: 'Tenés cinco préstamos activos.', checking: false };
    // openQueueBookIds no determina por sí solo si una oferta sigue vigente.
    return null;
  }

  date(value: string): string {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value));
  }

  remaining(value: string): string {
    const minutes = Math.max(0, Math.ceil((Date.parse(value) - this.serverNow()) / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} días ${hours % 24} h`;
  }
}
