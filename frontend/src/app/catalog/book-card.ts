import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Book } from './book';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import type { BookCirculationState } from '../loans/loan-query.service';
import { ReadBookButton } from '../loans/read-book-button';

@Component({
  selector: 'app-book-card',
  imports: [CardModule, ButtonModule, TagModule, ReadBookButton],
  templateUrl: './book-card.html',
  styleUrl: './book-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCard {
  readonly book = input.required<Book>();
  readonly loanId = input<string | null>(null);
  readonly readingUnavailable = output<void>();
  readonly personal = input<BookCirculationState | null>(null);
  readonly requestBlockReason = input('');
  readonly requestLoan = output<Book>();
  readonly disabledReason = computed(() => this.requestBlockReason() || this.personal()?.disabledReason
    || (this.book().availability.availableCopies === 0 ? 'Sin cupos disponibles.' : ''));

  request(): void {
    if (!this.disabledReason()) this.requestLoan.emit(this.book());
  }
}
