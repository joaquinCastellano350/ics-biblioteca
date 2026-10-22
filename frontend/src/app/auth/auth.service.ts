import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { defer, finalize, fromEvent, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AuthResponse } from './auth.types';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private restoring = false;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly session = signal<AuthResponse | null>(null);
  readonly status = signal<'loading' | 'anonymous' | 'authenticated' | 'unavailable'>('loading');
  readonly loginRequested = signal(false);

  constructor() {
    fromEvent(window, 'focus').pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.status() === 'authenticated' && !this.loginRequested()) this.restore();
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.expiryTimer));
  }

  restore(): void {
    if (this.restoring) return;
    this.restoring = true;
    const generation = ++this.generation;
    const revalidating = this.status() === 'authenticated' && this.session() !== null;
    // La primera carga espera confirmación; una revalidación conserva la cuenta visible.
    if (!revalidating) {
      this.session.set(null);
      this.status.set('loading');
    }
    this.http.get<AuthResponse>('/api/auth/session').pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.restoring = false; }),
    ).subscribe({
      next: (response) => { if (generation === this.generation) this.accept(response); },
      error: (error: HttpErrorResponse) => {
        if (generation !== this.generation) return;
        // Un fallo temporal no equivale a una sesión inválida ni cambia su vencimiento.
        if (revalidating && (error.status === 0 || error.status >= 500)) return;
        clearTimeout(this.expiryTimer);
        this.session.set(null);
        this.status.set(error.status === 401 ? 'anonymous' : 'unavailable');
      },
    });
  }

  login(email: string, password: string) {
    return defer(() => {
      const generation = ++this.generation;
      return this.http.post<AuthResponse>('/api/auth/login', { email: email.trim(), password }, {
        headers: { 'X-Biblioteca-Request': '1' },
      }).pipe(tap((response) => {
        if (generation === this.generation) {
          this.generation += 1;
          this.accept(response);
          this.loginRequested.set(false);
        }
      }));
    });
  }

  openLogin(): void { this.loginRequested.set(true); }
  cancelLogin(): void { this.loginRequested.set(false); }

  /** El llamador ejecuta su acción solo si devuelve true; no se guarda un callback. */
  ensureAuthenticated(): boolean {
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
      this.generation += 1;
      this.session.set(null);
      this.status.set('anonymous');
    }, remaining);
  }
}
