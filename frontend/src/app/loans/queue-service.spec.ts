import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';
import { QueueService, type QueueResponse } from './queue-service';

const session: AuthResponse = {
  user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid', university: { id: 'uni', name: 'Universidad' } },
  session: { createdAt: '2026-10-29T12:00:00Z', expiresAt: '2026-10-29T18:00:00Z' }, serverTime: '2026-10-29T12:00:00Z',
};
const response: QueueResponse = { serverTime: session.serverTime,
  entry: { id: 'entry', book: { id: 'book', title: 'Redes' }, joinedAt: session.serverTime, state: 'WAITING', position: 2 } };

describe('QueueService: HTTP simulado', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let service: QueueService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    service = TestBed.inject(QueueService);
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); } });
  function authenticate(value = session) { auth.restore(); http.expectOne('/api/auth/session').flush(value); }

  for (const status of [201, 200]) {
    it(`envía solo bookId y el encabezado de protección; acepta ${status}`, () => {
      authenticate();
      const next = vi.fn();
      service.join('book').subscribe(next);
      const request = http.expectOne('/api/queue-entries');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ bookId: 'book' });
      expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
      expect(request.request.headers.has('Authorization')).toBe(false);
      expect(request.request.params.keys()).toEqual([]);
      request.flush(response, { status, statusText: status === 201 ? 'Created' : 'OK' });
      expect(next).toHaveBeenCalledExactlyOnceWith(response);
    });
  }

  it('conserva OFFERED y position null en lugar de inventar una posición nueva', () => {
    authenticate();
    const next = vi.fn();
    service.join('book').subscribe(next);
    const offered: QueueResponse = { ...response, entry: { ...response.entry, state: 'OFFERED', position: null } };
    http.expectOne('/api/queue-entries').flush(offered);
    expect(next).toHaveBeenCalledExactlyOnceWith(offered);
  });

  it('el visitante solicita login y no inscribe automáticamente después de autenticarse', () => {
    auth.restore(); http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    service.join('book').subscribe();
    expect(auth.loginRequested()).toBe(true);
    http.expectNone('/api/queue-entries');
    auth.login('ana@example.invalid', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush(session);
    http.expectNone('/api/queue-entries');
    service.join('book').subscribe();
    http.expectOne('/api/queue-entries').flush(response);
  });

  for (const status of [400, 409, 503, 500, 0]) {
    it(`propaga el error ${status} sin reintentar ni cerrar la sesión`, () => {
      authenticate();
      const error = vi.fn(); service.join('book').subscribe({ error });
      const request = http.expectOne('/api/queue-entries');
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status, statusText: 'Failure' });
      expect(error).toHaveBeenCalledOnce(); expect(auth.status()).toBe('authenticated');
      http.expectNone('/api/queue-entries');
    });
  }

  it('AUTH_REQUIRED retira la sesión y no repite la inscripción', () => {
    authenticate(); const next = vi.fn(); service.join('book').subscribe(next);
    http.expectOne('/api/queue-entries').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.session()).toBeNull(); expect(auth.loginRequested()).toBe(true);
    expect(next).not.toHaveBeenCalled(); http.expectNone('/api/queue-entries');
  });

  for (const change of ['logout', 'account']) {
    it(`descarta una respuesta de inscripción anterior al cambio de sesión: ${change}`, () => {
      authenticate(); const next = vi.fn(); service.join('book').subscribe(next);
      const old = http.expectOne('/api/queue-entries');
      if (change === 'logout') {
        auth.logout().subscribe(); http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      } else authenticate({ ...session, user: { ...session.user, id: 'bea' } });
      old.flush(response);
      expect(next).not.toHaveBeenCalled();
    });
  }
});
