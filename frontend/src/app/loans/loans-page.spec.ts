import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { App } from '../app';
import { routes } from '../app.routes';
import type { AuthResponse } from '../auth/auth.types';

const session: AuthResponse = {
  user: { id: 'usuario', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
    university: { id: 'facultad', name: 'Facultad' } },
  session: { createdAt: '2026-10-24T12:00:00Z', expiresAt: '2026-10-24T18:00:00Z' },
  serverTime: '2026-10-24T12:00:00Z',
};

describe('acceso a Mis préstamos', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let router: Router;
  let root: HTMLElement;
  const url = '/prestamos?estado=vigentes#contenido';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), providePrimeNG({ unstyled: true }),
        provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App);
    root = fixture.nativeElement;
    fixture.detectChanges();
    await router.navigateByUrl(url);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('espera a comprobar la sesión sin mostrar la sección autenticada', () => {
    expect(root.querySelector('h1')?.textContent).toBe('Mis préstamos');
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    expect(root.querySelector('app-loans-page button')).toBeNull();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
  });

  it('permite abrir el único diálogo de login desde la pantalla sin perder la URL', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Ingresá a tu cuenta');
    expect(root.querySelector('app-loans-page a[href="/registro"]')).not.toBeNull();
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    root.querySelector<HTMLButtonElement>('app-loans-page button')!.click();
    await fixture.whenStable();
    expect(root.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(router.url).toBe(url);
    expect(root.querySelector('nav a[href="/prestamos"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('presenta la sección con sesión restaurada y la retira ante un 401', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Pronto vas a poder');
    expect(root.querySelector('app-loans-page button')).toBeNull();
    // Recuperar el foco revalida la sesión compartida.
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Ingresá a tu cuenta');
    expect(router.url).toBe(url);
  });

  it('distingue una sesión no comprobada del visitante y permite reintentar', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Tu sesión todavía no está confirmada');
    expect(root.querySelector('app-loans-page button')).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    const retry = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Reintentar sesión'));
    retry!.click();
    http.expectOne('/api/auth/session').flush(session);
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Pronto vas a poder');
    expect(root.querySelector('p-message')).toBeNull();
  });
});
