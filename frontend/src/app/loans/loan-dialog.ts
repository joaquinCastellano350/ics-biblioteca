import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../auth/auth.service';
import { DOCUMENT } from '@angular/common';
import type { Book } from '../catalog/book';
import { LoanService, type GrantedLoan } from './loan-service';
import { ReadBookButton } from './read-book-button';

@Component({
  selector: 'app-loan-dialog',
  imports: [DialogModule, ButtonModule, MessageModule, ReadBookButton],
  templateUrl: './loan-dialog.html',
  styleUrl: './loan-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanDialog {
  readonly book = input<Book | null>(null);
  readonly closed = output<void>();
  readonly granted = output<GrantedLoan>();
  readonly auth = inject(AuthService);
  private readonly loans = inject(LoanService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  readonly pending = signal(false);
  readonly loan = signal<GrantedLoan | null>(null);
  readonly error = signal('');
  readonly noCopies = signal(false);
  readonly queueInfo = signal(false);
  readonly terminal = signal(false);
  private account: string | undefined;

  constructor() {
    effect(() => {
      const book = this.book();
      if (book) this.opener = this.document.activeElement as HTMLElement | null;
      this.account = untracked(() => this.auth.session()?.user.id);
      this.loan.set(null);
      this.error.set('');
      this.noCopies.set(false);
      this.queueInfo.set(false);
      this.terminal.set(false);
    });
    effect(() => {
      const account = this.auth.session()?.user.id;
      if (this.book() && (!account || account !== this.account)) this.closed.emit();
    });
  }

  confirm(): void {
    const book = this.book();
    if (!book || this.pending() || this.loan() || this.terminal()) return;
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

  close(): void { if (!this.pending()) this.closed.emit(); }

  restoreFocus(): void {
    if (this.opener?.isConnected) this.opener.focus();
    else this.document.getElementById('main-content')?.focus();
  }

  dueDate(): string {
    const due = this.loan()?.dueAt;
    return due ? new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'long', timeStyle: 'short',
    }).format(new Date(due)) : '';
  }
}
