import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { App } from './app';
import { routes } from './app.routes';
import { AuthService } from './auth/auth.service';
import type { AuthResponse } from './auth/auth.types';

describe('App: cierre de sesión sin API real', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let router: Router;
  const response: AuthResponse = {
    user: { id: 'user', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid',
      university: { id: 'university', name: 'Universidad' } },
    session: { createdAt: '2026-10-24T12:00:00Z', expiresAt: '2026-10-24T18:00:00Z' },
    serverTime: '2026-10-24T12:00:00Z',
  };
  const books = [
    { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-1', title: 'Redes de prueba', authors: [{ id: 'author', name: 'Autora de prueba' }], subjects: [] },
    { availability: { availableCopies: 1, totalCopies: 1 }, id: 'book-2', title: 'Algoritmos de prueba', authors: [], subjects: [] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [
      provideRouter(routes), providePrimeNG({ unstyled: true }), provideHttpClient(), provideHttpClientTesting(),
    ] }).compileComponents();
    fixture = TestBed.createComponent(App);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(response);
    fixture.detectChanges();
  });
  afterEach(() => {
    try { http.verify(); }
    finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  function root(): HTMLElement { return fixture.nativeElement as HTMLElement; }
  function logoutButton(): HTMLButtonElement | undefined {
    return Array.from(root().querySelectorAll<HTMLButtonElement>('.account-actions button'))
      .find((button) => button.textContent?.includes('Cerrar sesión'));
  }
  async function navigate(url: string): Promise<void> {
    await router.navigateByUrl(url);
    fixture.detectChanges();
    for (const request of http.match('/api/books')) {
      expect(request.request.method).toBe('GET');
      request.flush({ books });
    }
    for (const request of http.match('/api/subjects')) request.flush({ subjects: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function confirmLogout(): void {
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
  }

  it('conserva la identidad y muestra Cerrar sesión únicamente con sesión autenticada', () => {
    expect(root().querySelector('.account-name')?.textContent).toContain('Hola, Ana');
    expect(logoutButton()).toBeDefined();
    expect(root().querySelector('.account-actions a[href="/registro"]')).toBeNull();
    logoutButton()!.click();
    confirmLogout();
    expect(logoutButton()).toBeUndefined();
    expect(root().querySelector('.account-name')).toBeNull();
    expect(root().querySelector('.account-actions button')?.textContent).toContain('Ingresar');
    expect(root().querySelector('.account-actions a[href="/registro"]')?.textContent).toContain('Crear cuenta');
  });

  it('muestra carga, bloquea clics duplicados y mantiene la identidad hasta confirmar', () => {
    const button = logoutButton()!;
    button.click();
    const request = http.expectOne('/api/auth/logout');
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[data-p-icon="spinner"], .pi-spinner')).not.toBeNull();
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root().querySelector('.account-name')?.textContent).toContain('Hola, Ana');
    http.expectNone('/api/auth/logout');
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
  });

  it('un 503 conserva la cuenta, presenta el error y permite reintentar', () => {
    logoutButton()!.click();
    http.expectOne('/api/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(root().querySelector('.account-name')?.textContent).toContain('Hola, Ana');
    expect(root().textContent).toContain('No pudimos cerrar tu sesión. Intentá nuevamente.');
    expect(logoutButton()!.disabled).toBe(false);
    logoutButton()!.click();
    fixture.detectChanges();
    expect(root().textContent).not.toContain('No pudimos cerrar tu sesión.');
    confirmLogout();
    expect(TestBed.inject(AuthService).status()).toBe('anonymous');
  });

  it('permanece en la ruta actual después del cierre exitoso', async () => {
    await navigate('/?origen=prueba#contenido');
    const url = router.url;
    logoutButton()!.click();
    confirmLogout();
    await fixture.whenStable();
    expect(router.url).toBe(url);
    expect(root().querySelector('app-home-page')).not.toBeNull();
  });

  it('en /prestamos vuelve a pedir autenticación sin redirigir ni modificar la página', async () => {
    await navigate('/prestamos');
    expect(root().textContent).toContain('Tus lecturas, en un solo lugar');
    logoutButton()!.click();
    confirmLogout();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/prestamos');
    expect(root().textContent).toContain('Ingresá a tu cuenta para acceder a la sección de préstamos.');
    expect(root().textContent).not.toContain('Tus lecturas, en un solo lugar');
    const login = Array.from(root().querySelectorAll<HTMLButtonElement>('app-loans-page button'))
      .find((button) => button.textContent?.includes('Ingresar a mi cuenta'))!;
    login.click();
    expect(TestBed.inject(AuthService).loginRequested()).toBe(true);
    http.expectNone('/api/auth/login');
  });

  it('conserva los libros y el carácter público del catálogo después del logout', async () => {
    await navigate('/catalogo');
    const catalog = root().querySelector('app-catalog-page');
    expect(catalog?.querySelectorAll('article').length).toBe(2);
    logoutButton()!.click();
    confirmLogout();
    await fixture.whenStable();
    expect(router.url).toBe('/catalogo');
    expect(root().querySelector('app-catalog-page')).toBe(catalog);
    for (const book of books) expect(catalog?.textContent).toContain(book.title);
    http.expectNone('/api/books');
    await navigate('/');
    await router.navigateByUrl('/catalogo');
    fixture.detectChanges();
    http.expectOne('/api/subjects').flush({ subjects: [] });
    const request = http.expectOne('/api/books');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ books });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root().querySelectorAll('app-catalog-page article').length).toBe(2);
    http.expectNone('/api/auth/session');
  });
});
