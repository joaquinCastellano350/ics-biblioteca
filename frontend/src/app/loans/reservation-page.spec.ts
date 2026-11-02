import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { App } from '../app';
import { routes } from '../app.routes';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';

const id = '11111111-1111-4111-8111-111111111111';
const endpoint = `/api/reservations/${id}/accept`;
const session: AuthResponse = {
  user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
  session: { createdAt: '2026-11-01T12:00:00Z', expiresAt: '2026-11-01T18:00:00Z' }, serverTime: '2026-11-01T12:00:00Z',
};
const result = { loan: { id: 'loan', bookId: 'book', startedAt: session.serverTime, dueAt: '2026-11-21T12:00:00Z' }, created: true, active: true };
const empty = { serverTime: session.serverTime, loans: [], waits: [], reservations: [],
  requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };

describe('SCRUM-26 enlace de aceptación', () => {
  let fixture: ComponentFixture<App>; let http: HttpTestingController; let router: Router; let root: HTMLElement;
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  const refresh = async () => { http.expectOne('/api/me/circulation').flush(empty); await settle(); };
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes), providePrimeNG({ unstyled: true }),
      provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController); router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App); root = fixture.nativeElement; fixture.detectChanges();
    await router.navigateByUrl(`/turno/${id}`); await settle();
  });
  afterEach(() => { try { http.verify(); } finally { fixture.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks(); } });

  it('acepta automáticamente con sesión, una sola vez, con protección de escritura y acceso a lectura', async () => {
    http.expectNone(endpoint);
    http.expectOne('/api/auth/session').flush(session); await settle();
    const request = http.expectOne(endpoint);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({});
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    const button = root.querySelector<HTMLButtonElement>('app-accept-reservation button')!;
    expect(button.disabled).toBe(true); button.click(); http.expectNone(endpoint);
    request.flush(result); await settle(); await refresh();
    expect(root.textContent).toContain('¡Tu préstamo está confirmado!');
    expect(root.querySelector('app-read-book-button')).not.toBeNull();
    TestBed.inject(AuthService).restore(); http.expectOne('/api/auth/session').flush(session); await settle();
    http.expectNone(endpoint);
  });

  it('sin sesión pide login y después continúa sin otro clic ni perder la reserva', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' }); await settle();
    const auth = TestBed.inject(AuthService);
    expect(auth.loginRequested()).toBe(true); expect(router.url).toBe(`/turno/${id}`); http.expectNone(endpoint);
    auth.cancelLogin(); await settle(); expect(auth.loginRequested()).toBe(false);
    auth.login('ana@example.org', 'fixture').subscribe(); http.expectOne('/api/auth/login').flush(session); await settle();
    http.expectOne(endpoint).flush(result); await settle(); await refresh();
    expect(root.textContent).toContain('¡Tu préstamo está confirmado!');
  });

  it('401 al aceptar retoma después del nuevo login, sin bucle de solicitudes', async () => {
    const auth = TestBed.inject(AuthService);
    http.expectOne('/api/auth/session').flush(session); await settle();
    http.expectOne(endpoint).flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' }); await settle();
    expect(auth.loginRequested()).toBe(true); http.expectNone(endpoint);
    auth.login('ana@example.org', 'fixture').subscribe();
    http.expectOne('/api/auth/login').flush({ ...session, session: { ...session.session, createdAt: '2026-11-01T12:01:00Z' } }); await settle();
    http.expectOne(endpoint).flush({ ...result, created: false }); await settle(); await refresh();
    expect(root.textContent).toContain('Este enlace ya fue utilizado.');
  });

  for (const [code, message, status] of [
    ['RESERVATION_NOT_FOUND', 'cuenta que recibió el aviso', 404],
    ['RESERVATION_EXPIRED', 'plazo de tu reserva terminó', 409],
    ['RESERVATION_CANCELLED', 'ya no está disponible', 409],
    ['RESERVATION_REJECTED_LIMIT', 'Tu posición se retiró', 409],
  ] as const) {
    it(`informa ${code} sin repetir ni mostrar un botón de lectura`, async () => {
      http.expectOne('/api/auth/session').flush(session); await settle();
      http.expectOne(endpoint).flush({ error: { code } }, { status, statusText: 'Denied' }); await settle(); await refresh();
      expect(root.textContent).toContain(message); expect(root.querySelector('app-read-book-button')).toBeNull(); http.expectNone(endpoint);
    });
  }

  it('resultado consumido y vencido informa el préstamo anterior sin lectura', async () => {
    http.expectOne('/api/auth/session').flush(session); await settle();
    http.expectOne(endpoint).flush({ ...result, created: false, active: false }); await settle(); await refresh();
    expect(root.textContent).toContain('El préstamo asociado ya terminó.');
    expect(root.querySelector('app-read-book-button')).toBeNull();
  });

  it('503 conserva la acción para reintentar explícitamente', async () => {
    http.expectOne('/api/auth/session').flush(session); await settle();
    http.expectOne(endpoint).flush({}, { status: 503, statusText: 'Unavailable' }); await settle();
    expect(root.textContent).toContain('Intentá nuevamente.'); http.expectNone(endpoint);
    root.querySelector<HTMLButtonElement>('app-accept-reservation button')!.click();
    http.expectOne(endpoint).flush(result); await settle(); await refresh();
  });

  it('descarta respuesta tardía de otra cuenta y limpia sus resultados', async () => {
    const auth = TestBed.inject(AuthService);
    http.expectOne('/api/auth/session').flush(session); await settle();
    const old = http.expectOne(endpoint);
    auth.restore(); http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea' } }); await settle();
    old.flush(result); await settle();
    expect(root.textContent).not.toContain('¡Tu préstamo está confirmado!');
    http.expectOne(endpoint).flush({ error: { code: 'RESERVATION_NOT_FOUND' } }, { status: 404, statusText: 'Not Found' }); await settle(); await refresh();
    expect(root.querySelector('app-read-book-button')).toBeNull();
  });

  it('salir de la página cancela la aceptación pendiente', async () => {
    http.expectOne('/api/auth/session').flush(session); await settle(); const pending = http.expectOne(endpoint);
    await router.navigateByUrl('/'); await settle(); expect(pending.cancelled).toBe(true);
  });
});
