import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Subject, defer, finalize, fromEvent, map, takeUntil, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AuthResponse, RegistrationRequest } from './auth.types';
import { normalizeEmail } from './auth.validation';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private expiryGeneration = 0;
  private restoring = false;
  private readonly logoutStarted = new Subject<void>();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly session = signal<AuthResponse | null>(null);
  readonly status = signal<'loading' | 'anonymous' | 'authenticated' | 'unavailable'>('loading');
  readonly loginRequested = signal(false);
  readonly authenticating = signal(false);
  readonly loggingOut = signal(false);

  constructor() {
    fromEvent(window, 'focus').pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.status() === 'authenticated' && !this.loginRequested() && !this.authenticating()) this.restore();
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.expiryTimer));
  }

  restore(): void {
    if (this.restoring || this.authenticating()) return;
    this.restoring = true;
    const generation = this.generation;
    const expiryGeneration = this.expiryGeneration;
    const revalidating = this.status() === 'authenticated' && this.session() !== null;
    // La primera carga espera confirmación; una revalidación conserva la cuenta visible.
    if (!revalidating) {
      this.session.set(null);
      this.status.set('loading');
    }
    this.http.get<AuthResponse>('/api/auth/session').pipe(
      takeUntilDestroyed(this.destroyRef),
      takeUntil(this.logoutStarted),
      finalize(() => { this.restoring = false; }),
    ).subscribe({
      next: (response) => {
        if (generation === this.generation && expiryGeneration === this.expiryGeneration) this.accept(response);
      },
      error: (error: HttpErrorResponse) => {
        if (generation !== this.generation || expiryGeneration !== this.expiryGeneration) return;
        // Un fallo temporal no equivale a una sesión inválida ni cambia su vencimiento.
        if (revalidating && (error.status === 0 || error.status >= 500)) return;
        clearTimeout(this.expiryTimer);
        this.session.set(null);
        this.status.set(error.status === 401 ? 'anonymous' : 'unavailable');
      },
    });
  }

  login(email: string, password: string) {
    return this.authenticate('/api/auth/login', { email: normalizeEmail(email), password });
  }

  register(data: RegistrationRequest) {
    const { firstName, lastName, universityId, email, password } = data;
    return this.authenticate('/api/auth/register', {
      firstName, lastName, universityId, email: normalizeEmail(email), password,
    });
  }

  logout() {
    return defer(() => {
      // Serializar las mutaciones: cancelar login/registro no revierte su Set-Cookie.
      if (this.authenticating()) return EMPTY;
      this.authenticating.set(true);
      this.loggingOut.set(true);
      this.generation += 1;
      this.logoutStarted.next();
      return this.http.post<void>('/api/auth/logout', null, {
        headers: { 'X-Biblioteca-Request': '1' },
        observe: 'response',
      }).pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((response) => {
          if (response.status !== 204) throw new Error('No se confirmó el cierre de sesión.');
          this.generation += 1;
          this.expiryGeneration += 1;
          clearTimeout(this.expiryTimer);
          this.expiryTimer = undefined;
          this.session.set(null);
          this.status.set('anonymous');
          this.loginRequested.set(false);
        }),
        map(() => undefined),
        finalize(() => {
          this.loggingOut.set(false);
          this.authenticating.set(false);
          // Una restauración inicial cancelada no debe dejar la aplicación cargando.
          if (this.status() === 'loading') this.status.set('unavailable');
        }),
      );
    });
  }

  private authenticate(url: string, body: object) {
    return defer(() => {
      // Una sola mutación por pestaña: ignorar un DTO no revierte su Set-Cookie.
      if (this.authenticating()) return EMPTY;
      this.authenticating.set(true);
      const generation = ++this.generation;
      return this.http.post<AuthResponse>(url, body, {
        headers: { 'X-Biblioteca-Request': '1' },
      }).pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((response) => {
          if (generation === this.generation) {
            this.generation += 1;
            this.accept(response);
            this.loginRequested.set(false);
          }
        }),
        finalize(() => {
          this.authenticating.set(false);
          // La consulta inicial anterior quedó invalidada; su respuesta ya no decide el estado.
          if (generation === this.generation && this.status() === 'loading') this.status.set('unavailable');
        }),
      );
    });
  }

  openLogin(): void { if (!this.authenticating()) this.loginRequested.set(true); }
  cancelLogin(): void { this.loginRequested.set(false); }

  /** El llamador ejecuta su acción solo si devuelve true; no se guarda un callback. */
  ensureAuthenticated(): boolean {
    if (this.authenticating()) return false;
    if (this.status() === 'authenticated') return true;
    if (this.status() === 'anonymous') this.openLogin();
    return false;
  }

  private accept(response: AuthResponse): void {
    clearTimeout(this.expiryTimer);
    const remaining = Date.parse(response.session.expiresAt) - Date.parse(response.serverTime);
    if (!(remaining > 0)) {
      this.session.set(null);
      this.status.set('anonymous');
      return;
    }
    this.session.set(response);
    this.status.set('authenticated');
    this.expiryTimer = setTimeout(() => {
      // Invalida consultas de la sesión vencida sin descartar un login nuevo en curso.
      this.expiryGeneration += 1;
      this.session.set(null);
      this.status.set('anonymous');
    }, remaining);
  }
}
