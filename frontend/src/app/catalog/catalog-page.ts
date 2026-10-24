import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BookCard } from './book-card';
import { CatalogService, type CatalogSearchCriteria } from './catalog-service';
import { SubjectService } from './subject-service';
import type { Book, CatalogTerm } from './book';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { Select, SelectModule } from 'primeng/select';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';

@Component({
  selector: 'app-catalog-page',
  imports: [
    BookCard, ButtonModule, CheckboxModule, FormsModule, IconFieldModule,
    InputIconModule, InputTextModule, ProgressSpinnerModule, SelectModule,
  ],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly subjectService = inject(SubjectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly books = signal<readonly Book[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly selectedAuthors = signal<readonly CatalogTerm[]>([]);
  readonly draftAuthors = signal<readonly CatalogTerm[]>([]);
  readonly authorSuggestions = signal<CatalogTerm[]>([]);
  readonly authorMenuOpen = signal(false);
  readonly authorQuery = signal('');
  readonly subjects = signal<CatalogTerm[]>([]);
  readonly subjectsStatus = signal<'loading' | 'ready' | 'error'>('loading');
  readonly selectedSubjects = signal<readonly CatalogTerm[]>([]);
  readonly draftSubjects = signal<readonly CatalogTerm[]>([]);
  readonly titleQuery = signal('');
  @ViewChild('authorToggle') private authorToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('authorSearchInput') private authorSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild(Select) private subjectSelect?: Select;
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
      switchMap((query) => this.catalog.searchAuthors(query).pipe(
        catchError(() => { this.authorSuggestions.set([]); return EMPTY; }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ authors }) => this.authorSuggestions.set([...authors]));
    this.loadSubjects();
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
    const filter = this.host.nativeElement.querySelector('.author-filter');
    if (target instanceof Node && filter && !filter.contains(target)) this.closeAuthorMenu(false);
  }

  private setAppliedAuthors(authors: readonly CatalogTerm[]): void {
    this.selectedAuthors.set([...authors]);
    const { authorIds: _previousAuthorIds, ...otherCriteria } = this.criteria;
    this.criteria = authors.length
      ? { ...otherCriteria, authorIds: authors.map(({ id }) => id) }
      : otherCriteria;
    this.load();
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
    this.load();
  }

  loadSubjects(): void {
    this.subjectsStatus.set('loading');
    this.subjectService.findAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ subjects }) => {
        this.subjects.set([...subjects]);
        this.subjectsStatus.set('ready');
      },
      error: () => this.subjectsStatus.set('error'),
    });
  }

  startSubjectSelection(): void {
    this.draftSubjects.set([...this.selectedSubjects()]);
  }

  updateDraftSubjects(subjects: readonly CatalogTerm[] | null | undefined): void {
    this.draftSubjects.set([...(subjects ?? [])]);
  }

  applySubjectSelection(): void {
    this.setAppliedSubjects(this.draftSubjects());
    this.closeSubjectSelector();
  }

  discardSubjectSelection(): void {
    this.draftSubjects.set([...this.selectedSubjects()]);
  }

  private setAppliedSubjects(subjects: readonly CatalogTerm[]): void {
    const selected = [...subjects];
    const applied = this.selectedSubjects();
    const unchanged = selected.length === applied.length
      && applied.every(({ id }) => selected.some((subject) => subject.id === id));
    if (unchanged) {
      this.draftSubjects.set([...applied]);
      return;
    }
    this.selectedSubjects.set(selected);
    this.draftSubjects.set(selected);
    const { subjectIds: _previousSubjectIds, ...otherCriteria } = this.criteria;
    this.criteria = selected.length
      ? { ...otherCriteria, subjectIds: selected.map(({ id }) => id) }
      : otherCriteria;
    this.load();
  }

  isSubjectSelected(subject: CatalogTerm): boolean {
    return this.draftSubjects().some(({ id }) => id === subject.id);
  }
  clearSubjectSelection(): void { this.updateDraftSubjects([]); }
  closeSubjectSelector(): void { this.subjectSelect?.hide(); }
  removeSubject(subject: CatalogTerm): void {
    this.setAppliedSubjects(this.selectedSubjects().filter(({ id }) => id !== subject.id));
  }

  clearFilters(): void {
    this.titleQuery.set('');
    this.selectedSubjects.set([]);
    this.draftSubjects.set([]);
    const { title: _title, subjectIds: _subjectIds, ...otherCriteria } = this.criteria;
    this.criteria = otherCriteria;
    this.load();
  }

  load(): void { this.bookSearches.next(this.criteria); }
}
