import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BookCard } from './book-card';
import { CatalogService, type CatalogSearchCriteria } from './catalog-service';
import type { Book } from './book';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';

@Component({
  selector: 'app-catalog-page',
  imports: [BookCard, ButtonModule, ProgressSpinnerModule, InputTextModule, IconFieldModule, InputIconModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  readonly books = signal<readonly Book[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly titleQuery = signal('');
  private criteria: CatalogSearchCriteria = {};
  private readonly searches = new Subject<CatalogSearchCriteria>();

  constructor() {
    this.searches.pipe(
      switchMap((criteria) => {
        this.status.set('loading');
        return this.catalog.findAll(criteria).pipe(
          catchError(() => { this.status.set('error'); return EMPTY; }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ books }) => { this.books.set(books); this.status.set('ready'); },
    });
    this.searches.next({});
  }

  searchByTitle(title: string): void {
    this.titleQuery.set(title);
    const { title: _previousTitle, ...otherCriteria } = this.criteria;
    this.criteria = title.trim() ? { ...otherCriteria, title } : otherCriteria;
    this.searches.next(this.criteria);
  }

  load(): void {
    this.status.set('loading');
    this.searches.next(this.criteria);
  }
}
