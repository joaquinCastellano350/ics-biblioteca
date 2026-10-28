import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Book } from './book';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-book-card',
  imports: [CardModule, ButtonModule],
  templateUrl: './book-card.html',
  styleUrl: './book-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCard {
  readonly book = input.required<Book>();
  readonly requestLoan = output<Book>();
}
