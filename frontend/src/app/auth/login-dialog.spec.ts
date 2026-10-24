import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { appConfig } from '../app.config';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';
import { LoginDialog } from './login-dialog';

@Component({
  imports: [LoginDialog],
  template: `
    <button type="button" (click)="auth.openLogin()">Abrir inicio de sesión</button>
    <app-login-dialog />
  `,
})
class DialogFixture {
  readonly auth = inject(AuthService);
}

describe('flujo del diálogo de inicio de sesión', () => {
  const authenticatedSession: AuthResponse = {
    user: {
      id: 'usuario', firstName: 'Estudiante', lastName: 'Prueba', email: 'estudiante@example.com',
      university: { id: 'universidad', name: 'Universidad' },
    },
    session: { createdAt: '2026-10-23T12:00:00Z', expiresAt: '2026-10-23T18:00:00Z' },
    serverTime: '2026-10-23T12:00:00Z',
  };
  let fixture: ComponentFixture<DialogFixture>;
  let http: HttpTestingController;
  let auth: AuthService;
  let root: HTMLElement;
  let opener: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogFixture],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    fixture = TestBed.createComponent(DialogFixture);
    root = fixture.nativeElement;
    auth.restore();
    http.expectOne('/api/auth/session').flush(
      { error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    opener = root.querySelector('button')!;
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  async function open() {
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  }

  async function close(method: 'Cancelar' | 'cruz' | 'Escape') {
    if (method === 'Cancelar') {
      Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cancelar')!.click();
    } else if (method === 'cruz') {
      root.querySelector<HTMLButtonElement>('button[aria-label="Cerrar inicio de sesión"]')!.click();
    } else {
      const password = root.querySelector<HTMLInputElement>('#login-password')!;
      password.focus();
      password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function submit() {
    const email = root.querySelector<HTMLInputElement>('#login-email')!;
    const password = root.querySelector<HTMLInputElement>('#login-password')!;
    email.value = 'estudiante@example.com';
    password.value = ' contraseña de prueba ';
    email.dispatchEvent(new Event('input'));
    password.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    return http.expectOne('/api/auth/login');
  }

  it('muestra credenciales incorrectas y mantiene el diálogo abierto para reintentar', async () => {
    await open();
    submit().flush(
      { error: { code: 'INVALID_CREDENTIALS' } }, { status: 401, statusText: 'Unauthorized' },
    );
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('El correo o la contraseña son incorrectos.');
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('#login-email')!.value).toBe('estudiante@example.com');
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(auth.status()).toBe('anonymous');
    expect(auth.session()).toBeNull();
  });

  it('muestra un error recuperable ante un fallo del servidor y permite completar un nuevo intento', async () => {
    await open();
    submit().flush(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'detalle interno del servidor' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('No pudimos iniciar sesión. Intentá nuevamente.');
    expect(root.textContent).not.toContain('detalle interno del servidor');
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(auth.status()).toBe('anonymous');
    const retry = submit();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    retry.flush(authenticatedSession);
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(auth.session()).toEqual(authenticatedSession);
  });

  it.each(['Cancelar', 'cruz', 'Escape'] as const)(
    'devuelve el foco al elemento que abrió el diálogo al cerrar con %s y limpia el formulario',
    async (method) => {
      await open();
      const password = root.querySelector<HTMLInputElement>('#login-password')!;
      password.value = 'contraseña que se debe descartar';
      password.dispatchEvent(new Event('input'));
      root.querySelector<HTMLButtonElement>('button[aria-label="Mostrar contraseña"]')!.click();
      fixture.detectChanges();
      expect(password.type).toBe('text');
      await close(method);
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      http.expectNone('/api/auth/login');
      await open();
      expect(root.querySelector<HTMLInputElement>('#login-password')!.value).toBe('');
      expect(root.querySelector<HTMLInputElement>('#login-password')!.type).toBe('password');
      expect(root.querySelector('.field-error')).toBeNull();
    },
  );

  it.each(['Cancelar', 'cruz', 'Escape'] as const)(
    'cancela el login pendiente al cerrar con %s y permite iniciar un nuevo intento al reabrir',
    async (method) => {
      await open();
      const pending = submit();
      expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      await close(method);
      expect(pending.cancelled).toBe(true);
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(auth.status()).toBe('anonymous');
      expect(auth.session()).toBeNull();
      await open();
      expect(root.querySelector<HTMLInputElement>('#login-password')!.value).toBe('');
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
      submit().flush(authenticatedSession);
      await fixture.whenStable();
      expect(auth.session()).toEqual(authenticatedSession);
      expect(root.querySelector('[role="dialog"]')).toBeNull();
    },
  );
});
