import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import type { AuthResponse, RegistrationRequest } from './auth.types';

describe('registro y login comparten la identidad y coordinan solicitudes', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const data: RegistrationRequest = {
    firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org', password: ' a ',
    universityId: '00000000-0000-4000-8000-000000000007',
  };
  const response: AuthResponse = {
    user: { id: 'nueva', firstName: data.firstName, lastName: data.lastName, email: data.email,
      university: { id: data.universityId, name: 'Facultad de prueba' } },
    session: { createdAt: '2026-10-23T12:00:00Z', expiresAt: '2026-10-23T18:00:00Z' },
    serverTime: '2026-10-23T12:00:00Z',
  };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('el registro autentica inmediatamente y envía solo los cinco campos sin transformar password', () => {
    auth.restore();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const cookies = vi.spyOn(Document.prototype, 'cookie', 'set');
    auth.register({ ...data, email: ' ANA@EXAMPLE.ORG ', role: 'no-enviar' } as RegistrationRequest).subscribe();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual(data);
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    request.flush(response, { status: 201, statusText: 'Created' });
    expect(auth.status()).toBe('authenticated'); expect(auth.session()).toEqual(response);
    expect(auth.ensureAuthenticated()).toBe(true);
    expect(storage).not.toHaveBeenCalled(); expect(cookies).not.toHaveBeenCalled();
    http.expectNone('/api/auth/session'); http.expectNone('/api/auth/login');
  });

  it('el registro reemplaza la cuenta y descarta una respuesta previa aunque sea un 401', () => {
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...response, user: { ...response.user, id: 'anterior' } });
    window.dispatchEvent(new Event('focus'));
    const old = http.expectOne('/api/auth/session');
    auth.register(data).subscribe();
    http.expectOne('/api/auth/register').flush(response);
    old.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.session()?.user.id).toBe('nueva'); expect(auth.status()).toBe('authenticated');
  });

  it('la restauración inicial pendiente no sobrescribe un registro nuevo', () => {
    auth.restore(); const old = http.expectOne('/api/auth/session');
    auth.register(data).subscribe(); http.expectOne('/api/auth/register').flush(response);
    old.flush({ ...response, user: { ...response.user, id: 'anterior' } });
    expect(auth.session()?.user.id).toBe('nueva');
  });

  it('el foco no inicia revalidaciones ni invalida un registro pendiente', () => {
    auth.restore(); http.expectOne('/api/auth/session').flush(response);
    auth.register(data).subscribe(); const request = http.expectOne('/api/auth/register');
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('focus'));
    auth.restore(); auth.openLogin();
    http.expectNone('/api/auth/session'); expect(auth.loginRequested()).toBe(false);
    expect(auth.ensureAuthenticated()).toBe(false);
    request.flush({ ...response, user: { ...response.user, id: 'otra' } });
    expect(auth.session()?.user.id).toBe('otra');
  });

  for (const first of ['register', 'login'] as const) {
    it(`evita otra mutación de autenticación mientras espera ${first}`, () => {
      const firstRequest = first === 'register' ? auth.register(data) : auth.login(data.email, data.password);
      firstRequest.subscribe(); const request = http.expectOne(`/api/auth/${first}`);
      const extra = vi.fn();
      (first === 'register' ? auth.login(data.email, data.password) : auth.register(data)).subscribe(extra);
      http.expectNone(`/api/auth/${first === 'register' ? 'login' : 'register'}`);
      expect(extra).not.toHaveBeenCalled(); expect(auth.authenticating()).toBe(true);
      request.flush(response); expect(auth.authenticating()).toBe(false);
    });
  }

  it('vencer la cuenta anterior no descarta el registro pendiente ni prolonga su sesión nueva', () => {
    vi.useFakeTimers();
    auth.restore(); http.expectOne('/api/auth/session').flush({ ...response, serverTime: '2026-10-23T17:59:59Z' });
    auth.register(data).subscribe(); const request = http.expectOne('/api/auth/register');
    vi.advanceTimersByTime(1000); expect(auth.session()).toBeNull();
    request.flush(response); expect(auth.status()).toBe('authenticated');
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1); expect(auth.status()).toBe('authenticated');
    vi.advanceTimersByTime(1); expect(auth.status()).toBe('anonymous');
  });

  for (const status of [400, 409, 500, 503]) {
    it(`HTTP ${status} de registro conserva la sesión anterior, libera el bloqueo y no reintenta`, () => {
      vi.useFakeTimers();
      auth.restore(); http.expectOne('/api/auth/session').flush(response);
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
      const error = vi.fn(); auth.register(data).subscribe({ error });
      http.expectOne('/api/auth/register').flush({}, { status, statusText: 'Error' });
      expect(error).toHaveBeenCalledOnce(); expect(auth.authenticating()).toBe(false);
      expect(auth.session()).toEqual(response); http.expectNone('/api/auth/register');
      vi.advanceTimersByTime(3 * 60 * 60 * 1000); expect(auth.session()).toBeNull();
    });
  }

  it('un fallo durante la restauración inicial deja un estado recuperable', () => {
    auth.restore(); const old = http.expectOne('/api/auth/session');
    auth.register(data).subscribe({ error: () => {} });
    http.expectOne('/api/auth/register').error(new ProgressEvent('error'));
    old.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('unavailable'); expect(auth.authenticating()).toBe(false);
    auth.restore(); http.expectOne('/api/auth/session').flush(response);
    expect(auth.status()).toBe('authenticated');
  });

  it('cancelar la suscripción aborta el POST y libera la coordinación', () => {
    const request = auth.register(data).subscribe();
    const pending = http.expectOne('/api/auth/register');
    request.unsubscribe(); expect(pending.cancelled).toBe(true); expect(auth.authenticating()).toBe(false);
    auth.login(data.email, data.password).subscribe(); http.expectOne('/api/auth/login').flush(response);
    expect(auth.status()).toBe('authenticated');
  });
});
