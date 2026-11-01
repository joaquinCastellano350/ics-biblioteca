import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../auth/auth.service';
import { LoanQueryService } from './loan-query.service';
import { ReservationService, type AcceptedReservation } from './reservation.service';
import { ReadBookButton } from './read-book-button';

interface Outcome { key: string; message?: string; result?: AcceptedReservation; terminal?: boolean }

@Component({
  selector: 'app-accept-reservation',
  imports: [ButtonModule, MessageModule, ReadBookButton],
  template: `
    @if (outcome()?.result; as result) {
      <p-message severity="success" role="status">
        {{ result.created ? '¡Tu préstamo está confirmado!' : 'Este enlace ya fue utilizado. No se creó otro préstamo.' }}
        {{ result.active ? 'Podés leer hasta el ' + date(result.loan.dueAt) + '.' : 'El préstamo asociado ya terminó.' }}
      </p-message>
      @if (result.active) { <app-read-book-button [loanId]="result.loan.id" /> }
    } @else {
      @if (outcome()?.message; as message) { <p-message severity="error" role="alert">{{ message }}</p-message> }
      @if (!outcome()?.terminal) {
        <button pButton type="button" (click)="accept()" [disabled]="pending() || auth.authenticating() || auth.status() === 'loading' || auth.status() === 'unavailable'" [attr.aria-busy]="pending()">
          {{ pending() ? 'Aceptando…' : 'Aceptar préstamo' }}
        </button>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; min-width: 0; width: 100%; }
    button { width: 100%; min-height: 44px; justify-content: center; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptReservation {
  readonly reservationId = input.required<string>();
  readonly automatic = input(false);
  readonly settled = output<string>();
  protected readonly auth = inject(AuthService);
  private readonly service = inject(ReservationService);
  private readonly queries = inject(LoanQueryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = signal<Outcome | null>(null);
  private readonly busyKey = signal<string | null>(null);
  private attemptedKey: string | null = null;
  private loginPrompted = false;
  private readonly key = computed(() => {
    const session = this.auth.session();
    return JSON.stringify([this.reservationId(), session?.user.id, session?.session.createdAt, session?.session.expiresAt]);
  });
  protected readonly outcome = computed(() => this.state()?.key === this.key() ? this.state() : null);
  protected readonly pending = computed(() => this.busyKey() === this.key());

  constructor() {
    effect(() => {
      const automatic = this.automatic();
      const status = this.auth.status();
      const authenticating = this.auth.authenticating();
      const key = this.key();
      if (!automatic || authenticating) return;
      untracked(() => {
        // Excepción propia del enlace de SCRUM-26: retoma al autenticarse.
        if (status === 'anonymous' && !this.loginPrompted) {
          this.loginPrompted = true;
          this.attemptedKey = null;
          this.auth.openLogin();
        } else if (status === 'authenticated' && this.attemptedKey !== key) {
          this.loginPrompted = false;
          this.accept();
        }
      });
    });
  }

  protected accept(): void {
    if (this.pending() || !this.auth.ensureAuthenticated()) return;
    const key = this.key();
    this.attemptedKey = key;
    this.state.set(null);
    this.busyKey.set(key);
    this.service.accept(this.reservationId()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (this.busyKey() === key) this.busyKey.set(null); }),
    ).subscribe({
      next: result => {
        if (this.key() !== key) return;
        this.state.set({ key, result });
        this.settled.emit(result.active ? 'Tu préstamo está confirmado. Podés empezar a leer desde Préstamos activos.' : 'El préstamo asociado a este enlace ya terminó.');
        this.queries.invalidate();
        this.queries.refresh();
      },
      error: (error: HttpErrorResponse) => {
        if (this.key() !== key) return;
        const messages: Record<string, string> = {
          RESERVATION_NOT_FOUND: 'El enlace no está disponible para esta cuenta. Ingresá con la cuenta que recibió el aviso de turno.',
          RESERVATION_EXPIRED: 'El plazo de tu reserva terminó. Podés consultar los cupos actuales en el catálogo.',
          RESERVATION_CANCELLED: 'Esta reserva ya no está disponible. El turno se dejó pasar o se canceló.',
          RESERVATION_REJECTED_LIMIT: 'La reserva se canceló porque ya tenés cinco préstamos activos. Tu posición se retiró y el cupo pasó a la siguiente persona elegible, o quedó disponible.',
        };
        const message = messages[error.error?.error?.code];
        this.state.set({ key, message: message ?? 'No pudimos aceptar la reserva. Intentá nuevamente.', terminal: !!message });
        if (message) {
          this.settled.emit(message);
          this.queries.invalidate();
          this.queries.refresh();
        }
      },
    });
  }

  protected date(value: string): string { return this.queries.date(value); }
}
