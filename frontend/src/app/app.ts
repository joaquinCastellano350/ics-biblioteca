import { Component, DestroyRef, computed, inject, linkedSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { LoginDialog } from './auth/login-dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, LoginDialog, ButtonModule, MessageModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutSession = computed(() => {
    const current = this.auth.session();
    return current ? JSON.stringify([current.user.id, current.session.createdAt, current.session.expiresAt]) : null;
  });
  protected readonly logoutError = linkedSignal({ source: this.logoutSession, computation: () => '' });
  constructor() { this.auth.restore(); }

  protected logout(): void {
    if (this.auth.authenticating()) return;
    const session = this.logoutSession();
    this.logoutError.set('');
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: () => {
        if (session !== null && session === this.logoutSession()) {
          this.logoutError.set('No pudimos cerrar tu sesión. Intentá nuevamente.');
        }
      },
    });
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main-content')?.focus();
  }
}
