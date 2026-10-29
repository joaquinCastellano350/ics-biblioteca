import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BookCard } from './book-card';
import { CatalogService, type CatalogSearchCriteria } from './catalog-service';
import { SubjectService } from './subject-service';
import type { Book, CatalogTerm } from './book';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule, Select } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageModule } from 'primeng/message';
import { EMPTY, Subject, catchError, of, switchMap, timer } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { LoanDialog } from '../loans/loan-dialog';
import { LoanQueryService } from '../loans/loan-query.service';
import type { Subscription } from 'rxjs';

@Component({
  selector: 'app-catalog-page',
  imports: [BookCard, LoanDialog, ButtonModule, CheckboxModule, ProgressSpinnerModule, SelectModule, FormsModule, InputTextModule, IconFieldModule, InputIconModule, MessageModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  @ViewChild('authorSelect') private authorSelect?: Select;
  @ViewChild('subjectSelect') private subjectSelect?: Select;
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  readonly personal = inject(LoanQueryService);
  readonly readingLoanIds = computed(() => new Map(this.personal.loans().map(loan => [loan.book.id, loan.id])));
  readonly personalRequestError = computed(() => this.auth.status() === 'authenticated' && this.personal.error()
    ? 'No pudimos comprobar tus préstamos. Reintentá para continuar' : '');
  readonly requestedBook = signal<Book | null>(null);
  readonly dialogMode = signal<'loan' | 'queue'>('loan');
  private grantedInDialog = false;
  private availabilityRequest: Subscription | undefined;
  private availabilityCriteria: CatalogSearchCriteria | undefined;

  requestLoan(book: Book): void {
    if (book.availability.availableCopies === 0 || this.personalRequestError() || this.personal.bookState(book.id)?.disabledReason) return;
    if (this.auth.ensureAuthenticated()) {
      this.grantedInDialog = false;
      this.dialogMode.set('loan');
      this.requestedBook.set(book);
    }
  }

  requestQueue(book: Book): void {
    if (book.availability.availableCopies !== 0 || this.personalRequestError() || this.personal.bookState(book.id)?.disabledReason) return;
    if (this.auth.ensureAuthenticated()) {
      this.grantedInDialog = false;
      this.dialogMode.set('queue');
      this.requestedBook.set(book);
    }
  }

  onQueueJoined(): void {
    this.onLoanGranted();
  }

  onLoanGranted(): void {
    if (this.grantedInDialog) return;
    this.grantedInDialog = true;
    this.personal.invalidate();
    this.personal.refresh();
  }

  closeLoanDialog(): void {
    this.requestedBook.set(null);
    if (!this.grantedInDialog) this.personal.refresh();
    this.grantedInDialog = false;
    this.refreshAvailability();
  }

  refreshPersonal(): void {
    this.personal.refresh();
    this.refreshAvailability();
  }

  @HostListener('window:focus')
  refreshAvailability(): void {
    // Recargar también tras un conflicto de cupos, conservando los filtros.
    // Conserva las tarjetas para devolver el foco al botón que abrió el modal.
    const criteria = this.criteria;
    if (this.availabilityRequest && !this.availabilityRequest.closed && criteria === this.availabilityCriteria) return;
    this.availabilityRequest?.unsubscribe();
    this.availabilityCriteria = criteria;
    this.availabilityRequest = this.catalog.findAll(criteria).pipe(
      takeUntilDestroyed(this.destroyRef), catchError(() => EMPTY),
    ).subscribe(({ books }) => { if (criteria === this.criteria) this.books.set(books); });
  }
  private readonly subjectService = inject(SubjectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  readonly books = signal<readonly Book[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly titleQuery = signal('');
  readonly selectedAuthors = signal<readonly CatalogTerm[]>([]);
  readonly draftAuthors = signal<readonly CatalogTerm[]>([]);
  readonly authorSuggestions = signal<CatalogTerm[]>([]);
  readonly authorScrollHeight = signal('min(235px, max(80px, calc(100vh - 220px)))');
  readonly authorOptions = computed(() => {
    const authors = new Map<string, CatalogTerm>();
    for (const author of this.draftAuthors()) authors.set(author.id, author);
    for (const author of this.authorSuggestions()) authors.set(author.id, author);
    return [...authors.values()];
  });
  readonly authorMenuOpen = signal(false);
  readonly authorQuery = signal('');
  readonly subjects = signal<CatalogTerm[]>([]);
  readonly subjectsStatus = signal<'loading' | 'ready' | 'error'>('loading');
  readonly selectedSubjects = signal<readonly CatalogTerm[]>([]);
  readonly draftSubjects = signal<readonly CatalogTerm[]>([]);
  readonly subjectScrollHeight = signal('min(235px, max(80px, calc(100vh - 220px)))');
  readonly authorSearchLoading = signal(false);
  readonly authorSearchError = signal(false);
  private applyOnHide = false;
  private restoreAuthorFocus = true;
  private criteria: CatalogSearchCriteria = {};
  private readonly searches = new Subject<{ criteria: CatalogSearchCriteria; delayed: boolean }>();
  private readonly authorSearches = new Subject<string | null>();

  constructor() {
    this.personal.connect(this.destroyRef);
    this.searches.pipe(
      // El nuevo evento cancela inmediatamente el timer o la consulta anterior.
      // Solo las pulsaciones esperan; filtros, limpieza y reintento son inmediatos.
      switchMap(({ criteria, delayed }) => (delayed ? timer(500) : of(0)).pipe(
        switchMap(() => {
          this.status.set('loading');
          return this.catalog.findAll(criteria).pipe(
            catchError(() => { this.status.set('error'); return EMPTY; }),
          );
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ books }) => {
      this.books.set(books);
      this.status.set('ready');
    });
    this.searches.next({ criteria: {}, delayed: false });
    this.authorSearches.pipe(
      switchMap((query) => {
        this.authorSearchLoading.set(false);
        this.authorSearchError.set(false);
        if (query === null) return EMPTY;
        return timer(500).pipe(switchMap(() => {
          this.authorSearchLoading.set(true);
          return this.catalog.searchAuthors(query).pipe(
            catchError(() => {
              this.authorSuggestions.set([]);
              this.authorSearchError.set(true);
              this.authorSearchLoading.set(false);
              return EMPTY;
            }),
          );
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ authors }) => {
      this.authorSuggestions.set([...authors]);
      this.authorSearchLoading.set(false);
    });
    this.loadSubjects();
  }

  onAuthorMenuShow(): void {
    this.draftAuthors.set([...this.selectedAuthors()]);
    this.authorSearchLoading.set(false);
    this.authorSearchError.set(false);
    this.authorMenuOpen.set(true);
    this.constrainOverlayBelow(this.authorSelect, '.author-filter .p-select', '.catalog-author-overlay', (height) => this.authorScrollHeight.set(height));
    afterNextRender(() => {
      setTimeout(() => {
        const input = this.host.nativeElement.querySelector('input[aria-label="Buscar autores"]') as HTMLInputElement | null;
        if (this.authorMenuOpen()) input?.focus();
      }, 50);
    }, { injector: this.injector });
  }

  onAuthorMenuHide(): void {
    this.authorSearches.next(null);
    this.authorQuery.set('');
    this.authorSuggestions.set([]);
    this.authorMenuOpen.set(false);
    if (!this.applyOnHide) this.draftAuthors.set([...this.selectedAuthors()]);
    this.applyOnHide = false;
    if (this.restoreAuthorFocus) afterNextRender(() => this.authorSelect?.focus(), { injector: this.injector });
    this.restoreAuthorFocus = true;
  }

  searchAuthors(query: string): void {
    if (query.trim() === this.authorQuery().trim()) {
      this.authorQuery.set(query);
      return;
    }
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

  clearDraftAuthors(): void { this.draftAuthors.set([]); }

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

  @HostListener('document:keydown', ['$event'])
  closeOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.authorMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.authorSelect?.hide();
    }
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: MouseEvent): void {
    if (!this.authorMenuOpen()) return;
    const target = event.target;
    const filter = this.host.nativeElement.querySelector('.author-filter');
    if (target instanceof Node && filter && !filter.contains(target)) {
      this.restoreAuthorFocus = false;
      this.authorSelect?.hide();
    }
  }

  private setAppliedAuthors(authors: readonly CatalogTerm[]): void {
    this.selectedAuthors.set([...authors]);
    const { authorIds: _previousAuthorIds, ...otherCriteria } = this.criteria;
    this.criteria = authors.length ? { ...otherCriteria, authorIds: authors.map(({ id }) => id) } : otherCriteria;
    this.searches.next({ criteria: this.criteria, delayed: false });
  }

  searchByTitle(title: string, immediate = false): void {
    this.titleQuery.set(title);
    if (title.trim() === (this.criteria.title ?? '').trim()) return;
    const { title: _previousTitle, ...otherCriteria } = this.criteria;
    this.criteria = title.trim() ? { ...otherCriteria, title } : otherCriteria;
    this.searches.next({ criteria: this.criteria, delayed: !immediate });
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
    this.constrainOverlayBelow(this.subjectSelect, '.subject-filter .p-select', '.catalog-subject-overlay', (height) => this.subjectScrollHeight.set(height));
  }

  private constrainOverlayBelow(select: Select | undefined, controlSelector: string, panelSelector: string, setHeight: (height: string) => void): void {
    if (!select) return;
    const root = this.host.nativeElement as HTMLElement;
    const control = root.querySelector<HTMLElement>(controlSelector);
    const panel = root.querySelector<HTMLElement>(panelSelector);
    const list = panel?.querySelector<HTMLElement>('.p-select-list-container');
    if (!control || !panel || !list) return;

    const spaceBelow = window.innerHeight - control.getBoundingClientRect().bottom - 8;
    const panelChrome = panel.getBoundingClientRect().height - list.getBoundingClientRect().height;
    if (spaceBelow <= 0 || panelChrome <= 0) return;

    const listHeight = Math.max(48, Math.min(235, Math.floor(spaceBelow - panelChrome)));
    setHeight(`${listHeight}px`);
    afterNextRender(() => select.overlayViewChild()?.alignOverlay(), { injector: this.injector });
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
    this.selectedAuthors.set([]);
    this.draftAuthors.set([]);
    this.selectedSubjects.set([]);
    this.draftSubjects.set([]);
    this.criteria = {};
    this.load();
  }
  load(): void {
    this.status.set('loading');
    this.searches.next({ criteria: this.criteria, delayed: false });
  }
}
