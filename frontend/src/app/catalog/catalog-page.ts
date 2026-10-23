import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BookCard } from './book-card';
import { CatalogService } from './catalog-service';
import type { Book } from './book';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

@Component({
  selector: 'app-catalog-page',
  imports: [BookCard, ButtonModule, ProgressSpinnerModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  readonly books = signal<readonly Book[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');

  constructor() {
    this.load();
  }

  load(): void {
    this.status.set('loading');
    this.catalog
      .findAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ books }) => {
          this.books.set(books);
          this.status.set('ready');
        },
        error: () => {
          this.status.set('error');
        },
      });
  }
}
