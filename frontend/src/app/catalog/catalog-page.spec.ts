import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { CatalogPage } from './catalog-page';
import { appConfig } from '../app.config';

function createCatalogFixture() {
  const fixture = TestBed.createComponent(CatalogPage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, http };
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
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('sends title changes to the API and clears the title criterion', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    const primeInput = fixture.debugElement.query(By.directive(InputText));
    expect(primeInput).not.toBeNull();
    expect(primeInput.nativeElement).toBe(input);
    expect(fixture.debugElement.query(By.directive(IconField))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(InputIcon))).not.toBeNull();
    input.value = 'ciencia';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    http.expectOne('/api/books?title=ciencia').flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin resultados');
    expect(fixture.nativeElement.querySelector('.title-empty-state h2')?.textContent).toBe('Sin resultados');
    expect(fixture.nativeElement.querySelector('.title-empty-state .pi-search')).not.toBeNull();
    fixture.nativeElement.querySelector('.title-empty-state button').click();
    const clearedSearch = http.expectOne('/api/books');
    expect(clearedSearch.request.params.has('title')).toBe(false);
    clearedSearch.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(fixture.nativeElement.querySelector('.title-empty-state')).toBeNull();
    input.value = 'ciencia';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    http.expectOne('/api/books?title=ciencia').flush({ books: [] });
    await fixture.whenStable();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Sin resultados');
    expect(fixture.componentInstance.status()).toBe('ready');
  });

  it('clears the title criterion through the search field with and without results', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    const allBooks = [
      { id: 'b1', title: 'Redes', authors: [], subjects: [] },
      { id: 'b2', title: 'Algoritmos', authors: [], subjects: [] },
    ];
    http.expectOne('/api/books').flush({ books: allBooks });
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    input.value = 'redes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    http.expectOne('/api/books?title=redes').flush({ books: [allBooks[0]] });
    await fixture.whenStable();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const clearedWithResults = http.expectOne('/api/books');
    expect(clearedWithResults.request.params.has('title')).toBe(false);
    clearedWithResults.flush({ books: allBooks });
    await fixture.whenStable();
    input.value = 'sin-coincidencias';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    http.expectOne('/api/books?title=sin-coincidencias').flush({ books: [] });
    await fixture.whenStable();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const clearedWithoutResults = http.expectOne('/api/books');
    expect(clearedWithoutResults.request.params.has('title')).toBe(false);
    clearedWithoutResults.flush({ books: allBooks });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Sin resultados');
    expect(fixture.nativeElement.textContent).toContain('2 libros en el catálogo');
  });

  it('combines title and author filters and preserves the author when the title is cleared', async () => {
    const { fixture, http } = createCatalogFixture();
    const books = [
      { id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
      { id: 'b2', title: 'Algoritmos', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
    ];
    expectBooks(http).flush({ books });
    await fixture.whenStable();
    fixture.detectChanges();

    openAuthorMenu(fixture, http).flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    fixture.detectChanges();
    checkboxFor(fixture, 'Ana').click();
    fixture.nativeElement.querySelector('.filter-done').click();
    const authorFiltered = expectBooks(http);
    expect(authorFiltered.request.params.getAll('authorIds')).toEqual(['author-1']);
    authorFiltered.flush({ books });
    await fixture.whenStable();

    const titleInput = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    titleInput.value = 'red';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    const combined = expectBooks(http);
    expect(combined.request.params.get('title')).toBe('red');
    expect(combined.request.params.getAll('authorIds')).toEqual(['author-1']);
    combined.flush({ books: [books[0]] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Redes');
    expect(fixture.nativeElement.textContent).not.toContain('Algoritmos');

    titleInput.value = '';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    const titleCleared = expectBooks(http);
    expect(titleCleared.request.params.has('title')).toBe(false);
    expect(titleCleared.request.params.getAll('authorIds')).toEqual(['author-1']);
    titleCleared.flush({ books });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Redes');
    expect(fixture.nativeElement.textContent).toContain('Algoritmos');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(1);
  });

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
    fixture.destroy();
    expect(bookRequest.cancelled).toBe(true);
    expect(pendingAuthors.cancelled).toBe(true);
  });
});
