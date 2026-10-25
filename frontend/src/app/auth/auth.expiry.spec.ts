import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';

describe('SCRUM-11: vencimiento y solicitudes protegidas', () => {
  const sixHours = 6 * 60 * 60 * 1000;
  const session: AuthResponse = {
    user: { id: 'estudiante', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'universidad', name: 'Universidad' } },
    session: { createdAt: '2026-10-25T12:00:00Z', expiresAt: '2026-10-25T18:00:00Z' },
    serverTime: '2026-10-25T12:00:00Z',
  };
  let auth: AuthService;
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function restore(response = session): void {
    auth.restore();
    http.expectOne('/api/auth/session').flush(response);
  }
  const request = () => client.post('/api/test-action', {});
  const authRequired = { error: { code: 'AUTH_REQUIRED' } };

  it('la actividad y las revalidaciones no amplían las seis horas originales', () => {
    restore();
    vi.advanceTimersByTime(sixHours / 2);
    auth.protectedRequest(request).subscribe();
    http.expectOne('/api/test-action').flush({ ok: true });
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush({ ...session, serverTime: '2026-10-25T15:00:00Z' });
    vi.advanceTimersByTime(sixHours / 2 - 1);
    expect(auth.ensureAuthenticated()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(false);
    http.expectNone('/api/auth/session');
  });

  it('descuenta una respuesta demorada en lugar de empezar seis horas al recibirla', () => {
    auth.restore();
    const pending = http.expectOne('/api/auth/session');
    vi.advanceTimersByTime(5000);
    pending.flush(session);
    vi.advanceTimersByTime(sixHours - 5000);
    expect(auth.status()).toBe('anonymous');
    expect(auth.session()).toBeNull();
  });

  for (const event of ['acción', 'foco', 'visibilidad']) {
    it(`detecta el vencimiento con el temporizador suspendido al recuperar ${event}`, () => {
      restore();
      const now = performance.now();
      vi.spyOn(performance, 'now').mockReturnValue(now + sixHours);
      // El reloj avanzó, pero el navegador aún no ejecutó el callback del timeout.
      if (event === 'acción') expect(auth.ensureAuthenticated()).toBe(false);
      else if (event === 'foco') window.dispatchEvent(new Event('focus'));
      else {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
      }
      expect(auth.session()).toBeNull();
      expect(auth.status()).toBe('anonymous');
      expect(auth.loginRequested()).toBe(event === 'acción');
      http.expectNone('/api/auth/session');
    });
  }

  it('abre login y no envía ni repite la acción vencida; el segundo clic sí la envía', () => {
    restore();
    vi.advanceTimersByTime(sixHours);
    const next = vi.fn();
    auth.protectedRequest(request).subscribe(next);
    expect(auth.loginRequested()).toBe(true);
    http.expectNone('/api/test-action');
    auth.login('ana@example.org', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush({ ...session,
      session: { createdAt: '2026-10-25T18:00:00Z', expiresAt: '2026-10-26T00:00:00Z' },
      serverTime: '2026-10-25T18:00:00Z',
    });
    http.expectNone('/api/test-action');
    expect(next).not.toHaveBeenCalled();
    auth.protectedRequest(request).subscribe(next);
    http.expectOne('/api/test-action').flush({ ok: true });
    expect(next).toHaveBeenCalledExactlyOnceWith({ ok: true });
  });

  it('agrupa varios AUTH_REQUIRED en un único pedido de login y no los reintenta', () => {
    restore();
    const next = vi.fn();
    const error = vi.fn();
    auth.protectedRequest(request).subscribe({ next, error });
    auth.protectedRequest(request).subscribe({ next, error });
    const pending = http.match('/api/test-action');
    expect(pending).toHaveLength(2);
    for (const request of pending) request.flush(authRequired, { status: 401, statusText: 'Unauthorized' });
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    http.expectNone('/api/test-action');
  });

  for (const result of ['éxito', '401', '503']) {
    it(`descarta una respuesta privada vieja (${result}) después de un nuevo login`, () => {
      restore();
      const next = vi.fn();
      const error = vi.fn();
      auth.protectedRequest(request).subscribe({ next, error });
      const old = http.expectOne('/api/test-action');
      auth.login('otra@example.org', 'clave').subscribe();
      const other = { ...session, user: { ...session.user, id: 'otra-cuenta' } };
      http.expectOne('/api/auth/login').flush(other);
      if (result === 'éxito') old.flush({ privateData: 'cuenta anterior' });
      else old.flush(authRequired, { status: Number(result), statusText: 'Error' });
      expect(auth.session()).toEqual(other);
      expect(auth.loginRequested()).toBe(false);
      expect(next).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  }

  it('descarta datos privados pendientes al vencer y después de confirmar logout', () => {
    restore();
    const next = vi.fn();
    auth.protectedRequest(request).subscribe(next);
    const expired = http.expectOne('/api/test-action');
    vi.advanceTimersByTime(sixHours);
    expired.flush({ privateData: 'vencida' });
    expect(next).not.toHaveBeenCalled();
    restore();
    auth.protectedRequest(request).subscribe(next);
    const loggedOut = http.expectOne('/api/test-action');
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    loggedOut.flush({ privateData: 'cerrada' });
    expect(next).not.toHaveBeenCalled();
    expect(auth.session()).toBeNull();
  });

  it('descarta datos privados cuando una revalidación rechazó la sesión mientras estaban pendientes', () => {
    restore();
    const next = vi.fn();
    auth.protectedRequest(request).subscribe(next);
    const pending = http.expectOne('/api/test-action');
    auth.restore();
    http.expectOne('/api/auth/session').flush(authRequired, { status: 401, statusText: 'Unauthorized' });
    pending.flush({ privateData: 'sesión rechazada' });
    expect(next).not.toHaveBeenCalled();
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(false);
  });

  it('un 401 con otro código no se trata como vencimiento de la sesión', () => {
    restore();
    const error = vi.fn();
    auth.protectedRequest(request).subscribe({ error });
    http.expectOne('/api/test-action').flush({ error: { code: 'INVALID_CREDENTIALS' } }, {
      status: 401, statusText: 'Unauthorized',
    });
    expect(error).toHaveBeenCalledOnce();
    expect(auth.session()).toEqual(session);
    expect(auth.loginRequested()).toBe(false);
  });

  for (const status of [0, 403, 503]) {
    it(`un fallo ${status} se informa al llamador sin borrar la sesión ni abrir login`, () => {
      restore();
      const error = vi.fn();
      auth.protectedRequest(request).subscribe({ error });
      const pending = http.expectOne('/api/test-action');
      if (status === 0) pending.error(new ProgressEvent('error'));
      else pending.flush({}, { status, statusText: 'Error' });
      expect(error.mock.calls[0]?.[0]).toBeInstanceOf(HttpErrorResponse);
      expect(auth.session()).toEqual(session);
      expect(auth.loginRequested()).toBe(false);
    });
  }
});
