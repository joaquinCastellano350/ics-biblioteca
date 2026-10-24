import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BookCard } from './book-card';
import { CatalogService } from './catalog-service';
import type { Book } from './book';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { Select } from 'primeng/select';
import type { CatalogTerm } from './book';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';

interface CatalogSearchCriteria {
  readonly authorIds?: readonly string[];
}

@Component({
  selector: 'app-catalog-page',
  imports: [BookCard, ButtonModule, CheckboxModule, ProgressSpinnerModule, SelectModule, FormsModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  @ViewChild(Select) private authorSelect?: Select;
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  readonly books = signal<readonly Book[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly selectedAuthors = signal<readonly CatalogTerm[]>([]);
  readonly draftAuthors = signal<readonly CatalogTerm[]>([]);
  readonly authorSuggestions = signal<CatalogTerm[]>([]);
  readonly authorOptions = computed(() => {
    const authors = new Map<string, CatalogTerm>();
    for (const author of this.draftAuthors()) authors.set(author.id, author);
    for (const author of this.authorSuggestions()) authors.set(author.id, author);
    return [...authors.values()];
  });
  readonly authorMenuOpen = signal(false);
  readonly authorQuery = signal('');
  readonly authorSearchLoading = signal(false);
  readonly authorSearchError = signal(false);
  private applyOnHide = false;
  private criteria: CatalogSearchCriteria = {};
  private readonly bookSearches = new Subject<CatalogSearchCriteria>();
  private readonly authorSearches = new Subject<string>();

  constructor() {
    this.bookSearches.pipe(
      switchMap((criteria) => {
        this.status.set('loading');
        return this.catalog.findAll(criteria).pipe(
          catchError(() => { this.status.set('error'); return EMPTY; }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ books }) => {
      this.books.set(books);
      this.status.set('ready');
    });
    this.bookSearches.next({});
    this.authorSearches.pipe(
      switchMap((query) => {
        this.authorSearchLoading.set(true);
        this.authorSearchError.set(false);
        return this.catalog.searchAuthors(query).pipe(
          catchError(() => {
            this.authorSuggestions.set([]);
            this.authorSearchError.set(true);
            this.authorSearchLoading.set(false);
            return EMPTY;
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ authors }) => {
      this.authorSuggestions.set([...authors]);
      this.authorSearchLoading.set(false);
    });
  }

  onAuthorMenuShow(): void {
    this.draftAuthors.set([...this.selectedAuthors()]);
    this.authorQuery.set('');
    this.authorSuggestions.set([]);
    this.authorSearchLoading.set(false);
    this.authorSearchError.set(false);
    this.authorMenuOpen.set(true);
  }

  onAuthorMenuHide(): void {
    this.authorMenuOpen.set(false);
    if (!this.applyOnHide) this.draftAuthors.set([...this.selectedAuthors()]);
    this.applyOnHide = false;
  }

  searchAuthors(query: string): void {
    this.authorQuery.set(query);
    this.authorSearches.next(query);
  }

  isDraftAuthorSelected(authorId: string): boolean {
    return this.draftAuthors().some(({ id }) => id === authorId);
  }

  setDraftAuthorSelected(author: CatalogTerm, selected: boolean | undefined): void {
    const authors = this.draftAuthors().filter(({ id }) => id !== author.id);
    this.draftAuthors.set(selected ? [...authors, author] : authors);
  }

  clearDraftAuthors(): void {
    this.draftAuthors.set([]);
  }

  applyAuthorMenu(): void {
    this.setAppliedAuthors(this.draftAuthors());
    this.applyOnHide = true;
    this.authorSelect?.hide();
  }

  removeSelectedAuthor(authorId: string): void {
    const selected = this.selectedAuthors().filter(({ id }) => id !== authorId);
    this.setAppliedAuthors(selected);
    this.draftAuthors.set([...selected]);
  }

  private setAppliedAuthors(authors: readonly CatalogTerm[]): void {
    this.selectedAuthors.set(authors);
    const { authorIds: _previousAuthorIds, ...otherCriteria } = this.criteria;
    this.criteria = authors.length
      ? { ...otherCriteria, authorIds: authors.map(({ id }) => id) }
      : otherCriteria;
    this.bookSearches.next(this.criteria);
  }

  load(): void {
    this.status.set('loading');
    this.bookSearches.next(this.criteria);
  }
}
