import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.types';

describe('sesiones restauradas, suspensión y reautenticación pendiente', () => {
  const sixHours = 6 * 60 * 60 * 1000;
  const sevenHours = 7 * 60 * 60 * 1000;
  const session: AuthResponse = {
    user: { id: 'cuenta-a', firstName: 'Ana', lastName: 'Prueba', email: 'a@example.org',
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
    auth.restore();
    http.expectOne('/api/auth/session').flush(session);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const request = () => client.get('/api/private');
  const authRequired = { error: { code: 'AUTH_REQUIRED' } };

  for (const changedAccount of [true, false]) {
    for (const result of ['datos', '401', '503']) {
      it(`descarta ${result} anteriores a una sesión restaurada; cambia cuenta=${changedAccount}`, () => {
        const next = vi.fn();
        const error = vi.fn();
        auth.protectedRequest(request).subscribe({ next, error });
        const pending = http.expectOne('/api/private');
        window.dispatchEvent(new Event('focus'));
        const restored: AuthResponse = { ...session,
          user: changedAccount ? { ...session.user, id: 'cuenta-b', firstName: 'Bea' } : session.user,
          session: { createdAt: '2026-10-25T13:00:00Z', expiresAt: '2026-10-25T19:00:00Z' },
          serverTime: '2026-10-25T13:00:00Z',
        };
        http.expectOne('/api/auth/session').flush(restored);
        if (result === 'datos') pending.flush({ privateData: 'sesión anterior' });
        else pending.flush(authRequired, { status: Number(result), statusText: 'Error' });
        expect(auth.session()).toEqual(restored);
        expect(auth.loginRequested()).toBe(false);
        expect(next).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      });
    }
  }

  it('conserva una respuesta pendiente si la revalidación confirma la misma sesión', () => {
    const next = vi.fn();
    auth.protectedRequest(request).subscribe(next);
    const pending = http.expectOne('/api/private');
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush(session);
    pending.flush({ privateData: 'mis datos' });
    expect(next).toHaveBeenCalledExactlyOnceWith({ privateData: 'mis datos' });
  });

  for (const event of ['acción', 'foco', 'visibilidad']) {
    it(`retira una sesión vencida al recuperar ${event} si el reloj monótono se detuvo durante la suspensión`, () => {
      const monotonicTime = performance.now();
      vi.spyOn(performance, 'now').mockReturnValue(monotonicTime);
      // Cambiar el reloj de pared no ejecuta los temporizadores pendientes.
      vi.setSystemTime(Date.now() + sevenHours);
      if (event === 'acción') expect(auth.ensureAuthenticated()).toBe(false);
      else if (event === 'foco') window.dispatchEvent(new Event('focus'));
      else {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
      }
      for (const pending of http.match('/api/auth/session')) {
        pending.flush({}, { status: 503, statusText: 'Unavailable' });
      }
      expect(auth.session()).toBeNull();
      expect(auth.status()).toBe('anonymous');
      expect(auth.loginRequested()).toBe(event === 'acción');
    });
  }

  it('un reloj local que retrocede no amplía las seis horas', () => {
    vi.setSystemTime(Date.now() - sevenHours);
    vi.advanceTimersByTime(sixHours);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  it('al despertar antes del vencimiento ajusta el temporizador al tiempo restante aunque la red falle', () => {
    vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
    window.dispatchEvent(new Event('focus'));
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(auth.session()).toEqual(session);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 1);
    expect(auth.session()).toEqual(session);
    vi.advanceTimersByTime(1);
    expect(auth.session()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });

  for (const expiry of ['temporizador', 'revalidación']) {
    it(`un AUTH_REQUIRED posterior al vencimiento por ${expiry} abre login sin repetir la solicitud`, () => {
      vi.advanceTimersByTime(sixHours - 1);
      const next = vi.fn();
      auth.protectedRequest(request).subscribe(next);
      const pending = http.expectOne('/api/private');
      if (expiry === 'temporizador') vi.advanceTimersByTime(1);
      else {
        auth.restore();
        http.expectOne('/api/auth/session').flush(authRequired, { status: 401, statusText: 'Unauthorized' });
      }
      expect(auth.session()).toBeNull();
      expect(auth.loginRequested()).toBe(false);
      pending.flush(authRequired, { status: 401, statusText: 'Unauthorized' });
      expect(auth.loginRequested()).toBe(true);
      expect(next).not.toHaveBeenCalled();
      http.expectNone('/api/private');
    });
  }

  it('un AUTH_REQUIRED pendiente tras vencer y cerrar sesión no vuelve a abrir login', () => {
    auth.protectedRequest(request).subscribe();
    const pending = http.expectOne('/api/private');
    vi.advanceTimersByTime(sixHours);
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    pending.flush(authRequired, { status: 401, statusText: 'Unauthorized' });
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(false);
  });
});
