import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Book } from './book';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-book-card',
  imports: [CardModule],
  templateUrl: './book-card.html',
  styleUrl: './book-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCard {
  readonly book = input.required<Book>();
}
