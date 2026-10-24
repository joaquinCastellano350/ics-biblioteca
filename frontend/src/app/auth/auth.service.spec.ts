import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';

describe('estado compartido de autenticación', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  const response: AuthResponse = {
    user: { id: '1', firstName: 'Estudiante', lastName: 'Prueba', email: 'a@example.com', university: { id: '1', name: 'Universidad' } },
    session: { createdAt: '2026-10-22T12:00:00Z', expiresAt: '2026-10-22T18:00:00Z' },
    serverTime: '2026-10-22T12:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  it('una respuesta vieja no borra un login posterior', () => {
    auth.restore();
    const old = http.expectOne('/api/auth/session');
    auth.login('a@example.com', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush(response);
    old.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('authenticated');
    expect(auth.session()?.user.id).toBe('1');
  });

  it('retira los datos al vencer sin renovar ni depender de la hora local', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
    expect(auth.status()).toBe('authenticated');
    vi.advanceTimersByTime(1);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    expect(auth.loginRequested()).toBe(false);
  });

  it('acepta el login pendiente aunque venza la sesión anterior', () => {
    vi.useFakeTimers();
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...response, serverTime: '2026-10-22T17:59:59Z' });
    auth.openLogin();
    auth.login('a@example.com', 'clave').subscribe();
    const login = http.expectOne('/api/auth/login');

    vi.advanceTimersByTime(1000);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
    login.flush(response);

    expect(auth.session()).toEqual(response);
    expect(auth.status()).toBe('authenticated');
    expect(auth.loginRequested()).toBe(false);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('una revalidación pendiente no restaura una sesión que ya venció', () => {
    vi.useFakeTimers();
    auth.restore();
    const expiring = { ...response, serverTime: '2026-10-22T17:59:59Z' };
    http.expectOne('/api/auth/session').flush(expiring);
    window.dispatchEvent(new Event('focus'));
    const pending = http.expectOne('/api/auth/session');

    vi.advanceTimersByTime(1000);
    pending.flush(expiring);

    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('un fallo de infraestructura permite reintentar sin abrir otro diálogo', () => {
    auth.restore();
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.status()).toBe('unavailable');
    expect(auth.loginRequested()).toBe(false);
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
    expect(auth.status()).toBe('authenticated');
  });

  it('revalida al recuperar foco sin ocultar la cuenta ni duplicar consultas y retira una sesión rechazada', () => {
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('focus'));
    const pending = http.expectOne('/api/auth/session');
    const duringRequest = { status: auth.status(), session: auth.session() };
    pending.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(duringRequest.status).toBe('authenticated');
    expect(duringRequest.session).toEqual(response);
    expect(auth.status()).toBe('anonymous');
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(false);
  });

  it('un 503 al revalidar conserva la cuenta y no prolonga su vencimiento', () => {
    vi.useFakeTimers();
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    const afterFailure = { status: auth.status(), session: auth.session() };
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);

    expect(afterFailure.status).toBe('authenticated');
    expect(afterFailure.session).toEqual(response);
    expect(auth.status()).toBe('anonymous');
    expect(auth.session()).toBeNull();
  });
});
