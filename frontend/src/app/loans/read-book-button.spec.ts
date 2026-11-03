import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { providePrimeNG } from 'primeng/config';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';
import { ReadBookButton } from './read-book-button';

const session: AuthResponse = {
  user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'u', name: 'Universidad' } },
  session: { createdAt: '2026-10-27T12:00:00Z', expiresAt: '2026-10-27T18:00:00Z' },
  serverTime: '2026-10-27T12:00:00Z',
};

describe('lectura de un préstamo', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let fixture: ReturnType<typeof TestBed.createComponent<ReadBookButton>>;
  let tab: { opener: unknown; closed: boolean; close: ReturnType<typeof vi.fn>; location: { replace: ReturnType<typeof vi.fn> } };
  const endpoint = '/api/loans/11111111-1111-4111-8111-111111111111/read-access';
  const click = () => fixture.nativeElement.querySelector('button').click();

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ReadBookButton], providers: [
      provideHttpClient(), provideHttpClientTesting(), providePrimeNG({ unstyled: true }),
    ] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.restore();
    http.expectOne('/api/auth/session').flush(session);
    fixture = TestBed.createComponent(ReadBookButton);
    fixture.componentRef.setInput('loanId', '11111111-1111-4111-8111-111111111111');
    tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => { fixture.destroy(); http.verify(); vi.restoreAllMocks(); });

  it('abre una pestaña sin opener, solicita un acceso nuevo y evita doble clic', async () => {
    click(); click();
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    const request = http.expectOne(endpoint);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    request.flush({ url: 'https://assets.example.org/privado.pdf?firma=temporal', expiresAt: '2026-10-27T12:05:00Z' });
    await fixture.whenStable();
    expect(tab.location.replace).toHaveBeenCalledWith('https://assets.example.org/privado.pdf?firma=temporal');
    expect(tab.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('firma=');
    click();
    http.expectOne(endpoint).flush({}, { status: 404, statusText: 'Not Found' });
  });

  it('no pide acceso si se bloquean pestañas', async () => {
    vi.mocked(window.open).mockReturnValue(null);
    click(); await fixture.whenStable();
    http.expectNone(endpoint);
    expect(fixture.nativeElement.textContent).toContain('Permití abrir una pestaña');
  });

  it('informa vencimiento y cierra la pestaña provisional', async () => {
    click();
    http.expectOne(endpoint).flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(tab.close).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('ya no está vigente');
  });

  it('ante un 401 cierra la pestaña, pide login y no repite la lectura automáticamente', async () => {
    click();
    http.expectOne(endpoint).flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    expect(tab.close).toHaveBeenCalled();
    expect(auth.loginRequested()).toBe(true);
    auth.login('ana@example.org', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush(session);
    await fixture.whenStable();
    http.expectNone(endpoint);
  });

  it('descarta el acceso si cambia la cuenta mientras se obtiene la firma', () => {
    click();
    const reading = http.expectOne(endpoint);
    auth.login('otra@example.org', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush({ ...session, user: { ...session.user, id: 'otra' } });
    reading.flush({ url: 'https://assets.example.org/ajeno.pdf', expiresAt: '2026-10-27T12:05:00Z' });
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalled();
  });

  it('cancela y cierra la pestaña si se destruye el componente', () => {
    click();
    const request = http.expectOne(endpoint);
    fixture.destroy();
    expect(request.cancelled).toBe(true);
    expect(tab.close).toHaveBeenCalled();
  });

  it('no navega a protocolos ajenos al almacenamiento HTTPS', () => {
    click();
    http.expectOne(endpoint).flush({ url: 'javascript:alert(1)' });
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalled();
  });
});
