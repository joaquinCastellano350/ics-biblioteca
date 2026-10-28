import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, linkedSignal, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../auth/auth.service';
import { LoanReadingService } from './loan-reading-service';

/** SCRUM-21 lo coloca en cada préstamo vigente: <app-read-book-button [loanId]="loan.id" />. */
@Component({
  selector: 'app-read-book-button',
  imports: [ButtonModule, MessageModule],
  template: `
    <button pButton type="button" (click)="read()"
      [disabled]="pending() || auth.authenticating() || auth.status() === 'loading' || auth.status() === 'unavailable'"
      [attr.aria-busy]="pending()" aria-label="Leer online (abre una pestaña nueva)">
      {{ pending() ? 'Abriendo…' : 'Leer online' }}
      <i class="pi pi-external-link" aria-hidden="true"></i>
    </button>
    @if (error()) { <p-message severity="error" role="alert">{{ error() }}</p-message> }
  `,
  styles: `
    :host { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 12px; max-width: 100%; }
    button { min-height: 44px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadBookButton {
  readonly loanId = input.required<string>();
  protected readonly auth = inject(AuthService);
  private readonly reading = inject(LoanReadingService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pending = signal(false);
  protected readonly error = linkedSignal({ source: this.auth.session, computation: () => '' });

  protected read(): void {
    if (this.pending() || !this.auth.ensureAuthenticated()) return;
    this.error.set('');
    // Abrir durante el clic evita que el navegador bloquee la pestaña al terminar HTTP.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      this.error.set('Permití abrir una pestaña nueva para leer el PDF.');
      return;
    }
    tab.opener = null;
    let navigated = false;
    this.pending.set(true);
    this.reading.open(this.loanId()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.pending.set(false);
        if (!navigated && !tab.closed) tab.close();
      }),
    ).subscribe({
      next: (access) => {
        if (tab.closed) return;
        try {
          if (new URL(access.url).protocol !== 'https:') throw new Error('Acceso inválido');
          tab.location.replace(access.url);
          navigated = true;
        } catch {
          this.error.set('No pudimos abrir el PDF. Intentá nuevamente.');
        }
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(error.status === 404
          ? 'Este préstamo ya no está vigente o no está disponible para tu cuenta.'
          : 'No pudimos abrir el PDF. Intentá nuevamente.');
      },
    });
  }
}
