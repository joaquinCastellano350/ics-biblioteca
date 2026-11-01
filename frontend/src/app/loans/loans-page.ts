import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../auth/auth.service';
import { LoanQueryService } from './loan-query.service';
import { ReadBookButton } from './read-book-button';
import { DialogModule } from 'primeng/dialog';
import { QueueService } from './queue-service';
import type { PersonalWait } from './loan-query.types';
import { finalize, type Subscription } from 'rxjs';

@Component({
  selector: 'app-loans-page',
  imports: [RouterLink, ButtonModule, ProgressSpinnerModule, MessageModule, TagModule, ReadBookButton, DialogModule],
  templateUrl: './loans-page.html',
  styleUrl: './loans-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoansPage {
  protected readonly auth = inject(AuthService);
  private readonly queries = inject(LoanQueryService);
  protected readonly loading = this.queries.loading;
  protected readonly error = this.queries.error;
  protected readonly data = this.queries.data;
  protected readonly loans = this.queries.loans;
  protected readonly reservations = this.queries.reservations;
  private readonly queue = inject(QueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly router = inject(Router);
  private readonly owner = computed(() => {
    const session = this.auth.session();
    return this.auth.status() === 'authenticated' && !this.auth.authenticating() && !this.auth.loggingOut() && session
      ? JSON.stringify([session.user.id, session.session.createdAt, session.session.expiresAt]) : null;
  });
  private readonly selection = signal<{ owner: string; wait: PersonalWait } | null>(null);
  protected readonly selectedWait = computed(() => this.selection()?.owner === this.owner() ? this.selection()?.wait ?? null : null);
  protected readonly cancelPending = signal(false);
  protected readonly cancelError = signal('');
  private cancelRequest: Subscription | undefined;
  private cancelGeneration = 0;
  private opener: HTMLElement | null = null;
  private openerUrl = '';
  private openerOwner: string | null = null;

  constructor() {
    this.queries.connect(this.destroyRef);
    effect(() => {
      const owner = this.owner();
      untracked(() => {
        if (this.selection() && this.selection()!.owner !== owner) this.resetCancellation();
      });
    });
    this.destroyRef.onDestroy(() => this.resetCancellation());
  }

  protected askToLeave(wait: PersonalWait, event: Event): void {
    if (this.cancelPending() || this.selection() || this.loading() || !this.auth.ensureAuthenticated()) return;
    const owner = this.owner();
    const current = this.data()?.waits.find(item => item.id === wait.id);
    if (!owner || !current) return;
    this.opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : this.document.activeElement as HTMLElement | null;
    this.openerUrl = this.router.url; this.openerOwner = owner;
    this.cancelError.set(''); this.selection.set({ owner, wait: current });
  }

  protected dismissCancellation(): void {
    if (!this.cancelPending()) this.resetCancellation();
  }

  protected confirmCancellation(): void {
    const wait = this.selectedWait(); const owner = this.owner();
    if (!wait || !owner || this.cancelPending() || !this.auth.ensureAuthenticated()) return;
    const generation = ++this.cancelGeneration;
    const current = () => generation === this.cancelGeneration && owner === this.owner() && this.selectedWait()?.id === wait.id;
    this.cancelPending.set(true); this.cancelError.set('');
    this.cancelRequest = this.queue.cancel(wait.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (generation === this.cancelGeneration) this.cancelPending.set(false); }),
    ).subscribe({
      next: () => {
        if (!current()) return;
        this.resetCancellation();
        this.queries.invalidate(); this.queries.refresh();
      },
      error: (error: unknown) => {
        if (!current()) return;
        const code = error instanceof HttpErrorResponse ? error.error?.error?.code : undefined;
        const messages: Record<string, string> = {
          CIRCULATION_RECONCILIATION_REQUIRED: 'Esta espera necesita actualizarse antes de poder salir. Reintentá más tarde.',
          QUEUE_ENTRY_NOT_FOUND: 'Esta espera ya no está disponible. Actualizá tus préstamos para comprobar su estado.',
          QUEUE_ENTRY_FULFILLED: 'Esta espera ya se utilizó para obtener un préstamo. Actualizá tus préstamos.',
        };
        this.cancelError.set(messages[code] ?? 'No pudimos confirmar la salida de la cola. Reintentá para comprobar su estado.');
      },
    });
  }

  private resetCancellation(): void {
    this.cancelGeneration++;
    this.cancelRequest?.unsubscribe(); this.cancelRequest = undefined;
    this.cancelPending.set(false); this.cancelError.set(''); this.selection.set(null);
  }

  protected focusKeepWaiting(): void {
    if (this.selectedWait() && !this.cancelPending()) {
      this.host.nativeElement.querySelector<HTMLButtonElement>('[data-keep-waiting] button')?.focus();
    }
  }

  protected restoreCancellationFocus(): void {
    if (this.selectedWait() || this.auth.loginRequested() || this.router.url !== this.openerUrl || this.owner() !== this.openerOwner) return;
    const available = (element: HTMLElement | null): element is HTMLElement => !!element?.isConnected
      && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]');
    const fallback = this.host.nativeElement.querySelector<HTMLElement>('#main-content');
    const target = available(this.opener) ? this.opener : available(fallback) ? fallback : null;
    target?.focus();
  }

  protected load(): void {
    this.queries.refresh();
  }

  protected date(value: string): string {
    return this.queries.date(value);
  }

  protected remaining(value: string): string {
    return this.queries.remaining(value);
  }
}
