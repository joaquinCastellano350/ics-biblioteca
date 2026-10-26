import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { App } from '../app';
import { appConfig } from '../app.config';
import { routes } from '../app.routes';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';

// La acción existe solo en la prueba: circulación todavía no forma parte del catálogo.
@Component({
  imports: [App, ButtonModule],
  template: `<app-root /><button pButton type="button" (click)="attempt()">Acción protegida de prueba</button>`,
})
class ProtectedActionFixture {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  completed = 0;
  attempt(): void {
    this.auth.protectedRequest(() => this.http.post('/api/test-action', {}, {
      headers: { 'X-Biblioteca-Request': '1' },
    })).subscribe(() => { this.completed++; });
  }
}

describe('SCRUM-11: reautenticación en la página abierta', () => {
  const session: AuthResponse = {
    user: { id: 'estudiante', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'universidad', name: 'Universidad' } },
    session: { createdAt: '2026-10-25T12:00:00Z', expiresAt: '2026-10-25T18:00:00Z' },
    serverTime: '2026-10-25T12:00:00Z',
  };
  let fixture: ComponentFixture<ProtectedActionFixture>;
  let http: HttpTestingController;
  let router: Router;
  let root: HTMLElement;

  beforeEach(async () => {
    HTMLElement.prototype.scrollIntoView ??= () => undefined;
    await TestBed.configureTestingModule({
      imports: [ProtectedActionFixture],
      providers: [...appConfig.providers, provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(ProtectedActionFixture);
    root = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(session);
    await router.navigateByUrl('/catalogo?q=algebra#resultados');
    http.expectOne('/api/books').flush({ books: [] });
    await fixture.whenStable();
    root.querySelector<HTMLElement>('.p-select-label')!.click();
    fixture.detectChanges();
    const authorSearch = root.querySelector<HTMLInputElement>('p-select input[aria-label="Buscar autores"]')!;
    authorSearch.value = 'Autora';
    authorSearch.dispatchEvent(new Event('input', { bubbles: true }));
    http.expectOne(request => request.url === '/api/authors' && request.params.get('q') === 'Autora')
      .flush({ authors: [{ id: 'autora', name: 'Autora de prueba' }] });
    await fixture.whenStable();
    root.querySelector<HTMLInputElement>('p-checkbox input[type="checkbox"]')!.click();
    root.querySelector<HTMLButtonElement>('.filter-done')!.click();
    const filtered = http.expectOne(request => request.url === '/api/books');
    expect(filtered.request.params.getAll('authorIds')).toEqual(['autora']);
    filtered.flush({ books: [{ id: 'algebra', title: 'Álgebra', authors: [], subjects: [] }] });
    await fixture.whenStable();
  });
  afterEach(() => {
    http.verify();
    fixture.destroy();
    vi.restoreAllMocks();
  });

  for (const expiry of ['local', 'servidor', 'servidor tras vencimiento local']) {
    it(`vencimiento ${expiry}: conserva catálogo y filtros, permite cancelar y exige otro clic tras login`, async () => {
      const book = root.querySelector('article');
      const filter = root.querySelector('.chip');
      // Identificar el botón del fixture sin depender de los controles internos de PrimeNG.
      const opener = Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Acción protegida de prueba')!;
      if (expiry === 'local') {
        const now = performance.now();
        vi.spyOn(performance, 'now').mockReturnValue(now + 6 * 60 * 60 * 1000);
      }
      opener.focus(); opener.click();
      if (expiry !== 'local') {
        const pending = http.expectOne('/api/test-action');
        if (expiry === 'servidor tras vencimiento local') {
          const now = performance.now();
          vi.spyOn(performance, 'now').mockReturnValue(now + 6 * 60 * 60 * 1000);
          window.dispatchEvent(new Event('focus'));
        }
        pending.flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
      }
      await fixture.whenStable();
      expect(root.querySelector('.account-name')).toBeNull();
      expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      http.expectNone('/api/test-action');
      expect(root.querySelector('article')).toBe(book);
      expect(root.querySelector('.chip')).toBe(filter);
      expect(router.url).toBe('/catalogo?q=algebra#resultados');
      const cancel = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Cancelar')!;
      cancel.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(opener);
      expect(fixture.componentInstance.completed).toBe(0);
      opener.click();
      await fixture.whenStable();
      const email = root.querySelector<HTMLInputElement>('#login-email')!;
      const password = root.querySelector<HTMLInputElement>('#login-password')!;
      email.value = 'ana@example.org'; password.value = 'clave';
      email.dispatchEvent(new Event('input')); password.dispatchEvent(new Event('input'));
      root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      http.expectOne('/api/auth/login').flush({ ...session,
        session: { createdAt: '2026-10-25T18:00:00Z', expiresAt: '2026-10-26T00:00:00Z' },
        serverTime: '2026-10-25T18:00:00Z',
      });
      await fixture.whenStable();
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(root.querySelector('.account-name')?.textContent).toContain('Hola, Ana');
      expect(root.querySelector('article')).toBe(book);
      expect(root.querySelector('.chip')).toBe(filter);
      expect(router.url).toBe('/catalogo?q=algebra#resultados');
      http.expectNone('/api/books');
      http.expectNone('/api/test-action');
      expect(fixture.componentInstance.completed).toBe(0);
      opener.click();
      http.expectOne('/api/test-action').flush({ ok: true });
      expect(fixture.componentInstance.completed).toBe(1);
    });
  }
});
