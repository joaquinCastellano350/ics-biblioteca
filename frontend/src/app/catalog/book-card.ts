import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Book } from './book';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import type { BookCirculationState } from '../loans/loan-query.service';

@Component({
  selector: 'app-book-card',
  imports: [CardModule, ButtonModule, TagModule],
  templateUrl: './book-card.html',
  styleUrl: './book-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCard {
  readonly book = input.required<Book>();
  readonly personal = input<BookCirculationState | null>(null);
  readonly requestBlockReason = input('');
  readonly requestLoan = output<Book>();
  readonly joinQueue = output<Book>();
  readonly queueDisabledReason = computed(() => this.requestBlockReason() || this.personal()?.disabledReason || '');
  readonly disabledReason = computed(() => this.requestBlockReason() || this.personal()?.disabledReason
    || (this.book().availability.availableCopies === 0 ? 'Sin cupos disponibles.' : ''));

  request(): void {
    if (!this.disabledReason()) this.requestLoan.emit(this.book());
  }

  requestQueue(): void {
    if (this.book().availability.availableCopies === 0 && !this.queueDisabledReason()) this.joinQueue.emit(this.book());
  }
}
