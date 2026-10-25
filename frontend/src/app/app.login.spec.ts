import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { AuthService } from './auth/auth.service';
import type { AuthResponse } from './auth/auth.types';

describe('integración de catálogo público y login', () => {
  it('restaura la sesión y permite ingresar sin recrear el catálogo ni cambiar la URL', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(
      { error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' },
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/catalogo?q=algebra');
    http.expectOne('/api/books').flush({ books: [{
      id: 'libro', title: 'Álgebra', authors: [{ id: 'autor', name: 'Autora' }], subjects: [],
    }] });
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const book = root.querySelector('article');
    expect(book?.textContent).toContain('Álgebra');
    const auth = TestBed.inject(AuthService);
    expect(auth.status()).toBe('anonymous');
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
    expect(auth.status()).toBe('authenticated');
    expect(root.querySelector('.account-name')?.textContent).toContain('Hola, Estudiante');
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector('article')).toBe(book);
    expect(router.url).toBe('/catalogo?q=algebra');
    http.expectNone('/api/books');
    http.verify();
    fixture.destroy();
  });
});
