import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';
import { CatalogReadingState } from './catalog-reading-state';

const session: AuthResponse = {
  user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'u', name: 'Universidad' } },
  session: { createdAt: '2026-10-28T12:00:00Z', expiresAt: '2026-10-28T18:00:00Z' }, serverTime: '2026-10-28T12:00:00Z',
};
const data = { ownerId: 'ana', serverTime: session.serverTime, loans: [{ id: 'prestamo', bookId: 'libro', dueAt: '2026-11-17T12:00:00Z' }] };

describe('lecturas propias del catálogo', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let state: CatalogReadingState;
  const settle = () => TestBed.tick();
  const login = () => { auth.restore(); http.expectOne('/api/auth/session').flush(session); settle(); };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), CatalogReadingState] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    state = TestBed.inject(CatalogReadingState);
    settle();
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  it('no consulta lecturas privadas para visitantes; carga al autenticar y conserva datos al refrescar', () => {
    http.expectNone('/api/loans/readable');
    login();
    expect(state.checking()).toBe(true);
    http.expectOne('/api/loans/readable').flush(data);
    expect(state.loans().get('libro')).toBe('prestamo');
    state.refresh(); settle();
    expect(state.loans().get('libro')).toBe('prestamo');
    http.expectOne('/api/loans/readable').flush(data);
  });

  it('cancela respuestas de la cuenta anterior y retira sus accesos inmediatamente', () => {
    login();
    const old = http.expectOne('/api/loans/readable');
    auth.login('bea@example.org', 'clave').subscribe();
    http.expectOne('/api/auth/login').flush({ ...session, user: { ...session.user, id: 'bea' } });
    settle();
    expect(old.cancelled).toBe(true);
    expect(state.loans().size).toBe(0);
    http.expectOne('/api/loans/readable').flush({ ...data, ownerId: 'bea', loans: [] });
    expect(state.loans().size).toBe(0);
  });

  it('rechaza una respuesta de otra identidad aunque la revalidación de sesión siga pendiente', () => {
    login();
    http.expectOne('/api/loans/readable').flush({ ...data, ownerId: 'bea' });
    expect(state.status()).toBe('error');
    expect(state.loans().size).toBe(0);
  });

  it('un error permite reintentar y un 401 elimina los accesos sin reintento automático', () => {
    login();
    http.expectOne('/api/loans/readable').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(state.status()).toBe('error');
    state.refresh(); settle();
    http.expectOne('/api/loans/readable').flush(data);
    state.refresh(); settle();
    http.expectOne('/api/loans/readable').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    settle();
    expect(state.loans().size).toBe(0);
    expect(auth.loginRequested()).toBe(true);
    http.expectNone('/api/loans/readable');
  });

  it('deja de mostrar la lectura al llegar el vencimiento sin consultar ni cerrar registros', () => {
    login();
    const start = performance.now();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(start);
    http.expectOne('/api/loans/readable').flush({ ...data, loans: [{ ...data.loans[0], dueAt: '2026-10-28T12:00:00.030Z' }] });
    settle();
    expect(state.loans().size).toBe(1);
    clock.mockReturnValue(start + 100);
    return new Promise<void>(resolve => setTimeout(() => {
      expect(state.loans().size).toBe(0);
      http.expectNone('/api/loans/readable');
      resolve();
    }, 50));
  });
});
