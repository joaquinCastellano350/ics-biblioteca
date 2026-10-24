import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RegistrationService } from './registration.service';
import type { RegistrationRequest, RegistrationResponse } from './registration.types';

describe('RegistrationService', () => {
  let service: RegistrationService;
  let http: HttpTestingController;
  const data: RegistrationRequest = {
    firstName: 'Ana', lastName: 'Pérez', universityId: '00000000-0000-4000-8000-000000000007',
    email: 'ana@example.org', password: ' a ',
  };
  const response: RegistrationResponse = {
    user: {
      id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Pérez',
      email: data.email, university: { id: data.universityId, name: 'Facultad Regional Córdoba (Córdoba)' },
    },
    session: { createdAt: '2026-10-22T12:00:00.000Z', expiresAt: '2026-10-22T18:00:00.000Z' },
    serverTime: '2026-10-22T12:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(RegistrationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  it('envía solo los cinco campos mediante POST relativo y el encabezado requerido', () => {
    const received = vi.fn();
    const extraData = { ...data, token: 'no-enviar', role: 'no-enviar' };
    service.register(extraData).subscribe(received);
    const request = http.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    expect(request.request.body).toEqual(data);
    expect(Object.keys(request.request.body).sort()).toEqual(Object.keys(data).sort());
    request.flush(response, { status: 201, statusText: 'Created' });
    expect(received).toHaveBeenCalledExactlyOnceWith(response);
  });

  it('conserva la contraseña exactamente y no guarda datos en Storage ni crea cookies JavaScript', () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const cookieWrite = vi.spyOn(Document.prototype, 'cookie', 'set');
    service.register(data).subscribe();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body.password).toBe(' a ');
    request.flush(response, { status: 201, statusText: 'Created' });
    expect(storageWrite).not.toHaveBeenCalled();
    expect(cookieWrite).not.toHaveBeenCalled();
  });

  for (const status of [400, 409, 500, 503]) {
    it(`propaga HTTP ${status} sin reintentar automáticamente`, () => {
      const failed = vi.fn();
      service.register(data).subscribe({ error: failed });
      http.expectOne('/api/auth/register').flush({ error: { code: 'ERROR' } }, { status, statusText: 'Error' });
      expect(failed).toHaveBeenCalledOnce();
      expect(failed.mock.calls[0][0].status).toBe(status);
      http.expectNone('/api/auth/register');
    });
  }

  it('propaga errores de conexión sin reintentar el POST', () => {
    const failed = vi.fn();
    service.register(data).subscribe({ error: failed });
    http.expectOne('/api/auth/register').error(new ProgressEvent('error'));
    expect(failed.mock.calls[0][0].status).toBe(0);
    http.expectNone('/api/auth/register');
  });
});
