import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';

describe('AuthService: cierre de sesión con HTTP simulado', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const response: AuthResponse = {
    user: { id: 'user', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid',
      university: { id: 'university', name: 'Universidad' } },
    session: { createdAt: '2026-10-24T12:00:00Z', expiresAt: '2026-10-24T18:00:00Z' },
    serverTime: '2026-10-24T12:00:00Z',
  };
  const registration = { firstName: 'Ana', lastName: 'Prueba', universityId: 'university',
    email: 'ana@example.invalid', password: 'clave' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function authenticate(): void {
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
  }

  it('envía POST protegido sin cuerpo, token ni Content-Type y solo confirma con 204', () => {
    authenticate();
    let confirmed = false;
    auth.logout().subscribe(() => { confirmed = true; });
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    expect(request.request.headers.has('Content-Type')).toBe(false);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('Cookie')).toBe(false);
    expect(request.request.body).toBeNull();
    expect(request.request.serializeBody()).toBeNull();
    expect(request.request.detectContentTypeHeader()).toBeNull();
    expect(request.request.params.keys()).toEqual([]);
    expect(auth.session()).toEqual(response);
    expect(auth.loggingOut()).toBe(true);
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(confirmed).toBe(true);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(auth.authenticating()).toBe(false);
    expect(auth.loggingOut()).toBe(false);
  });

  it('un 503 conserva la sesión y permite reintentar el cierre', () => {
    authenticate();
    const error = vi.fn();
    auth.logout().subscribe({ error });
    http.expectOne('/api/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalledOnce();
    expect(auth.session()).toEqual(response);
    expect(auth.status()).toBe('authenticated');
    expect(auth.authenticating()).toBe(false);
    expect(auth.loggingOut()).toBe(false);
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.status()).toBe('anonymous');
  });

  it('no interpreta un 200 inesperado como confirmación del cierre', () => {
    authenticate();
    const error = vi.fn();
    auth.logout().subscribe({ error });
    http.expectOne('/api/auth/logout').flush(null, { status: 200, statusText: 'OK' });
    expect(error).toHaveBeenCalledOnce();
    expect(auth.session()).toEqual(response);
    expect(auth.loggingOut()).toBe(false);
  });

  it('varias suscripciones pendientes producen una sola solicitud de logout', () => {
    authenticate();
    const logout = auth.logout();
    const next = vi.fn();
    logout.subscribe();
    logout.subscribe(next);
    auth.logout().subscribe(next);
    const request = http.expectOne('/api/auth/logout');
    expect(next).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.status()).toBe('anonymous');
  });

  for (const initial of [true, false]) {
    it(`cancela una restauración anterior e impide restaurar la sesión tras logout; inicial=${initial}`, () => {
      if (!initial) authenticate();
      auth.restore();
      const old = http.expectOne('/api/auth/session');
      auth.logout().subscribe();
      expect(old.cancelled).toBe(true);
      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      expect(() => old.flush(response)).toThrow();
      window.dispatchEvent(new Event('focus'));
      http.expectNone('/api/auth/session');
      expect(auth.status()).toBe('anonymous');
      expect(auth.session()).toBeNull();
    });
  }

  for (const operation of ['login', 'register'] as const) {
    it(`no superpone logout con ${operation} pendiente ni pierde el bloqueo compartido`, () => {
      authenticate();
      const pending = operation === 'login' ? auth.login(registration.email, registration.password) : auth.register(registration);
      pending.subscribe();
      const request = http.expectOne(`/api/auth/${operation}`);
      auth.logout().subscribe();
      http.expectNone('/api/auth/logout');
      expect(auth.authenticating()).toBe(true);
      expect(auth.loggingOut()).toBe(false);
      request.flush(response);
      auth.logout().subscribe();
      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      expect(auth.status()).toBe('anonymous');
    });
  }

  it('bloquea login, registro, restauración y acciones personales durante logout', () => {
    authenticate();
    auth.logout().subscribe();
    const request = http.expectOne('/api/auth/logout');
    auth.login(registration.email, registration.password).subscribe();
    auth.register(registration).subscribe();
    auth.restore();
    auth.openLogin();
    window.dispatchEvent(new Event('focus'));
    http.expectNone('/api/auth/login');
    http.expectNone('/api/auth/register');
    http.expectNone('/api/auth/session');
    expect(auth.loginRequested()).toBe(false);
    expect(auth.ensureAuthenticated()).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
    auth.login(registration.email, registration.password).subscribe();
    http.expectOne('/api/auth/login').flush(response);
    expect(auth.status()).toBe('authenticated');
  });

  it('limpia el temporizador anterior y los estados transitorios después del 204', () => {
    vi.useFakeTimers();
    authenticate();
    expect(vi.getTimerCount()).toBe(1);
    auth.openLogin();
    expect(auth.loginRequested()).toBe(true);
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(vi.getTimerCount()).toBe(0);
    expect(auth.loginRequested()).toBe(false);
    expect(auth.authenticating()).toBe(false);
    expect(auth.loggingOut()).toBe(false);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(auth.status()).toBe('anonymous');
  });

  it('un fallo de logout conserva el vencimiento original sin renovar la sesión', () => {
    vi.useFakeTimers();
    authenticate();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    auth.logout().subscribe({ error: () => {} });
    http.expectOne('/api/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.status()).toBe('authenticated');
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(auth.status()).toBe('anonymous');
    expect(auth.session()).toBeNull();
  });

  it('un error tras cancelar la restauración inicial permite reintentar sin quedar cargando', () => {
    auth.restore();
    const old = http.expectOne('/api/auth/session');
    auth.logout().subscribe({ error: () => {} });
    expect(old.cancelled).toBe(true);
    http.expectOne('/api/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.status()).toBe('unavailable');
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
    expect(auth.status()).toBe('authenticated');
  });
});
