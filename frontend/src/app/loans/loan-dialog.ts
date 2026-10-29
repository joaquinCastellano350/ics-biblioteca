import { afterRenderEffect, ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, type Subscription } from 'rxjs';
import { RouterLink } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../auth/auth.service';
import { DOCUMENT } from '@angular/common';
import type { Book } from '../catalog/book';
import { LoanService, type GrantedLoan } from './loan-service';
import { QueueService, type OpenQueueEntry, type QueueResponse } from './queue-service';
import { LoanQueryService } from './loan-query.service';

@Component({
  selector: 'app-loan-dialog',
  imports: [DialogModule, ButtonModule, MessageModule, RouterLink],
  templateUrl: './loan-dialog.html',
  styleUrl: './loan-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanDialog {
  readonly book = input<Book | null>(null);
  readonly mode = input<'loan' | 'queue'>('loan');
  readonly closed = output<void>();
  readonly granted = output<GrantedLoan>();
  readonly queued = output<QueueResponse>();
  readonly auth = inject(AuthService);
  private readonly loans = inject(LoanService);
  private readonly queue = inject(QueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  private openerUrl = '';
  private readonly personal = inject(LoanQueryService);
  private readonly focusReturn = signal<{ opener: HTMLElement; fallback: HTMLElement; url: string; owner: string | null } | null>(null);
  readonly pending = signal(false);
  readonly loan = signal<GrantedLoan | null>(null);
  readonly error = signal('');
  readonly noCopies = signal(false);
  readonly queueMode = signal(false);
  readonly queueEntry = signal<OpenQueueEntry | null>(null);
  readonly terminal = signal(false);
  private account: string | undefined;
  private queueAccount: string | null = null;
  private queueRequest: Subscription | undefined;
  private queueGeneration = 0;

  constructor() {
    afterRenderEffect(() => {
      const target = this.focusReturn();
      if (!target) return;
      const loading = this.personal.loading();
      // Never steal focus after navigation, another dialog or a deliberate focus change.
      if (this.book() || this.auth.loginRequested() || this.queueOwner() !== target.owner
        || this.document.location.href !== target.url || !target.opener.isConnected
        || !target.fallback.isConnected || this.document.activeElement !== target.fallback) {
        this.focusReturn.set(null);
        return;
      }
      if (loading) return;
      this.focusReturn.set(null);
      if (this.canFocus(target.opener)) target.opener.focus();
    });
    effect(() => {
      const book = this.book();
      const mode = this.mode();
      this.cancelQueue();
      this.queueMode.set(mode === 'queue');
      this.queueEntry.set(null);
      this.queueAccount = untracked(() => this.queueOwner());
      if (book) {
        this.opener = this.document.activeElement as HTMLElement | null;
        this.openerUrl = this.document.location.href;
      }
      this.account = untracked(() => this.auth.session()?.user.id);
      this.loan.set(null);
      this.error.set('');
      this.noCopies.set(false);
      this.terminal.set(false);
    });
    effect(() => {
      const account = this.auth.session()?.user.id;
      const queueOwner = this.queueOwner();
      if (this.book() && ((!account || account !== this.account)
        || (this.queueMode() && (!queueOwner || queueOwner !== this.queueAccount)))) {
        this.cancelQueue();
        this.queueEntry.set(null);
        this.error.set('');
        this.closed.emit();
      }
    });
  }

  confirm(): void {
    const book = this.book();
    if (!book || this.queueMode() || this.pending() || this.loan() || this.terminal()) return;
    if (!this.auth.ensureAuthenticated()) { this.closed.emit(); return; }
    this.pending.set(true);
    this.error.set('');
    this.loans.request(book.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.pending.set(false)),
    ).subscribe({
      next: ({ loan }) => {
        if (this.loan()) return;
        this.loan.set(loan);
        this.granted.emit(loan);
      },
      error: (error: unknown) => {
        const code = error instanceof HttpErrorResponse ? error.error?.error?.code : undefined;
        this.noCopies.set(code === 'NO_AVAILABLE_COPIES');
        this.terminal.set(['NO_AVAILABLE_COPIES', 'LOAN_LIMIT_REACHED', 'OPEN_QUEUE_ENTRY', 'BOOK_NOT_FOUND'].includes(code));
        const messages: Record<string, string> = {
          NO_AVAILABLE_COPIES: 'El último cupo se ocupó mientras elegías. Podés esperar tu turno en la cola.',
          LOAN_LIMIT_REACHED: 'Ya tenés cinco préstamos activos. Podrás solicitar otro cuando venza alguno.',
          OPEN_QUEUE_ENTRY: 'Ya estás esperando este libro o tenés un cupo reservado. Conservamos tu turno.',
          BOOK_NOT_FOUND: 'Este libro ya no está disponible en el catálogo.',
        };
        this.error.set(messages[code] ?? 'No pudimos confirmar el préstamo. Intentá nuevamente; no se creará un préstamo duplicado.');
      },
    });
  }

  prepareQueue(): void {
    if (!this.book() || this.queueMode() || this.pending() || this.loan()) return;
    this.queueAccount = this.queueOwner();
    this.queueMode.set(true);
    this.error.set('');
    this.terminal.set(false);
  }

  confirmQueue(): void {
    const book = this.book();
    if (!book || !this.queueMode() || this.pending() || this.queueEntry() || this.terminal()) return;
    if (!this.auth.ensureAuthenticated()) { this.closed.emit(); return; }
    const owner = this.queueOwner();
    const generation = ++this.queueGeneration;
    const current = () => generation === this.queueGeneration && owner === this.queueOwner()
      && this.book()?.id === book.id && this.queueMode();
    this.pending.set(true);
    this.error.set('');
    this.queueRequest = this.queue.join(book.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (generation === this.queueGeneration) this.pending.set(false); }),
    ).subscribe({
      next: (result) => {
        if (!current() || this.queueEntry()) return;
        this.queueEntry.set(result.entry);
        this.queued.emit(result);
      },
      error: (error: unknown) => {
        if (!current()) return;
        const code = error instanceof HttpErrorResponse ? error.error?.error?.code : undefined;
        this.terminal.set(['BOOK_NOT_FOUND', 'BOOK_ALREADY_BORROWED', 'LOAN_LIMIT_REACHED', 'AVAILABLE_COPIES', 'VALIDATION_ERROR'].includes(code));
        const messages: Record<string, string> = {
          BOOK_NOT_FOUND: 'Este libro ya no está disponible en el catálogo.',
          BOOK_ALREADY_BORROWED: 'Ya tenés este libro prestado. No podés ingresar a su cola.',
          LOAN_LIMIT_REACHED: 'Ya tenés cinco préstamos activos. Podrás entrar cuando venza alguno.',
          AVAILABLE_COPIES: 'Ahora hay cupos disponibles. Volvé al catálogo para solicitar el préstamo.',
          VALIDATION_ERROR: 'No pudimos identificar el libro. Volvé al catálogo e intentá nuevamente.',
          CIRCULATION_RECONCILIATION_REQUIRED: 'El estado de este libro necesita actualizarse. Intentá nuevamente más tarde.',
        };
        this.error.set(messages[code] ?? 'No pudimos confirmar la inscripción. Reintentá para comprobar su estado sin duplicar tu entrada.');
      },
    });
  }

  private queueOwner(): string | null {
    const session = this.auth.session();
    return this.auth.status() === 'authenticated' && session
      ? JSON.stringify([session.user.id, session.session.createdAt, session.session.expiresAt]) : null;
  }

  private cancelQueue(): void {
    this.queueGeneration++;
    if (this.queueRequest) {
      this.queueRequest.unsubscribe();
      this.queueRequest = undefined;
      this.pending.set(false);
    }
  }

  close(): void { if (!this.pending()) this.closed.emit(); }

  restoreFocus(): void {
    this.focusReturn.set(null);
    if (this.book() || this.auth.loginRequested() || this.document.location.href !== this.openerUrl) return;
    if (this.opener && this.canFocus(this.opener)) {
      this.opener.focus();
      return;
    }
    const fallback = this.document.getElementById('main-content');
    if (!fallback || !this.canFocus(fallback)) return;
    fallback.focus();
    if (this.opener?.isConnected && this.personal.loading()) {
      this.focusReturn.set({ opener: this.opener, fallback, url: this.document.location.href, owner: this.queueOwner() });
    }
  }

  private canFocus(element: HTMLElement): boolean {
    return element.isConnected && !element.matches(':disabled, [aria-disabled="true"]')
      && !element.closest('[hidden], [inert], [aria-hidden="true"]');
  }

  dueDate(): string {
    const due = this.loan()?.dueAt;
    return due ? new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'long', timeStyle: 'short',
    }).format(new Date(due)) : '';
  }
}
