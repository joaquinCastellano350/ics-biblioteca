import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CatalogPage } from './catalog-page';
import { appConfig } from '../app.config';

describe('Public catalog', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('sends title changes to the API and clears the title criterion', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    input.value = 'ciencia';
    input.dispatchEvent(new Event('input'));
    http.expectOne('/api/books?title=ciencia').flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Sin resultados');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Sin resultados');
    expect(fixture.componentInstance.status()).toBe('ready');
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('requests all books without authentication and renders every book with multiple terms', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cargando el catálogo');
    const request = TestBed.inject(HttpTestingController).expectOne('/api/books');
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
    const fixture = TestBed.createComponent(CatalogPage);
    TestBed.inject(HttpTestingController).expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros cargados');
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
  });

  it('offers a working retry after a failed request', async () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/books').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    fixture.nativeElement.querySelector('button').click();
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros cargados');
  });

  it('cancels a pending request when leaving the page', () => {
    const fixture = TestBed.createComponent(CatalogPage);
    const request = TestBed.inject(HttpTestingController).expectOne('/api/books');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });
});
