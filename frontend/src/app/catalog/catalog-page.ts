import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BookCard } from './book-card';
import { CatalogService, type CatalogSearchCriteria } from './catalog-service';
import type { Book } from './book';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import type { CatalogTerm } from './book';
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
  readonly selectedAuthors = signal<readonly CatalogTerm[]>([]);
  readonly draftAuthors = signal<readonly CatalogTerm[]>([]);
  readonly authorSuggestions = signal<CatalogTerm[]>([]);
  readonly authorMenuOpen = signal(false);
  readonly authorQuery = signal('');
  @ViewChild('authorToggle') private authorToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('authorSearchInput') private authorSearchInput?: ElementRef<HTMLInputElement>;
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private criteria: CatalogSearchCriteria = {};
  private readonly searches = new Subject<CatalogSearchCriteria>();
  private readonly authorSearches = new Subject<string>();

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
    this.authorSearches.pipe(
      switchMap((query) => this.catalog.searchAuthors(query).pipe(
        catchError(() => { this.authorSuggestions.set([]); return EMPTY; }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ authors }) => this.authorSuggestions.set([...authors]));
  }

  toggleAuthorMenu(): void {
    if (this.authorMenuOpen()) {
      this.closeAuthorMenu();
      return;
    }
    this.draftAuthors.set([...this.selectedAuthors()]);
    this.authorQuery.set('');
    this.authorMenuOpen.set(true);
    this.authorSearches.next('');
    afterNextRender(() => {
      if (this.authorMenuOpen()) this.authorSearchInput?.nativeElement.focus();
    }, { injector: this.injector });
  }

  searchAuthors(query: string): void {
    this.authorQuery.set(query);
    this.authorSearches.next(query);
  }

  toggleDraftAuthor(author: CatalogTerm, checked: boolean): void {
    const selected = this.draftAuthors();
    this.draftAuthors.set(checked
      ? [...selected.filter(({ id }) => id !== author.id), author]
      : selected.filter(({ id }) => id !== author.id));
  }

  clearDraftAuthors(): void { this.draftAuthors.set([]); }
  isDraftAuthorSelected(authorId: string): boolean {
    return this.draftAuthors().some(({ id }) => id === authorId);
  }

  applyAuthorMenu(): void {
    this.setAppliedAuthors(this.draftAuthors());
    this.closeAuthorMenu();
  }

  removeSelectedAuthor(authorId: string): void {
    const selected = this.selectedAuthors().filter(({ id }) => id !== authorId);
    this.setAppliedAuthors(selected);
    if (this.authorMenuOpen()) this.draftAuthors.set([...selected]);
  }

  @HostListener('document:keydown', ['$event'])
  closeOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.authorMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeAuthorMenu();
    }
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: MouseEvent): void {
    if (!this.authorMenuOpen()) return;
    const target = event.target;
    const filter = this.host.nativeElement.querySelector('.filter-wrap');
    if (target instanceof Node && filter && !filter.contains(target)) this.closeAuthorMenu(false);
  }

  private setAppliedAuthors(authors: readonly CatalogTerm[]): void {
    this.selectedAuthors.set([...authors]);
    const { authorIds: _previousAuthorIds, ...otherCriteria } = this.criteria;
    this.criteria = authors.length
      ? { ...otherCriteria, authorIds: authors.map(({ id }) => id) }
      : otherCriteria;
    this.searches.next(this.criteria);
  }

  private closeAuthorMenu(restoreFocus = true): void {
    this.authorMenuOpen.set(false);
    this.draftAuthors.set([...this.selectedAuthors()]);
    if (restoreFocus) this.authorToggle?.nativeElement.focus();
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
