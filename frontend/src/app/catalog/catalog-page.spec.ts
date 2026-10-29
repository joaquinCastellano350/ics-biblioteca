import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Checkbox } from 'primeng/checkbox';
import { Select } from 'primeng/select';
import { IconField } from 'primeng/iconfield';
import { InputIcon } from 'primeng/inputicon';
import { InputText } from 'primeng/inputtext';
import { vi } from 'vitest';
import { CatalogPage } from './catalog-page';
import { appConfig } from '../app.config';
import type { CatalogTerm } from './book';
import { providePrimeNG } from 'primeng/config';
import { AuthService } from '../auth/auth.service';
import { LoanQueryService } from '../loans/loan-query.service';
import { LoanDialog } from '../loans/loan-dialog';
import type { AuthResponse } from '../auth/auth.types';
import type { PersonalCirculation } from '../loans/loan-query.types';

const subjects: readonly CatalogTerm[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Redes' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sistemas' },
];

function flushInitialSubjectRequests(http: HttpTestingController): void {
  http.expectOne('/api/books').flush({ books: [] });
  http.expectOne('/api/subjects').flush({ subjects });
}

function openSubjectSelector(fixture: ComponentFixture<CatalogPage>): HTMLElement {
  const root = fixture.nativeElement as HTMLElement;
  const label = root.querySelector('p-select.subject-select .p-select-label');
  expect(label).not.toBeNull();
  label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  fixture.detectChanges();
  return root;
}

function overlayFor(root: HTMLElement, className: string): HTMLElement {
  return root.querySelector<HTMLElement>(`.${className}`) ?? root;
}

function chooseSubject(root: HTMLElement, name: string): void {
  const option = Array.from(overlayFor(root, 'catalog-subject-overlay').querySelectorAll('.p-select-option'))
    .find((candidate) => candidate.textContent?.includes(name));
  expect(option).toBeDefined();
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function subjectOption(root: HTMLElement, name: string): Element | undefined {
  return Array.from(overlayFor(root, 'catalog-subject-overlay').querySelectorAll('.p-select-option'))
    .find((candidate) => candidate.textContent?.includes(name));
}
function createCatalogFixture() {
  const fixture = TestBed.createComponent(CatalogPage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  http.expectOne('/api/subjects').flush({ subjects: [] });
  return { fixture, http };
}

function expectBooks(http: HttpTestingController) {
  return http.expectOne((request) => request.url === '/api/books');
}

function expectAuthorSearch(http: HttpTestingController, query: string) {
  return http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === query);
}

describe('SCRUM-21: circulación personal integrada al catálogo público', () => {
  let fixture: ComponentFixture<CatalogPage> | undefined;
  let http: HttpTestingController;
  let auth: AuthService;
  const book = { id: '11111111-1111-4111-8111-111111111111', title: 'Redes', authors: [], subjects: [],
    availability: { availableCopies: 1, totalCopies: 1 } };
  const session: AuthResponse = {
    user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid', university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: '2026-10-28T12:00:00Z', expiresAt: '2026-10-28T18:00:00Z' }, serverTime: '2026-10-28T12:00:00Z',
  };
  const empty: PersonalCirculation = { serverTime: session.serverTime, loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
  const loan = { id: 'loan', book: { id: book.id, title: book.title }, startedAt: session.serverTime, dueAt: '2026-11-17T12:00:00Z' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), providePrimeNG({ unstyled: true })] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    fixture = undefined;
  });
  afterEach(() => {
    try { http.verify(); }
    finally { fixture?.destroy(); TestBed.resetTestingModule(); }
  });
  async function settle() { fixture!.detectChanges(); await fixture!.whenStable(); fixture!.detectChanges(); }
  async function mount(authenticated = true) {
    auth.restore();
    const restore = http.expectOne('/api/auth/session');
    if (authenticated) restore.flush(session);
    else restore.flush({}, { status: 401, statusText: 'Unauthorized' });
    fixture = TestBed.createComponent(CatalogPage);
    http.expectOne('/api/books').flush({ books: [book] });
    http.expectOne('/api/subjects').flush({ subjects: [] });
    await settle();
  }
  async function flushPrivate(data: PersonalCirculation = empty) {
    http.expectOne('/api/me/circulation').flush(data);
    await settle();
  }
  function root(): HTMLElement { return fixture!.nativeElement; }
  function requestButton(): HTMLButtonElement { return root().querySelector('app-book-card button')!; }

  it('el visitante conserva el catálogo y abre login sin consultar datos privados', async () => {
    await mount(false);
    http.expectNone('/api/me/circulation');
    expect(root().querySelector('.personal-state')).toBeNull();
    expect(requestButton().disabled).toBe(false);
    requestButton().click();
    expect(auth.loginRequested()).toBe(true);
    expect(fixture!.componentInstance.requestedBook()).toBeNull();
    http.expectNone('/api/loans');
  });

  for (const state of ['loan', 'wait', 'reservation'] as const) {
    it(`consulta una sola vez y presenta el estado ${state} con bloqueo accesible`, async () => {
      await mount();
      expect(requestButton().disabled).toBe(true);
      expect(root().textContent).toContain('Comprobando tus préstamos');
      const data: PersonalCirculation = {
        ...empty,
        loans: state === 'loan' ? [loan] : [],
        waits: state === 'wait' ? [{ id: 'wait', book: loan.book, joinedAt: session.serverTime, position: 2 }] : [],
        reservations: state === 'reservation' ? [{ id: 'reserve', queueEntryId: 'entry', book: loan.book,
          offeredAt: session.serverTime, expiresAt: '2026-10-29T12:00:00Z' }] : [],
      };
      await flushPrivate(data);
      expect(root().textContent).toContain(state === 'loan' ? 'Lo tenés prestado' : state === 'wait' ? 'En espera' : 'Tu turno llegó');
      expect(requestButton().disabled).toBe(true);
      const describedBy = requestButton().getAttribute('aria-describedby');
      expect(root().querySelector(`[id="${describedBy}"]`)?.textContent?.length).toBeGreaterThan(0);
      requestButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(fixture!.componentInstance.requestedBook()).toBeNull();
      http.expectNone('/api/me/circulation');
      http.expectNone('/api/loans');
    });
  }

  it('cinco préstamos bloquean otros libros sin alterar la disponibilidad pública', async () => {
    await mount();
    await flushPrivate({ ...empty, loans: Array.from({ length: 5 }, (_, index) => ({ ...loan, id: `loan-${index}`,
      book: { id: `other-${index}`, title: 'Otro libro' } })),
      requestConstraints: { activeLoanCount: 5, maxActiveLoans: 5, openQueueBookIds: [] } });
    expect(root().textContent).toContain('Tenés cinco préstamos activos');
    expect(root().querySelector('.availability')?.textContent).toContain('1/1');
    expect(requestButton().disabled).toBe(true);
  });

  it('una entrada OFFERED pendiente bloquea hasta que una actualización confirme su cierre', async () => {
    await mount();
    await flushPrivate({ ...empty, requestConstraints: { ...empty.requestConstraints, openQueueBookIds: [book.id] } });
    expect(root().querySelector('.personal-state')?.textContent).toContain('Conciliación pendiente');
    expect(root().querySelector('.personal-state')?.textContent).not.toContain('Tu turno llegó');
    expect(requestButton().disabled).toBe(true);
    const description = requestButton().getAttribute('aria-describedby');
    expect(root().querySelector(`[id="${description}"]`)?.textContent).toBe('Tu entrada en cola sigue abierta. Actualizá para comprobar su estado');
    requestButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture!.componentInstance.requestLoan(book);
    expect(fixture!.componentInstance.requestedBook()).toBeNull();
    http.expectNone('/api/loans');
    const update = Array.from(root().querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Actualizar disponibilidad y préstamos'))!;
    update.click();
    http.expectOne('/api/books').flush({ books: [book] });
    await flushPrivate();
    expect(root().querySelector('.personal-state')).toBeNull();
    expect(requestButton().disabled).toBe(false);
    requestButton().click();
    expect(fixture!.componentInstance.requestedBook()?.id).toBe(book.id);
  });

  it('un error conserva el catálogo, permite reintentar y no finge que no hay préstamos', async () => {
    await mount();
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(root().querySelector('p-message')?.textContent).toContain('No pudimos comprobar tus préstamos. Reintentá para continuar');
    expect(root().querySelectorAll('article.book-card').length).toBe(1);
    expect(root().querySelector('.availability')?.textContent).toContain('1/1');
    expect(requestButton().disabled).toBe(true);
    const description = requestButton().getAttribute('aria-describedby');
    expect(root().querySelector(`[id="${description}"]`)?.textContent).toBe('No pudimos comprobar tus préstamos. Reintentá para continuar');
    requestButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture!.componentInstance.requestLoan(book);
    expect(fixture!.componentInstance.requestedBook()).toBeNull();
    http.expectNone('/api/loans');
    const retry = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Reintentar consulta personal'))!;
    retry.click();
    await settle();
    expect(requestButton().disabled).toBe(true);
    http.expectOne('/api/books').flush({ books: [book] });
    await flushPrivate();
    expect(root().querySelector('p-message')).toBeNull();
    expect(requestButton().disabled).toBe(false);
    requestButton().click();
    expect(fixture!.componentInstance.requestedBook()?.id).toBe(book.id);
  });

  it('un error personal no bloquea al visitante después del logout', async () => {
    await mount();
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(requestButton().disabled).toBe(true);
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(root().querySelector('p-message')).toBeNull();
    expect(requestButton().disabled).toBe(false);
    http.expectNone('/api/me/circulation');
    requestButton().click();
    expect(auth.loginRequested()).toBe(true);
    expect(fixture!.componentInstance.requestedBook()).toBeNull();
  });

  it('una cuenta nueva no hereda el error ni el bloqueo de la cuenta anterior', async () => {
    await mount();
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(requestButton().disabled).toBe(true);
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea' } });
    await settle();
    expect(root().querySelector('p-message')).toBeNull();
    expect(requestButton().disabled).toBe(true);
    expect(root().textContent).toContain('Comprobando tus préstamos');
    await flushPrivate();
    expect(requestButton().disabled).toBe(false);
    expect(root().textContent).not.toContain('No pudimos comprobar tus préstamos');
  });

  it('cambiar filtros no repite la consulta personal y el éxito actualiza sin duplicar POST', async () => {
    await mount();
    await flushPrivate();
    fixture!.componentInstance.searchByTitle('Redes', true);
    const filtered = http.expectOne(request => request.url === '/api/books');
    expect(filtered.request.params.get('title')).toBe('Redes');
    filtered.flush({ books: [book] });
    await settle();
    http.expectNone('/api/me/circulation');
    requestButton().click();
    await settle();
    const dialog: LoanDialog = fixture!.debugElement.query(By.directive(LoanDialog)).componentInstance;
    dialog.confirm(); dialog.confirm();
    const post = http.expectOne('/api/loans');
    expect(post.request.method).toBe('POST');
    post.flush({ loan: { id: loan.id, bookId: book.id, startedAt: loan.startedAt, dueAt: loan.dueAt } }, { status: 201, statusText: 'Created' });
    await flushPrivate({ ...empty, loans: [loan], requestConstraints: { ...empty.requestConstraints, activeLoanCount: 1 } });
    expect(root().textContent).toContain('Lo tenés prestado');
    dialog.confirm();
    http.expectNone('/api/loans');
    dialog.close();
    const refreshed = http.expectOne(request => request.url === '/api/books');
    expect(refreshed.request.params.get('title')).toBe('Redes');
    refreshed.flush({ books: [{ ...book, availability: { availableCopies: 0, totalCopies: 1 } }] });
    await settle();
    expect(fixture!.componentInstance.titleQuery()).toBe('Redes');
    expect(requestButton().disabled).toBe(true);
    http.expectNone('/api/me/circulation');
  });

  it('logout retira los estados privados y permite al visitante volver a iniciar sesión', async () => {
    await mount(); await flushPrivate({ ...empty, loans: [loan] });
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(root().querySelector('.personal-state')).toBeNull();
    expect(requestButton().disabled).toBe(false);
    http.expectNone('/api/me/circulation');
    requestButton().click();
    expect(auth.loginRequested()).toBe(true);
  });

  it('cambiar de cuenta cancela respuestas viejas antes de mostrar la nueva fotografía', async () => {
    await mount();
    const old = http.expectOne('/api/me/circulation');
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea' } });
    await settle();
    expect(old.cancelled).toBe(true);
    expect(() => old.flush({ ...empty, loans: [loan] })).toThrow();
    await flushPrivate();
    expect(root().textContent).not.toContain('Lo tenés prestado');
  });

  it('eventos de foco agrupados refrescan información pública y personal una sola vez', async () => {
    await mount(); await flushPrivate();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush(session);
    http.expectOne('/api/books').flush({ books: [book] });
    await flushPrivate();
    expect(root().querySelectorAll('article.book-card').length).toBe(1);
  });
});

function selectRoot(fixture: ReturnType<typeof createCatalogFixture>['fixture']): HTMLElement {
  const root = fixture.nativeElement.querySelector('.p-select');
  if (!(root instanceof HTMLElement)) throw new Error('No se encontró el control Select de PrimeNG');
  return root;
}

function selectedAuthorLabel(fixture: ReturnType<typeof createCatalogFixture>['fixture']): string {
  const label = selectRoot(fixture).querySelector('.p-select-label');
  if (!(label instanceof HTMLElement)) throw new Error('No se encontrÃ³ la etiqueta de selecciÃ³n de PrimeNG');
  return label.textContent?.trim() ?? '';
}

async function openAuthorSelect(fixture: ReturnType<typeof createCatalogFixture>['fixture']): Promise<void> {
  selectRoot(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function authorSearchInput(fixture: ReturnType<typeof createCatalogFixture>['fixture']): HTMLInputElement {
  const input = overlayFor(fixture.nativeElement as HTMLElement, 'catalog-author-overlay')
    .querySelector('input[aria-label="Buscar autores"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No se encontró el filtro accesible de autores');
  return input;
}

async function typeAuthorSearch(fixture: ReturnType<typeof createCatalogFixture>['fixture'], query: string): Promise<void> {
  const input = authorSearchInput(fixture);
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
  await new Promise(resolve => setTimeout(resolve, 510));
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
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('renders the PrimeNG title search, searches while typing, and shows Sin resultados', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    expect(fixture.debugElement.query(By.directive(InputText))?.nativeElement).toBe(input);
    expect(fixture.debugElement.query(By.directive(IconField))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(InputIcon))).not.toBeNull();

    input.value = 'cien';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    const search = http.expectOne('/api/books?title=cien');
    expect(search.request.params.get('title')).toBe('cien');
    search.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.title-empty-state h2')?.textContent).toContain('Sin resultados');

    buttonByText(fixture, 'Limpiar todos los filtros').click();
    const cleared = expectBooks(http);
    expect(cleared.request.params.has('title')).toBe(false);
    cleared.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(fixture.nativeElement.querySelector('.title-empty-state')).toBeNull();
  });

  it('combines title and author criteria and keeps authors when the title is cleared', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Algoritmos', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
    ] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();
    const byAuthor = expectBooks(http);
    expect(byAuthor.request.params.getAll('authorIds')).toEqual(['author-1']);
    byAuthor.flush({ books: [
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Algoritmos', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
    ] });
    await fixture.whenStable();

    const title = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'red';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    const combined = expectBooks(http);
    expect(combined.request.params.get('title')).toBe('red');
    expect(combined.request.params.getAll('authorIds')).toEqual(['author-1']);
    combined.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] }] });
    await fixture.whenStable();

    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    const titleCleared = expectBooks(http);
    expect(titleCleared.request.params.has('title')).toBe(false);
    expect(titleCleared.request.params.getAll('authorIds')).toEqual(['author-1']);
    titleCleared.flush({ books: [
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Algoritmos', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] },
    ] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Algoritmos');
  });

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
    expect(overlayFor(fixture.nativeElement as HTMLElement, 'catalog-author-overlay').textContent)
      .toContain('Escribí un término para buscar autores');
    expect(overlayFor(fixture.nativeElement as HTMLElement, 'catalog-author-overlay').textContent).not.toContain('Recientes');
    expect(overlayFor(fixture.nativeElement as HTMLElement, 'catalog-author-overlay').textContent).not.toContain('Mostrar lista completa');
  });

  it('moves focus into the author search and returns focus to the Select when confirmed or cancelled', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    const select = selectRoot(fixture);
    await openAuthorSelect(fixture);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(authorSearchInput(fixture));
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(select.querySelector('.p-select-label'));
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    await openAuthorSelect(fixture);
    authorSearchInput(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    expect(fixture.componentInstance.authorMenuOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('.catalog-author-overlay')).toBeNull();
    expect(document.activeElement).toBe(select.querySelector('.p-select-label'));
    for (const request of http.match('/api/books')) request.flush({ books: [] });
  });

  it('does not focus the author search if PrimeNG closes before the next render', () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    fixture.detectChanges();
    const searchInput = document.createElement('input');
    searchInput.setAttribute('aria-label', 'Buscar autores');
    fixture.nativeElement.append(searchInput);
    const focus = vi.spyOn(searchInput, 'focus');
    const originalSetTimeout = globalThis.setTimeout;
    let focusTimer: (() => void) | undefined;
    const timers = vi.spyOn(globalThis, 'setTimeout');
    timers.mockImplementation((handler, delay) => {
      if (delay === 50) {
        if (typeof handler === 'function') focusTimer = handler as () => void;
        return 0;
      }
      return originalSetTimeout(handler, delay);
    });

    try {
      fixture.componentInstance.onAuthorMenuShow();
      fixture.componentInstance.onAuthorMenuHide();
      fixture.detectChanges();

      expect(focusTimer).toBeDefined();
      focusTimer?.();

      expect(fixture.componentInstance.authorMenuOpen()).toBe(false);
      expect(focus).not.toHaveBeenCalled();
    } finally {
      timers.mockRestore();
    }
  });

  it('keeps the title filter when all selected authors are removed', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();

    const byAuthor = expectBooks(http);
    expect(byAuthor.request.params.getAll('authorIds')).toEqual(['author-1']);
    byAuthor.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] }] });
    await fixture.whenStable();

    const title = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'red';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    const combined = expectBooks(http);
    expect(combined.request.params.get('title')).toBe('red');
    expect(combined.request.params.getAll('authorIds')).toEqual(['author-1']);
    combined.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [] }] });
    await fixture.whenStable();

    buttonByText(fixture, 'Quitar filtro de autor Ana').click();
    const titleOnly = expectBooks(http);
    expect(titleOnly.request.params.get('title')).toBe('red');
    expect(titleOnly.request.params.has('authorIds')).toBe(false);
    titleOnly.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Redes avanzadas', authors: [], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(title.value).toBe('red');
    expect(fixture.nativeElement.textContent).toContain('Redes avanzadas');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
  });

  it('sends PrimeNG filter input to the remote author search endpoint', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    http.expectNone('/api/authors');

    await typeAuthorSearch(fixture, 'ana');
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
    await typeAuthorSearch(fixture, 'a');
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
    await typeAuthorSearch(fixture, 'a');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'a')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    await fixture.whenStable();
    fixture.detectChanges();

    chooseAuthor(fixture, 'Ana');
    chooseAuthor(fixture, 'Beatriz');
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(selectedAuthorLabel(fixture)).toBe('Seleccionar autores');
    expect(http.match('/api/books')).toHaveLength(0);
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1', 'author-2']);
    filtered.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Redes', authors: [{ id: 'author-3', name: 'Autora visible' }], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Redes');
    expect(fixture.nativeElement.textContent).toContain('Autora visible');
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(2);
    expect(selectedAuthorLabel(fixture)).toBe('Autores (2)');
  });

  it('shows the applied author count without overflowing when remote results change and the selector reopens', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);

    await typeAuthorSearch(fixture, 'ana');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana')
      .flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'Ana');
    expect(selectedAuthorLabel(fixture)).toBe('Seleccionar autores');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1']);
    filtered.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(selectedAuthorLabel(fixture)).toBe('Autores (1)');

    await openAuthorSelect(fixture);

    fixture.componentInstance.authorSuggestions.set([{ id: 'author-2', name: 'William Stallings' }]);
    fixture.detectChanges();
    expect(selectedAuthorLabel(fixture)).toBe('Autores (1)');
    expect(fixture.componentInstance.authorOptions().map(({ name }) => name)).toEqual(['Ana', 'William Stallings']);
    expect(fixture.componentInstance.selectedAuthors().map(({ id }) => id)).toEqual(['author-1']);
    expect(selectedAuthorLabel(fixture)).not.toContain('[object Object]');
  });

  it('discards provisional selections when the actual PrimeNG overlay closes', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
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
    await typeAuthorSearch(fixture, 'a');
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
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Libro uno', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Libro dos', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b3', title: 'Libro tres', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b4', title: 'Libro cuatro', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b5', title: 'Libro cinco', authors: [], subjects: [] },
    ] });
    await fixture.whenStable();
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'William Stallings');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'William Stallings')
      .flush({ authors: [{ id: 'author-1', name: 'William Stallings' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    chooseAuthor(fixture, 'William Stallings');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();

    const filtered = expectBooks(http);
    expect(filtered.request.params.getAll('authorIds')).toEqual(['author-1']);
    filtered.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Libro uno', authors: [{ id: 'author-1', name: 'William Stallings' }], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(selectedAuthorLabel(fixture)).toBe('Autores (1)');
    expect(fixture.componentInstance.books()).toHaveLength(1);

    buttonByText(fixture, 'Quitar filtro de autor William Stallings').click();
    const unfiltered = expectBooks(http);
    expect(unfiltered.request.params.has('authorIds')).toBe(false);
    unfiltered.flush({ books: [
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b1', title: 'Libro uno', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b2', title: 'Libro dos', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b3', title: 'Libro tres', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b4', title: 'Libro cuatro', authors: [], subjects: [] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'b5', title: 'Libro cinco', authors: [], subjects: [] },
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

    await typeAuthorSearch(fixture, 'nobody');
    http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'nobody')
      .flush({ authors: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se encontraron autores');

    await typeAuthorSearch(fixture, 'failure');
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
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-1', title: 'Redes', authors: [{ id: 'a1', name: 'Ana' }, { id: 'a2', name: 'Beatriz' }], subjects: [{ id: 's1', name: 'Redes' }, { id: 's2', name: 'Sistemas' }] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-2', title: 'Algoritmos', authors: [], subjects: [] },
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
    await typeAuthorSearch(fixture, 'ana');
    const pendingAuthors = http.expectOne((request) => request.url === '/api/authors' && request.params.get('q') === 'ana');
    fixture.destroy();
    expect(pendingAuthors.cancelled).toBe(true);
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
    const select = fixture.debugElement.query(By.css('p-select.subject-select')).componentInstance as Select;
    expect(select.multiple()).toBe(true);
    expect(select.filter()).toBe(true);
    expect(select.optionLabel()).toBe('name');
    expect(select.dataKey()).toBe('id');
    expect(fixture.debugElement.query(By.directive(Checkbox))).not.toBeNull();
    expect(root.textContent).not.toContain('Recientes');
    expect(root.textContent).not.toContain('Mostrar lista completa');

    const panel = overlayFor(root, 'catalog-subject-overlay');
    const filter = panel.querySelector('input.p-select-filter') as HTMLInputElement;
    filter.value = 'sist';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const options = Array.from(panel.querySelectorAll('.p-select-option'));
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Sistemas');
    expect(options[0]?.querySelector('p-checkbox')).not.toBeNull();
    expect(panel.textContent).toContain('Limpiar');
    expect(panel.textContent).toContain('Listo');
    expect(panel.querySelector('.filter-clear')).not.toBeNull();
    expect(panel.querySelector('.filter-done')).not.toBeNull();
    expect(http.match('/api/books')).toHaveLength(0);
    panel.querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);
  });

  it('keeps one and multiple subject changes provisional until Listo, then applies them together', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/books').flush({
      books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-1', title: 'Libro visible', authors: [], subjects: [] }],
    });
    http.expectOne('/api/subjects').flush({ subjects });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = openSubjectSelector(fixture);
    chooseSubject(root, 'Redes');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(root.querySelector('p-select.subject-select')?.textContent).not.toContain('(');
    expect(fixture.componentInstance.books().map(({ id }) => id)).toEqual(['book-1']);
    expect(root.querySelector('app-book-card')).not.toBeNull();
    expect(http.match('/api/books')).toHaveLength(0);

    chooseSubject(root, 'Sistemas');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);
    expect(root.querySelector('p-select.subject-select')?.textContent).not.toContain('(');
    overlayFor(root, 'catalog-subject-overlay').querySelector('.filter-footer button:last-child')?.dispatchEvent(
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
    overlayFor(root, 'catalog-subject-overlay').querySelector('.filter-footer button:last-child')?.dispatchEvent(
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
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();
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
    await new Promise(resolve => setTimeout(resolve, 510));
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
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();
    fixture.detectChanges();
    const withAuthor = expectBooks(http);
    withAuthor.flush({ books: [] });
    await fixture.whenStable();

    const title = root.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'redes';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
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
    overlayFor(root, 'catalog-subject-overlay').querySelector('input.p-select-filter')?.dispatchEvent(new KeyboardEvent('keydown', {
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

    const subjectSelectComponent = fixture.debugElement.query(By.css('p-select.subject-select')).componentInstance as Select;
    subjectSelectComponent.show();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(subjectOption(root, 'Redes')?.getAttribute('aria-selected')).toBe('false');
    expect(subjectOption(root, 'Sistemas')?.getAttribute('aria-selected')).toBe('false');
    overlayFor(root, 'catalog-subject-overlay').querySelector('.filter-footer button:last-child')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(http.match('/api/books')).toHaveLength(0);

    title.value = 'algoritmos';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    fixture.detectChanges();
    const afterCancel = expectBooks(http);
    expect(afterCancel.request.params.get('title')).toBe('algoritmos');
    expect(afterCancel.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(afterCancel.request.params.has('subjectIds')).toBe(false);
    afterCancel.flush({ books: [] });
    await fixture.whenStable();
  });

  it('clears title, authors, and subjects together and reloads the unfiltered catalog', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/books').flush({ books: [] });
    http.expectOne('/api/subjects').flush({ subjects });
    await fixture.whenStable();
    fixture.detectChanges();

    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();
    const byAuthor = expectBooks(http);
    expect(byAuthor.request.params.getAll('authorIds')).toEqual(['author-1']);
    byAuthor.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    openSubjectSelector(fixture);
    chooseSubject(root, 'Redes');
    overlayFor(root, 'catalog-subject-overlay').querySelector('.filter-done')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const byAuthorAndSubject = expectBooks(http);
    expect(byAuthorAndSubject.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(byAuthorAndSubject.request.params.getAll('subjectIds')).toEqual([subjects[0]?.id]);
    byAuthorAndSubject.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const title = root.querySelector('#catalog-title-search') as HTMLInputElement;
    title.value = 'sin coincidencias';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 510));
    const noResults = expectBooks(http);
    expect(noResults.request.params.get('title')).toBe('sin coincidencias');
    expect(noResults.request.params.getAll('authorIds')).toEqual(['author-1']);
    expect(noResults.request.params.getAll('subjectIds')).toEqual([subjects[0]?.id]);
    noResults.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('.title-empty-state h2')?.textContent).toContain('Sin resultados');
    expect(root.querySelectorAll('[aria-label^="Quitar filtro de autor "]')).toHaveLength(1);
    expect(root.querySelectorAll('[aria-label^="Quitar materia "]')).toHaveLength(1);
    buttonByText(fixture, 'Limpiar todos los filtros').click();

    const unfiltered = expectBooks(http);
    expect(unfiltered.request.params.has('title')).toBe(false);
    expect(unfiltered.request.params.has('authorIds')).toBe(false);
    expect(unfiltered.request.params.has('subjectIds')).toBe(false);
    unfiltered.flush({ books: [
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-1', title: 'Redes', authors: [{ id: 'author-1', name: 'Ana' }], subjects: [subjects[0]!] },
      { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-2', title: 'Algoritmos', authors: [], subjects: [] },
    ] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(title.value).toBe('');
    expect(fixture.componentInstance.titleQuery()).toBe('');
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(fixture.componentInstance.draftAuthors()).toEqual([]);
    expect(fixture.componentInstance.selectedSubjects()).toEqual([]);
    expect(fixture.componentInstance.draftSubjects()).toEqual([]);
    expect(root.querySelectorAll('.chip')).toHaveLength(0);
    expect(selectedAuthorLabel(fixture)).toBe('Seleccionar autores');
    expect(root.querySelector('p-select.subject-select')?.textContent).toContain('Materias');
    expect(root.querySelector('p-select.subject-select')?.textContent).not.toContain('(1)');
    expect(root.querySelectorAll('app-book-card')).toHaveLength(2);
  });

  it('lets the empty-results action remove an author-only filter', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    expectAuthorSearch(http, 'ana').flush({ authors: [{ id: 'author-1', name: 'Ana' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    buttonByText(fixture, 'Listo').click();
    const authorOnly = expectBooks(http);
    expect(authorOnly.request.params.getAll('authorIds')).toEqual(['author-1']);
    authorOnly.flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.title-empty-state h2')?.textContent).toContain('Sin resultados');
    buttonByText(fixture, 'Limpiar todos los filtros').click();
    const unfiltered = expectBooks(http);
    expect(unfiltered.request.params.has('authorIds')).toBe(false);
    expect(unfiltered.request.params.has('title')).toBe(false);
    expect(unfiltered.request.params.has('subjectIds')).toBe(false);
    unfiltered.flush({ books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-1', title: 'Redes', authors: [], subjects: [] }] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.chip')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('app-book-card')).toHaveLength(1);
  });

  it('shows subject loading errors, retries, and distinguishes an empty independent subject list', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/books').flush({ books: [] });
    const select = fixture.debugElement.query(By.css('p-select.subject-select')).componentInstance as Select;
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
  it('clears provisional authors on Listo without applying them early', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();

    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'a');
    expectAuthorSearch(http, 'a').flush({ authors: [{ id: 'author-1', name: 'Ana' }, { id: 'author-2', name: 'Beatriz' }] });
    await fixture.whenStable();
    chooseAuthor(fixture, 'Ana');
    expect(fixture.componentInstance.draftAuthors().map(({ id }) => id)).toEqual(['author-1']);
    buttonByText(fixture, 'Limpiar').click();
    expect(fixture.componentInstance.draftAuthors()).toEqual([]);
    expect(fixture.componentInstance.selectedAuthors()).toEqual([]);
    expect(http.match('/api/books')).toHaveLength(0);

    buttonByText(fixture, 'Listo').click();
    const cleared = expectBooks(http);
    expect(cleared.request.params.has('authorIds')).toBe(false);
    cleared.flush({ books: [] });
    await fixture.whenStable();
  });
  it('muestra disponibilidad y distingue cero cupos con una sola consulta de libros', async () => {
    const { fixture, http } = createCatalogFixture();
    const request = expectBooks(http);
    request.flush({ books: [
      { id: 'available', title: 'Redes', authors: [], subjects: [], availability: { availableCopies: 2, totalCopies: 5 } },
      { id: 'unavailable', title: 'Álgebra', authors: [], subjects: [], availability: { availableCopies: 0, totalCopies: 1 } },
    ] });
    await fixture.whenStable();
    fixture.detectChanges();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('article.book-card');
    expect(cards[0]?.textContent).toContain('2/5');
    expect(cards[0]?.classList.contains('unavailable')).toBe(false);
    expect(cards[1]?.textContent).toContain('0/1');
    expect(cards[1]?.textContent).toContain('Sin cupos disponibles');
    expect(cards[1]?.classList.contains('unavailable')).toBe(true);
    expect(cards[1]?.hasAttribute('aria-disabled')).toBe(false);
    http.expectNone('/api/availability');
    http.expectNone('/api/books');
  });

  it('cancels catalog, subject, and pending author requests when leaving the page', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const pendingBooks = expectBooks(http);
    const pendingSubjects = http.expectOne('/api/subjects');
    await openAuthorSelect(fixture);
    await typeAuthorSearch(fixture, 'ana');
    const pendingAuthors = expectAuthorSearch(http, 'ana');

    fixture.destroy();
    expect(pendingBooks.cancelled).toBe(true);
    expect(pendingSubjects.cancelled).toBe(true);
    expect(pendingAuthors.cancelled).toBe(true);
  });
});

describe('Catalog search delay', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView ??= () => {};
    TestBed.configureTestingModule({ providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()] });
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(HttpTestingController).verify();
  });

  it('waits 500 ms since the latest title change and cancels old work immediately', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    vi.useFakeTimers();
    const page = fixture.componentInstance;
    page.searchByTitle('r');
    vi.advanceTimersByTime(499);
    http.expectNone(request => request.url === '/api/books');
    page.searchByTitle('re');
    vi.advanceTimersByTime(499);
    http.expectNone(request => request.url === '/api/books');
    vi.advanceTimersByTime(1);
    const old = http.expectOne('/api/books?title=re');
    page.searchByTitle('red');
    expect(old.cancelled).toBe(true);
    vi.advanceTimersByTime(499);
    http.expectNone(request => request.url === '/api/books');
    vi.advanceTimersByTime(1);
    http.expectOne('/api/books?title=red').flush({ books: [] });
    page.searchByTitle('red ');
    vi.advanceTimersByTime(500);
    http.expectNone(request => request.url === '/api/books');
    page.searchByTitle('');
    vi.advanceTimersByTime(400);
    page.searchByTitle('otro');
    vi.advanceTimersByTime(500);
    http.expectOne('/api/books?title=otro').flush({ books: [] });
    page.searchByTitle('', true);
    http.expectOne('/api/books').flush({ books: [] });
  });

  it('clear and explicit filter actions replace pending typing without a delayed duplicate', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    vi.useFakeTimers();
    const page = fixture.componentInstance;
    page.searchByTitle('red');
    page.updateDraftSubjects(subjects);
    page.applySubjectSelection();
    const immediate = expectBooks(http);
    expect(immediate.request.params.get('title')).toBe('red');
    expect(immediate.request.params.getAll('subjectIds')).toEqual(subjects.map(({ id }) => id));
    immediate.flush({ books: [] });
    vi.advanceTimersByTime(500);
    http.expectNone(request => request.url === '/api/books');
    page.searchByTitle('otro');
    page.clearFilters();
    http.expectOne('/api/books').flush({ books: [] });
    vi.advanceTimersByTime(500);
    http.expectNone(request => request.url === '/api/books');
  });

  it('debounces authors and cancels pending or active searches when the menu closes', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    vi.useFakeTimers();
    const page = fixture.componentInstance;
    page.searchAuthors('a');
    vi.advanceTimersByTime(400);
    page.searchAuthors('an');
    vi.advanceTimersByTime(499);
    http.expectNone(request => request.url === '/api/authors');
    vi.advanceTimersByTime(1);
    const active = expectAuthorSearch(http, 'an');
    page.searchAuthors('ana');
    expect(active.cancelled).toBe(true);
    page.onAuthorMenuHide();
    vi.advanceTimersByTime(500);
    http.expectNone(request => request.url === '/api/authors');
    page.onAuthorMenuShow();
    page.searchAuthors('ana');
    vi.advanceTimersByTime(500);
    expectAuthorSearch(http, 'ana').flush({ authors: [] });
  });

  it('does not send pending searches after leaving the catalog', async () => {
    const { fixture, http } = createCatalogFixture();
    expectBooks(http).flush({ books: [] });
    await fixture.whenStable();
    vi.useFakeTimers();
    fixture.componentInstance.searchByTitle('pendiente');
    fixture.componentInstance.searchAuthors('pendiente');
    fixture.destroy();
    vi.advanceTimersByTime(500);
    http.expectNone(request => request.url === '/api/books' || request.url === '/api/authors');
  });
});
