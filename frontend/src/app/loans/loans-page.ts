import { ChangeDetectionStrategy, Component, DestroyRef, inject, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../auth/auth.service';
import { LoanQueryService } from './loan-query.service';
import { ReadBookButton } from './read-book-button';
import { AcceptReservation } from './accept-reservation';

@Component({
  selector: 'app-loans-page',
  imports: [RouterLink, ButtonModule, ProgressSpinnerModule, MessageModule, TagModule, ReadBookButton, AcceptReservation],
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
  protected readonly acceptanceMessage = linkedSignal({ source: this.auth.session, computation: () => '' });

  constructor() {
    this.queries.connect(inject(DestroyRef));
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
