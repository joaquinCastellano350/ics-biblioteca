import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Checkbox } from 'primeng/checkbox';
import { Select } from 'primeng/select';
import { CatalogPage } from './catalog-page';
import { appConfig } from '../app.config';

function createCatalogFixture() {
  const fixture = TestBed.createComponent(CatalogPage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, http };
}

function expectBooks(http: HttpTestingController) {
  return http.expectOne((request) => request.url === '/api/books');
}

function selectRoot(fixture: ReturnType<typeof createCatalogFixture>['fixture']): HTMLElement {
  const root = fixture.nativeElement.querySelector('.p-select');
  if (!(root instanceof HTMLElement)) throw new Error('No se encontró el control Select de PrimeNG');
  return root;
}

function selectedAuthorLabel(fixture: ReturnType<typeof createCatalogFixture>['fixture']): string {
  const label = selectRoot(fixture).querySelector('.p-select-label');
  if (!(label instanceof HTMLElement)) throw new Error('No se encontrÃ³ la etiqueta de selecciÃ³n de PrimeNG');
  return label.textContent ?? '';
}

async function openAuthorSelect(fixture: ReturnType<typeof createCatalogFixture>['fixture']): Promise<void> {
  selectRoot(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function authorSearchInput(fixture: ReturnType<typeof createCatalogFixture>['fixture']): HTMLInputElement {
  const input = fixture.nativeElement.querySelector('p-select input[aria-label="Buscar autores"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No se encontró el filtro accesible de autores');
  return input;
}

function typeAuthorSearch(fixture: ReturnType<typeof createCatalogFixture>['fixture'], query: string): void {
  const input = authorSearchInput(fixture);
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
}

function chooseAuthor(fixture: ReturnType<typeof createCatalogFixture>['fixture'], name: string): void {
  const host = fixture.nativeElement as HTMLElement;
  const options = host.querySelectorAll<HTMLElement>('[role="option"]');
  const option = Array.from(options)
    .find((candidate) => candidate.textContent?.trim() === name);
  if (!(option instanceof HTMLElement)) throw new Error(`No se encontró la opción ${name}`);
  option.click();
  fixture.detectChanges();
}

function buttonByText(fixture: ReturnType<typeof createCatalogFixture>['fixture'], text: string): HTMLButtonElement {
  const host = fixture.nativeElement as HTMLElement;
  const buttons = host.querySelectorAll<HTMLButtonElement>('button');
  const button = Array.from(buttons)
    .find((candidate) => candidate.textContent?.trim().includes(text) || candidate.getAttribute('aria-label') === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón ${text}`);
  return button;
}

describe('Public catalog author filtering', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('opens PrimeNG Select without fetching all authors and prompts for a search term', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    const select = fixture.debugElement.query(By.directive(Select));
    expect(select).not.toBeNull();
    expect(select.componentInstance.multiple()).toBe(true);
    expect(select.componentInstance.filter()).toBe(true);

    await openAuthorSelect(fixture);
    http.expectNone('/api/authors');
    expect(fixture.nativeElement.textContent).toContain('Escribí un término para buscar autores');
    expect(fixture.nativeElement.textContent).not.toContain('Recientes');
    expect(fixture.nativeElement.textContent).not.toContain('Mostrar lista completa');
  });

  it('sends PrimeNG filter input to the remote author search endpoint', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    http.expectNone('/api/authors');

    typeAuthorSearch(fixture, 'ana');
    const request = http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana');
    expect(request.request.method).toBe('GET');
    request.flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Ana María' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ana María');
  });

  it('renders PrimeNG checkboxes and keeps each option synchronized with provisional selection', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'a');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'a')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    await fixture.whenStable();
    fixture.detectChanges();

    const checkboxes = fixture.debugElement.queryAll(By.directive(Checkbox));
    expect(checkboxes).toHaveLength(2);
    const host = fixture.nativeElement as HTMLElement;
    const checkboxInputs = host.querySelectorAll<HTMLInputElement>('p-checkbox input[type="checkbox"]');
    expect(checkboxInputs).toHaveLength(2);
    expect(Array.from(checkboxInputs).map(({ checked }) => checked)).toEqual([false, false]);

    checkboxInputs[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.draftAuthors().map(({ id }) => id)).toEqual(['author-1']);
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(checkboxInputs[0].checked).toBe(true);

    chooseAuthor(fixture, 'Beatriz');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.draftAuthors().map(({ id }) => id)).toEqual(['author-1', 'author-2']);
    expect(Array.from(checkboxInputs).map(({ checked }) => checked)).toEqual([true, true]);

    checkboxInputs[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.draftAuthors().map(({ id }) => id)).toEqual(['author-2']);
    expect(Array.from(checkboxInputs).map(({ checked }) => checked)).toEqual([false, true]);
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('selects several remote authors provisionally, confirms them, and filters books through the backend', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'a');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'a')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    await fixture.whenStable();
    fixture.detectChanges();

    chooseAuthor(fixture, 'Ana');
    chooseAuthor(fixture, 'Beatriz');
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1', 'author-2']);
    filtered.flush({ books: [{ id: 'b1', title: 'Redes', authors: [{ id: 'author-3', name: 'Autora visible' }], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Redes');
    expect(fixture.nativeElement.textContent).toContain('Autora visible');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(2);
  });

  it('keeps selected author names visible after remote results change and when the selector reopens', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);

    typeAuthorSearch(fixture, 'ana');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'Ana');

    typeAuthorSearch(fixture, 'william');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'william')
      .flush({ authors: [{ id: 'author-2', name: 'William Stallings' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(selectedAuthorLabel(fixture)).toContain('Ana');
    expect(selectedAuthorLabel(fixture)).not.toContain('[object Object]');
    chooseAuthor(fixture, 'William Stallings');
    expect(selectedAuthorLabel(fixture)).toContain('Ana');
    expect(selectedAuthorLabel(fixture)).toContain('William Stallings');
    expect(selectedAuthorLabel(fixture)).not.toContain('[object Object]');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1', 'author-2']);
    filtered.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    await openAuthorSelect(fixture);
    http.expectNone('/api/authors');
    expect(selectedAuthorLabel(fixture)).toContain('Ana');
    expect(selectedAuthorLabel(fixture)).toContain('William Stallings');
    expect(selectedAuthorLabel(fixture)).not.toContain('[object Object]');
  });

  it('discards provisional selections when the actual PrimeNG overlay closes', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'ana');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Ana María' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'Ana');

    authorSearchInput(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('removes a selected author chip and stops sending that author ID to the backend', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'a');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'a')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'Ana');
    chooseAuthor(fixture, 'Beatriz');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    buttonByText(fixture, 'Quitar filtro de autor Ana').click();
    const remaining = expectBooks(http);
    expect(remaining.request.params.getAll('authorIds')).toEqual(['author-2']);
    remaining.flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(1);
  });

  it('clears the Select placeholder and restores all books when the last author chip is removed', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [
      { id: 'b1', title: 'Libro uno', authors: [], subjects: [] },
      { id: 'b2', title: 'Libro dos', authors: [], subjects: [] },
      { id: 'b3', title: 'Libro tres', authors: [], subjects: [] },
      { id: 'b4', title: 'Libro cuatro', authors: [], subjects: [] },
      { id: 'b5', title: 'Libro cinco', authors: [], subjects: [] },
    ] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'William Stallings');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'William Stallings')
      .flush({ authors: [{ id: 'author-1', name: 'William Stallings' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'William Stallings');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1']);
    filtered.flush({ books: [{ id: 'b1', title: 'Libro uno', authors: [{ id: 'author-1', name: 'William Stallings' }], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(selectedAuthorLabel(fixture)).toContain('William Stallings');
    expect(fixture.componentInstance.books()).toHaveLength(1);

    buttonByText(fixture, 'Quitar filtro de autor William Stallings').click();
    const unfiltered = expectBooks(http);
    expect(unfiltered.request.params.has('authorIds')).toBe(false);
    unfiltered.flush({ books: [
      { id: 'b1', title: 'Libro uno', authors: [], subjects: [] },
      { id: 'b2', title: 'Libro dos', authors: [], subjects: [] },
      { id: 'b3', title: 'Libro tres', authors: [], subjects: [] },
      { id: 'b4', title: 'Libro cuatro', authors: [], subjects: [] },
      { id: 'b5', title: 'Libro cinco', authors: [], subjects: [] },
    ] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.books()).toHaveLength(5);
    expect(selectedAuthorLabel(fixture).trim()).toBe('Seleccionar autores');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
  });

  it('shows distinct empty-result and error feedback for remote author searches', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);

    typeAuthorSearch(fixture, 'nobody');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'nobody')
      .flush({ authors: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se encontraron autores');

    typeAuthorSearch(fixture, 'failure');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'failure')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar autores');
    expect(fixture.componentInstance.authorSearchLoading()).toBe(false);
    expect(fixture.componentInstance.authorSearchError()).toBe(true);
  });

  it('renders public books with all returned author and subject terms', async () => {
    const { fixture, http } = createCatalogFixture();
    const request = expectBooks(http);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(false);
    request.flush({ books: [
      { id: 'book-1', title: 'Redes', authors: [{ id: 'a1', name: 'Ana' }, { id: 'a2', name: 'Beatriz' }], subjects: [{ id: 's1', name: 'Redes' }, { id: 's2', name: 'Sistemas' }] },
      { id: 'book-2', title: 'Algoritmos', authors: [], subjects: [] },
    ] });
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll('article');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Ana');
    expect(cards[0].textContent).toContain('Beatriz');
    expect(cards[0].querySelectorAll('.subjects li')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('2 libros en el catálogo');
  });

  it('distinguishes an empty catalog from an error and retries failed catalog requests', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    buttonByText(fixture, 'Volver a intentar').click();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros cargados');
  });

  it('cancels a pending author search when the page is destroyed', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    typeAuthorSearch(fixture, 'ana');
    const pendingAuthors = http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana');
    fixture.destroy();
    expect(pendingAuthors.cancelled).toBe(true);
  });
});
