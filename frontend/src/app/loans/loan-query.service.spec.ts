import { TestBed } from '@angular/core/testing';
import { DestroyRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { LoanQueryService } from './loan-query.service';
import type { AuthResponse } from '../auth/auth.types';
import type { PersonalCirculation } from './loan-query.types';

describe('LoanQueryService: HTTP privado simulado', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let service: LoanQueryService;
  const session: AuthResponse = {
    user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.invalid', university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: '2026-10-28T12:00:00Z', expiresAt: '2026-10-28T18:00:00Z' }, serverTime: '2026-10-28T12:00:00Z',
  };
  const empty: PersonalCirculation = { serverTime: session.serverTime, loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    service = TestBed.inject(LoanQueryService);
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.useRealTimers(); } });
  function authenticate() { auth.restore(); http.expectOne('/api/auth/session').flush(session); }

  it('consulta GET sin titular, cuerpo, token ni Content-Type manuales y acepta listas vacías', () => {
    authenticate();
    const next = vi.fn();
    service.findMine().subscribe(next);
    const request = http.expectOne('/api/me/circulation');
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.has('Content-Type')).toBe(false);
    request.flush(empty);
    expect(next).toHaveBeenCalledExactlyOnceWith(empty);
  });
  it('sin sesión no consulta datos y abre el diálogo existente', () => {
    auth.restore();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    service.findMine().subscribe();
    http.expectNone('/api/me/circulation');
    expect(auth.loginRequested()).toBe(true);
  });
  it('AUTH_REQUIRED retira la sesión sin reintentar automáticamente', () => {
    authenticate();
    const next = vi.fn();
    service.findMine().subscribe(next);
    http.expectOne('/api/me/circulation').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.session()).toBeNull();
    expect(auth.loginRequested()).toBe(true);
    expect(next).not.toHaveBeenCalled();
    http.expectNone('/api/me/circulation');
  });
  it('un 503 conserva la sesión y propaga el fallo para reintentar', () => {
    authenticate();
    const error = vi.fn();
    service.findMine().subscribe({ error });
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalledOnce();
    expect(auth.status()).toBe('authenticated');
    service.findMine().subscribe();
    http.expectOne('/api/me/circulation').flush(empty);
  });
  it('descarta una respuesta anterior al logout confirmado', () => {
    authenticate();
    const next = vi.fn();
    service.findMine().subscribe(next);
    const old = http.expectOne('/api/me/circulation');
    auth.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    old.flush(empty);
    expect(next).not.toHaveBeenCalled();
  });
  it('descarta respuestas de una cuenta anterior', () => {
    authenticate();
    const next = vi.fn();
    service.findMine().subscribe(next);
    const old = http.expectOne('/api/me/circulation');
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea' } });
    old.flush(empty);
    expect(next).not.toHaveBeenCalled();
  });

  it('comparte una sola solicitud en curso entre consumidores', () => {
    authenticate();
    const a = vi.fn(); const b = vi.fn();
    service.findMine().subscribe(a);
    service.findMine().subscribe(b);
    http.expectOne('/api/me/circulation').flush(empty);
    expect(a).toHaveBeenCalledExactlyOnceWith(empty);
    expect(b).toHaveBeenCalledExactlyOnceWith(empty);
  });

  it('dos pantallas conectadas comparten la fotografía sin polling HTTP', () => {
    vi.useFakeTimers();
    authenticate();
    service.connect(TestBed.inject(DestroyRef));
    service.connect(TestBed.inject(DestroyRef));
    TestBed.tick();
    http.expectOne('/api/me/circulation').flush(empty);
    TestBed.tick();
    vi.advanceTimersByTime(3000);
    expect(service.data()).toEqual(empty);
    http.expectNone('/api/me/circulation');
  });

  it('invalidar cancela la consulta y una respuesta vieja no sustituye la nueva', () => {
    authenticate();
    service.findMine().subscribe();
    const old = http.expectOne('/api/me/circulation');
    service.invalidate();
    expect(old.cancelled).toBe(true);
    service.refresh();
    http.expectOne('/api/me/circulation').flush(empty);
    expect(() => old.flush(empty)).toThrow();
    expect(service.data()).toEqual(empty);
  });

  it('la información visible desaparece inmediatamente al cambiar de cuenta o cerrar sesión', () => {
    authenticate();
    service.findMine().subscribe();
    http.expectOne('/api/me/circulation').flush(empty);
    expect(service.data()).not.toBeNull();
    auth.session.set({ ...session, user: { ...session.user, id: 'bea' } });
    expect(service.data()).toBeNull();
    auth.session.set(null);
    auth.status.set('anonymous');
    expect(service.bookState('book')).toBeNull();
    expect(service.error()).toBe('');
  });

  it('una revalidación de la misma sesión no descarta ni vuelve a consultar la fotografía', () => {
    authenticate();
    service.connect(TestBed.inject(DestroyRef));
    TestBed.tick();
    http.expectOne('/api/me/circulation').flush(empty);
    auth.restore();
    http.expectOne('/api/auth/session').flush({ ...session, serverTime: '2026-10-28T12:01:00Z' });
    TestBed.tick();
    expect(service.data()).toEqual(empty);
    http.expectNone('/api/me/circulation');
  });

  it('al vencer un préstamo se retiran su estado y el bloqueo de cinco préstamos', () => {
    vi.useFakeTimers();
    authenticate();
    service.connect(TestBed.inject(DestroyRef));
    TestBed.tick();
    const loans = Array.from({ length: 5 }, (_, index) => ({ id: `loan-${index}`, book: { id: `book-${index}`, title: 'Libro' },
      startedAt: session.serverTime, dueAt: index === 0 ? '2026-10-28T12:00:01Z' : '2026-10-28T14:00:00Z' }));
    http.expectOne('/api/me/circulation').flush({ ...empty, loans,
      requestConstraints: { activeLoanCount: 5, maxActiveLoans: 5, openQueueBookIds: [] } });
    expect(service.bookState('book-0')?.label).toBe('Lo tenés prestado');
    expect(service.bookState('another')?.label).toBe('Tenés cinco préstamos activos');
    vi.advanceTimersByTime(1000);
    expect(service.loans().length).toBe(4);
    expect(service.bookState('book-0')).toBeNull();
    expect(service.bookState('another')).toBeNull();
    http.expectNone('/api/me/circulation');
  });

  it('reserva vigente tiene prioridad y al vencer conserva el bloqueo de la entrada abierta', () => {
    vi.useFakeTimers();
    authenticate();
    service.connect(TestBed.inject(DestroyRef));
    TestBed.tick();
    http.expectOne('/api/me/circulation').flush({ ...empty,
      waits: [{ id: 'wait', book: { id: 'waiting', title: 'Espera' }, joinedAt: session.serverTime, position: 2 }],
      reservations: [{ id: 'reserve', queueEntryId: 'entry', book: { id: 'reserved', title: 'Reserva' }, offeredAt: session.serverTime, expiresAt: '2026-10-28T12:00:01Z' }],
      requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: ['waiting', 'reserved', 'ambiguous'] } });
    expect(service.bookState('waiting')?.detail).toContain('2');
    expect(service.bookState('reserved')?.label).toBe('Tu turno llegó');
    expect(service.bookState('ambiguous')).toEqual({ label: 'Conciliación pendiente',
      detail: 'Tu entrada en cola sigue abierta. Actualizá para comprobar su estado',
      disabledReason: 'Tu entrada en cola sigue abierta. Actualizá para comprobar su estado', checking: false });
    vi.advanceTimersByTime(1000);
    expect(service.bookState('reserved')?.label).toBe('Conciliación pendiente');
    expect(service.bookState('waiting')?.label).toBe('En espera');
    service.refresh();
    http.expectOne('/api/me/circulation').flush({ ...empty, serverTime: '2026-10-28T12:00:02Z' });
    expect(service.bookState('reserved')).toBeNull();
    expect(service.bookState('ambiguous')).toBeNull();
  });

  it('una sesión nueva o anónima no hereda la conciliación pendiente de la anterior', () => {
    authenticate();
    service.refresh();
    http.expectOne('/api/me/circulation').flush({ ...empty,
      requestConstraints: { ...empty.requestConstraints, openQueueBookIds: ['offered'] } });
    expect(service.bookState('offered')?.label).toBe('Conciliación pendiente');
    auth.session.set({ ...session, user: { ...session.user, id: 'bea' } });
    expect(service.data()).toBeNull();
    expect(service.bookState('offered')?.label).toBe('Comprobando tus préstamos');
    service.refresh();
    http.expectOne('/api/me/circulation').flush(empty);
    expect(service.bookState('offered')).toBeNull();
    auth.session.set(null);
    auth.status.set('anonymous');
    expect(service.bookState('offered')).toBeNull();
    http.expectNone('/api/me/circulation');
  });

  it('un error no se interpreta como permiso ni como bloqueo privado permanente', () => {
    authenticate();
    service.refresh();
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.error()).toContain('No pudimos cargar');
    expect(service.data()).toBeNull();
    expect(service.bookState('book')).toBeNull();
    service.refresh();
    http.expectOne('/api/me/circulation').flush(empty);
    expect(service.error()).toBe('');
  });
});
