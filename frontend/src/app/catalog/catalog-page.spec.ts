import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Checkbox } from 'primeng/checkbox';
import { Select } from 'primeng/select';
import { CatalogPage } from './catalog-page';
import { appConfig } from '../app.config';
import type { CatalogTerm } from './book';

const subjects: readonly CatalogTerm[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Redes' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sistemas' },
];

function createCatalogFixture() {
  const fixture = TestBed.createComponent(CatalogPage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  http.expectOne('/api/subjects').flush({ subjects: [] });
  return { fixture, http };
}

function flushInitialSubjectRequests(http: HttpTestingController): void {
  http.expectOne('/api/books').flush({ books: [] });
  http.expectOne('/api/subjects').flush({ subjects });
}

function openSubjectSelector(fixture: ComponentFixture<CatalogPage>): HTMLElement {
  const root = fixture.nativeElement as HTMLElement;
  const label = root.querySelector('p-select .p-select-label');
  expect(label).not.toBeNull();
  label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  fixture.detectChanges();
  return root;
}

function chooseSubject(root: HTMLElement, name: string): void {
  const option = Array.from(root.querySelectorAll('.p-select-option'))
    .find((candidate) => candidate.textContent?.includes(name));
  expect(option).toBeDefined();
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function subjectOption(root: HTMLElement, name: string): Element | undefined {
  return Array.from(root.querySelectorAll('.p-select-option'))
    .find((candidate) => candidate.textContent?.includes(name));
}

function openAuthorMenu(fixture: ComponentFixture<CatalogPage>, http: HttpTestingController) {
  fixture.nativeElement.querySelector('.filter-button').click();
  fixture.detectChanges();
  const authors = http.expectOne((request) => request.url === '/api/authors');
  return authors;
}

function expectBooks(http: HttpTestingController) {
  return http.expectOne((request) => request.url === '/api/books');
}

function checkboxFor(fixture: ComponentFixture<CatalogPage>, name: string): HTMLInputElement {
  const options = Array.from(
    fixture.nativeElement.querySelectorAll('.filter-option'),
  ) as HTMLLabelElement[];
  const checkbox = options.find((option) => option.textContent?.trim() === name)?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) throw new Error(`No encontré el checkbox para ${name}`);
  return checkbox;
}

describe('Public catalog', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('moves focus into the author menu and returns it to the button on confirm and cancel', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    const button = fixture.nativeElement.querySelector('.filter-button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    http.expectOne('/api/authors').flush({ authors: [] });
    await fixture.whenStable();
    const search = fixture.nativeElement.querySelector('#catalog-author-search') as HTMLInputElement;
    expect(document.activeElement).toBe(search);

    fixture.nativeElement.querySelector('.filter-done').click();
    expect(document.activeElement).toBe(button);
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    button.click();
    fixture.detectChanges();
    http.expectOne('/api/authors').flush({ authors: [] });
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#catalog-author-search'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(button);
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('does not focus a search field if the menu closes before its next render', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    const button = fixture.nativeElement.querySelector('.filter-button') as HTMLButtonElement;
    fixture.componentInstance.toggleAuthorMenu();
    fixture.componentInstance.toggleAuthorMenu();
    http.expectOne('/api/authors').flush({ authors: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#catalog-author-search')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens the author menu, searches remotely, applies multiple authors on Listo, and removes a chip', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    const initialAuthors = openAuthorMenu(fixture, http);
    expect(fixture.nativeElement.querySelector('.filter-button').getAttribute('aria-expanded')).toBe('true');
    initialAuthors.flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Ana María' }] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Recientes');
    expect(fixture.nativeElement.textContent).not.toContain('Mostrar lista completa');

    const search = fixture.nativeElement.querySelector('#catalog-author-search') as HTMLInputElement;
    search.value = 'ana';
    search.dispatchEvent(new Event('input'));
    const searchedAuthors = http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana');
    searchedAuthors.flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Ana María' }] });
    await fixture.whenStable();

    checkboxFor(fixture, 'Ana').click();
    checkboxFor(fixture, 'Ana María').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);
    fixture.nativeElement.querySelector('.filter-done').click();
    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1', 'author-2']);
    filtered.flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Sin resultados');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.filter-count').textContent).toBe('2');
    expect(fixture.nativeElement.querySelector('.filter-chevron.pi-chevron-down')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.filter-button').classList).toContain('selected');

    fixture.nativeElement.querySelector('.chip[aria-label="Quitar filtro de autor Ana"]').click();
    const remaining = expectBooks(http);
    expect(remaining.request.params.getAll('authorIds')).toEqual(['author-2']);
    remaining.flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(1);
  });

  it('clears staged authors on Listo and discards staged changes when the menu is closed', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    fixture.detectChanges();
    checkboxFor(fixture, 'Ana').click();
    fixture.nativeElement.querySelector('.filter-done').click();
    const firstSelection = expectBooks(http);
    expect(firstSelection.request.params.getAll('authorIds')).toEqual(['author-1']);
    firstSelection.flush({ books: [] });
    await fixture.whenStable();

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    fixture.detectChanges();
    checkboxFor(fixture, 'Beatriz').click();
    fixture.nativeElement.querySelector('.filter-button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.filter-menu')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(1);
    expect(http.match('/api/books')).toHaveLength(0);

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.filter-clear').click();
    fixture.detectChanges();
    const checkboxes = fixture.nativeElement.querySelectorAll('.filter-option input') as NodeListOf<HTMLInputElement>;
    expect(Array.from(checkboxes).every((input) => !input.checked)).toBe(true);
    expect(http.match('/api/books')).toHaveLength(0);
    fixture.nativeElement.querySelector('.filter-done').click();
    const cleared = expectBooks(http);
    expect(cleared.request.params.has('authorIds')).toBe(false);
    cleared.flush({ books: [] });
    await fixture.whenStable();

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    fixture.detectChanges();
    checkboxFor(fixture, 'Ana').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.filter-menu')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
    expect(http.match('/api/books')).toHaveLength(0);

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    fixture.detectChanges();
    checkboxFor(fixture, 'Ana').click();
    fixture.nativeElement.querySelector('h1').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.filter-menu')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('requests all books without authentication and renders every book with multiple terms', async () => {
    const { fixture, http } = createCatalogFixture();
    expect(fixture.nativeElement.textContent).toContain('Cargando el catálogo');
    const request = expectBooks(http);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(false);
    request.flush({
      books: [
        {
          id: 'b1',
          title: 'Redes',
          authors: [
            { id: 'a1', name: 'Ana' },
            { id: 'a2', name: 'Beatriz' },
          ],
          subjects: [
            { id: 's1', name: 'Redes' },
            { id: 's2', name: 'Sistemas' },
          ],
        },
        { id: 'b2', title: 'Algoritmos', authors: [], subjects: [] },
      ],
    });
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll('article');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Ana');
    expect(cards[0].textContent).toContain('Beatriz');
    expect(cards[0].querySelectorAll('.subjects li').length).toBe(2);
    expect(cards[0].querySelector('a,button,img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('2 libros en el catálogo');
  });

  it('distinguishes an empty catalog from a failed request', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros cargados');
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
  });

  it('offers a working retry after a failed request', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const retryButton = Array.from(buttons).find((button) => button.textContent?.includes('Volver a intentar'));
    expect(retryButton).toBeDefined();
    retryButton!.click();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros cargados');
  });

  it('cancels a pending request when leaving the page', () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const pendingAuthors = openAuthorMenu(fixture, http);
    const bookRequest = expectBooks(http);
    const subjectsRequest = http.expectOne('/api/subjects');
    fixture.destroy();
    expect(bookRequest.cancelled).toBe(true);
    expect(pendingAuthors.cancelled).toBe(true);
    expect(subjectsRequest.cancelled).toBe(true);
  });

  it('loads subjects independently and configures PrimeNG Select for searchable multiple selection', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/books').flush({ books: [] });
    const subjectRequest = http.expectOne('/api/subjects');
    expect(subjectRequest.request.method).toBe('GET');
    subjectRequest.flush({ subjects });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = openSubjectSelector(fixture);
    const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
    expect(select.multiple()).toBe(true);
    expect(select.filter()).toBe(true);
    expect(select.optionLabel()).toBe('name');
    expect(select.dataKey()).toBe('id');
    expect(fixture.debugElement.query(By.directive(Checkbox))).not.toBeNull();
    expect(root.textContent).not.toContain('Recientes');
    expect(root.textContent).not.toContain('Mostrar lista completa');

    const filter = root.querySelector('input.p-select-filter') as HTMLInputElement;
    filter.value = 'sist';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const options = Array.from(root.querySelectorAll('.p-select-option'));
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Sistemas');
    expect(options[0]?.querySelector('p-checkbox')).not.toBeNull();
    expect(root.textContent).toContain('Limpiar');
    expect(root.textContent).toContain('Listo');
    expect(root.querySelector('.filter-clear')).not.toBeNull();
    expect(root.querySelector('.filter-done')).not.toBeNull();
    expect(http.match('/api/books')).toHaveLength(0);
    root.querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('keeps one and multiple subject changes provisional until Listo, then applies them together', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/books').flush({
      books: [{ id: 'book-1', title: 'Libro visible', authors: [], subjects: [] }],
    });
    http.expectOne('/api/subjects').flush({ subjects });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = openSubjectSelector(fixture);
    chooseSubject(root, 'Redes');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(fixture.componentInstance.books().map(({ id }) => id)).toEqual(['book-1']);
    expect(root.querySelector('app-book-card')).not.toBeNull();
    expect(http.match('/api/books')).toHaveLength(0);

    chooseSubject(root, 'Sistemas');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);
    root.querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    const multipleSubjects = expectBooks(http);
    expect(multipleSubjects.request.params.getAll('subjectIds')).toEqual([subjects[0]?.id, subjects[1]?.id]);
    multipleSubjects.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    openSubjectSelector(fixture);
    expect(subjectOption(root, 'Redes')?.getAttribute('aria-selected')).toBe('true');
    expect(subjectOption(root, 'Sistemas')?.getAttribute('aria-selected')).toBe('true');
    root.querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);

    const subjectChip = root.querySelector('[aria-label="Quitar materia Redes"]');
    expect(subjectChip?.closest('.subject-filter')).not.toBeNull();
    expect(subjectChip?.classList).toContain('chip');
    expect(subjectChip?.querySelector('span[aria-hidden="true"]')?.textContent).toBe('×');
    const subjectSelect = root.querySelector('p-select.subject-select');
    expect(subjectSelect?.classList.contains('selected')).toBe(false);
    expect(subjectSelect?.textContent).toContain('Materias');
    expect(subjectSelect?.textContent).toContain('(2)');
    root.querySelector('.filter-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    http.expectOne('/api/authors').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    checkboxFor(fixture, 'Ana').click();
    root.querySelector('.filter-done')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const withAuthor = expectBooks(http);
    expect(withAuthor.request.params.getAll('subjectIds')).toEqual([subjects[0]?.id, subjects[1]?.id]);
    expect(withAuthor.request.params.getAll('authorIds')).toEqual(['author-1']);
    withAuthor.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const title = root.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'redes';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const combined = expectBooks(http);
    expect(combined.request.params.get('title')).toBe('redes');
    expect(combined.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(combined.request.params.getAll('subjectIds')).toEqual([subjects[0]?.id, subjects[1]?.id]);
    combined.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    root.querySelector('[aria-label="Quitar materia Redes"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const afterRemoval = expectBooks(http);
    expect(afterRemoval.request.params.get('title')).toBe('redes');
    expect(afterRemoval.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(afterRemoval.request.params.getAll('subjectIds')).toEqual([subjects[1]?.id]);
    afterRemoval.flush({ books: [] });
    await fixture.whenStable();
  });

  it('discards subject changes on Escape and preserves the applied title and author filters', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    flushInitialSubjectRequests(http);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    checkboxFor(fixture, 'Ana').click();
    root.querySelector('.filter-done')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const withAuthor = expectBooks(http);
    withAuthor.flush({ books: [] });
    await fixture.whenStable();

    const title = root.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'redes';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const withTitle = expectBooks(http);
    expect(withTitle.request.params.get('title')).toBe('redes');
    expect(withTitle.request.params.getAll('authorIds')).toEqual(['author-1']);
    withTitle.flush({ books: [] });
    await fixture.whenStable();

    openSubjectSelector(fixture);
    chooseSubject(root, 'Redes');
    chooseSubject(root, 'Sistemas');
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);
    root.querySelector('input.p-select-filter')?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true,
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(fixture.componentInstance.draftSubjects()).toEqual([]);
    expect(root.querySelectorAll('[aria-label^="Quitar materia "]')).toHaveLength(0);
    expect(http.match('/api/books')).toHaveLength(0);

    const subjectSelectComponent = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
    subjectSelectComponent.show();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(subjectOption(root, 'Redes')?.getAttribute('aria-selected')).toBe('false');
    expect(subjectOption(root, 'Sistemas')?.getAttribute('aria-selected')).toBe('false');
    root.querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);

    title.value = 'algoritmos';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const afterCancel = expectBooks(http);
    expect(afterCancel.request.params.get('title')).toBe('algoritmos');
    expect(afterCancel.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(afterCancel.request.params.has('subjectIds')).toBe(false);
    afterCancel.flush({ books: [] });
    await fixture.whenStable();
  });

  it('shows subject loading errors, retries, and distinguishes an empty independent subject list', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/books').flush({ books: [] });
    const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
    expect(select.loading()).toBe(true);
    expect(select.disabled()).toBe(true);
    http.expectOne('/api/subjects').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar las materias');
    root.querySelector('.subject-error button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    http.expectOne('/api/subjects').flush({ subjects: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('No hay materias disponibles');
    expect(root.textContent).toContain('Todavía no hay libros cargados');
  });
});
