import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { AuthService } from './auth/auth.service';
import type { AuthResponse } from './auth/auth.types';
import type { PersonalCirculation } from './loans/loan-query.types';

describe('integración de catálogo público y login', () => {
  let fixture: ComponentFixture<App> | undefined;
  let http: HttpTestingController | undefined;
  afterEach(() => {
    try { http?.verify(); }
    finally { fixture?.destroy(); TestBed.resetTestingModule(); }
  });
  it('restaura la sesión y permite ingresar sin recrear el catálogo ni cambiar la URL', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(
      { error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' },
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/catalogo?q=algebra');
    http.expectOne('/api/books').flush({ books: [{
      availability: { availableCopies: 1, totalCopies: 1 }, id: 'libro', title: 'Álgebra', authors: [{ id: 'autor', name: 'Autora' }], subjects: [],
    }] });
    http.expectOne('/api/subjects').flush({ subjects: [] });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const book = root.querySelector('article');
    expect(book?.textContent).toContain('Álgebra');
    const auth = TestBed.inject(AuthService);
    expect(auth.status()).toBe('anonymous');
    http.expectNone('/api/me/circulation');
    expect(root.querySelector('.personal-state')).toBeNull();
    root.querySelector<HTMLButtonElement>('.account-actions button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelectorAll('[role="dialog"]').length).toBe(1);
    const email = root.querySelector<HTMLInputElement>('#login-email')!;
    const password = root.querySelector<HTMLInputElement>('#login-password')!;
    email.value = 'estudiante@example.com';
    password.value = 'contraseña de prueba';
    email.dispatchEvent(new Event('input'));
    password.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const response: AuthResponse = {
      user: {
        id: 'usuario', firstName: 'Estudiante', lastName: 'Prueba', email: email.value,
        university: { id: 'universidad', name: 'Universidad' },
      },
      session: { createdAt: '2026-10-23T12:00:00Z', expiresAt: '2026-10-23T18:00:00Z' },
      serverTime: '2026-10-23T12:00:00Z',
    };
    http.expectOne('/api/auth/login').flush(response);
    await fixture.whenStable();
    const personal: PersonalCirculation = {
      serverTime: response.serverTime,
      loans: [{ id: 'loan-estudiante', book: { id: 'libro', title: 'Álgebra' },
        startedAt: response.serverTime, dueAt: '2026-11-12T12:00:00Z' }],
      waits: [], reservations: [],
      requestConstraints: { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: [] },
    };
    const request = http.expectOne('/api/me/circulation');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    request.flush(personal);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(auth.status()).toBe('authenticated');
    expect(root.querySelector('.account-name')?.textContent).toContain('Hola, Estudiante');
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector('article')).toBe(book);
    expect(router.url).toBe('/catalogo?q=algebra');
    expect(root.querySelector('.personal-state')?.textContent).toContain('Lo tenés prestado');
    http.expectNone('/api/books');

    // Una identidad distinta no hereda el préstamo de la cuenta anterior.
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...response,
      user: { ...response.user, id: 'otra-cuenta', firstName: 'Otra' },
    });
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Lo tenés prestado');
    await fixture.whenStable();
    const empty: PersonalCirculation = { serverTime: response.serverTime, loans: [], waits: [], reservations: [],
      requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
    http.expectOne('/api/me/circulation').flush(empty);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.personal-state')).toBeNull();
    expect(root.querySelector('article')).toBe(book);
    expect(router.url).toBe('/catalogo?q=algebra');
    http.expectNone('/api/books');
  });
});
