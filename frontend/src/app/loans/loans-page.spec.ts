import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { App } from '../app';
import { routes } from '../app.routes';
import type { AuthResponse } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import type { PersonalCirculation } from './loan-query.types';

const session: AuthResponse = {
  user: { id: 'usuario', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
    university: { id: 'facultad', name: 'Facultad' } },
  session: { createdAt: '2026-10-24T12:00:00Z', expiresAt: '2026-10-24T18:00:00Z' },
  serverTime: '2026-10-24T12:00:00Z',
};

const empty: PersonalCirculation = { serverTime: session.serverTime, loans: [], waits: [], reservations: [],
  requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
const circulation: PersonalCirculation = {
  ...empty,
  loans: [{ id: 'loan', book: { id: 'a', title: 'Álgebra privada' }, startedAt: '2026-10-24T11:00:00Z', dueAt: '2026-11-13T11:00:00Z' }],
  waits: [{ id: 'wait', book: { id: 'b', title: 'Redes en espera' }, joinedAt: session.serverTime, position: 3 }],
  reservations: [{ id: 'reserve', queueEntryId: 'offer', book: { id: 'c', title: 'Reserva de sistemas' },
    offeredAt: '2026-10-23T14:00:00Z', expiresAt: '2026-10-24T14:00:00Z' }],
  requestConstraints: { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: ['b', 'c'] },
};

describe('acceso a Mis préstamos', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let router: Router;
  let root: HTMLElement;
  const url = '/prestamos?estado=vigentes#contenido';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), providePrimeNG({ unstyled: true }),
        provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App);
    root = fixture.nativeElement;
    fixture.detectChanges();
    await router.navigateByUrl(url);
    await fixture.whenStable();
  });

  afterEach(() => {
    try { http.verify(); }
    finally { fixture.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks(); }
  });

  async function settle() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  async function load(data: PersonalCirculation = circulation) {
    await settle();
    http.expectOne('/api/me/circulation').flush(data);
    await settle();
  }
  function button(label: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('app-loans-page button'))
      .find(element => element.textContent?.trim() === label)!;
  }

  it('espera a comprobar la sesión sin mostrar la sección autenticada', () => {
    expect(root.querySelector('h1')?.textContent).toBe('Mis préstamos');
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    expect(root.querySelector('app-loans-page button')).toBeNull();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
  });

  it('permite abrir el único diálogo de login desde la pantalla sin perder la URL', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Ingresá a tu cuenta');
    expect(root.querySelector('app-loans-page a[href="/registro"]')).not.toBeNull();
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    root.querySelector<HTMLButtonElement>('app-loans-page button')!.click();
    await fixture.whenStable();
    expect(root.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(router.url).toBe(url);
    expect(root.querySelector('nav a[href="/prestamos"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('presenta la sección con sesión restaurada y la retira ante un 401', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Álgebra privada');
    // Recuperar el foco revalida la sesión compartida.
    window.dispatchEvent(new Event('focus'));
    const personalRefresh = http.expectOne('/api/me/circulation');
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(personalRefresh.cancelled).toBe(true);
    expect(root.textContent).not.toContain('Álgebra privada');
    expect(root.querySelector('app-loans-page')?.textContent).not.toContain('Pronto vas a poder');
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Ingresá a tu cuenta');
    expect(router.url).toBe(url);
  });

  it('distingue una sesión no comprobada del visitante y permite reintentar', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(root.querySelector('app-loans-page')?.textContent).toContain('Tu sesión todavía no está confirmada');
    expect(root.querySelector('app-loans-page button')).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    const retry = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Reintentar sesión'));
    retry!.click();
    http.expectOne('/api/auth/session').flush(session);
    await load(empty);
    expect(root.querySelector('app-loans-page')?.textContent).toContain('No tenés préstamos activos.');
    expect(root.querySelector('p-message')).toBeNull();
  });

  it('muestra carga, listas vacías y permite actualizar sin duplicar solicitudes', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await settle();
    expect(root.textContent).toContain('Cargando tus préstamos y esperas');
    const request = http.expectOne('/api/me/circulation');
    expect(button('Actualizar').disabled).toBe(true);
    button('Actualizar').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    http.expectNone('/api/me/circulation');
    request.flush(empty);
    await settle();
    for (const text of ['No tenés préstamos activos.', 'No estás esperando ningún libro.', 'No tenés reservas disponibles para aceptar.']) {
      expect(root.textContent).toContain(text);
    }
  });

  it('presenta préstamos con lectura y mantiene esperas y reservas sin acciones de otras historias', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load();
    expect(root.querySelector('.loan-card')?.textContent).toContain('Álgebra privada');
    expect(root.querySelector('.loan-card time')?.getAttribute('datetime')).toBe(circulation.loans[0].dueAt);
    expect(root.querySelector('.waiting-item')?.textContent).toContain('Redes en espera');
    expect(root.querySelector('.waiting-item strong')?.textContent).toBe('3');
    expect(root.querySelector('.reserve-row time')?.getAttribute('datetime')).toBe(circulation.reservations[0].expiresAt);
    expect(root.querySelector('.reserve-row .remaining')?.textContent).toMatch(/1 h 59 min|2 h 0 min/);
    expect(root.querySelector('.reserve-row p-tag')).not.toBeNull();
    expect(root.querySelector('.reserve-row button, .waiting-item button')).toBeNull();
    expect(root.querySelector('.loan-card app-read-book-button button')?.textContent).toContain('Leer online');
  });

  it('abre el PDF del préstamo seleccionado y actualiza la lista si ya no está vigente', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load();
    const tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    root.querySelector<HTMLButtonElement>('.loan-card app-read-book-button button')!.click();
    http.expectOne('/api/loans/loan/read-access').flush({ url: 'https://assets.example.org/lectura.pdf', expiresAt: '2026-10-24T12:05:00Z' });
    expect(tab.location.replace).toHaveBeenCalledWith('https://assets.example.org/lectura.pdf');
    expect(tab.opener).toBeNull();
    await settle();
    root.querySelector<HTMLButtonElement>('.loan-card app-read-book-button button')!.click();
    http.expectOne('/api/loans/loan/read-access').flush({ error: { code: 'LOAN_NOT_AVAILABLE' } }, { status: 404, statusText: 'Not Found' });
    await load(empty);
    expect(root.querySelector('.loan-card')).toBeNull();
    expect(root.querySelector('app-read-book-button')).toBeNull();
    expect(tab.close).toHaveBeenCalled();
  });

  it('un reloj local desfasado no cambia los plazos calculados desde serverTime', async () => {
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();
    // El desfase debe existir antes de pedir la sesión, no simular un salto
    // de catorce años durante la propia restauración de autenticación.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2040-01-01T00:00:00Z'));
    TestBed.inject(AuthService).restore();
    http.expectOne('/api/auth/session').flush(session);
    await load();
    expect(root.querySelector('.reserve-row .remaining')?.textContent).toMatch(/1 h 59 min|2 h 0 min/);
    expect(root.querySelectorAll('.loan-card').length).toBe(1);
  });

  it('no presenta préstamos vencidos ni reservas cuyo plazo ya terminó', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load({ ...circulation,
      loans: [...circulation.loans, { ...circulation.loans[0], id: 'expired', book: { id: 'x', title: 'Préstamo vencido' }, dueAt: session.serverTime }],
      reservations: [...circulation.reservations, { ...circulation.reservations[0], id: 'expired', book: { id: 'x', title: 'Oferta vencida' }, expiresAt: session.serverTime }],
    });
    expect(root.textContent).not.toContain('Préstamo vencido');
    expect(root.textContent).not.toContain('Oferta vencida');
    expect(root.querySelectorAll('.loan-card').length).toBe(1);
  });

  it('presenta el error HTTP y permite reintentar realmente', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await settle();
    http.expectOne('/api/me/circulation').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(root.querySelector('app-loans-page p-message')?.textContent).toContain('No pudimos cargar');
    button('Reintentar').click();
    await load();
    expect(root.querySelector('app-loans-page p-message')).toBeNull();
    expect(root.textContent).toContain('Álgebra privada');
  });

  it('retira datos privados al cerrar sesión sin perder la ruta', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load();
    TestBed.inject(AuthService).logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    for (const text of ['Álgebra privada', 'Redes en espera', 'Reserva de sistemas']) expect(root.textContent).not.toContain(text);
    expect(root.textContent).toContain('Ingresá a tu cuenta');
    expect(router.url).toBe(url);
  });

  it('un cambio de usuario limpia los datos antes de recibir la nueva respuesta', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await load();
    TestBed.inject(AuthService).restore();
    http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea', firstName: 'Bea' } });
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Álgebra privada');
    await load(empty);
    expect(root.textContent).not.toContain('Redes en espera');
  });

  it('cancela la consulta de la cuenta anterior y rechaza su respuesta tardía', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await settle();
    const old = http.expectOne('/api/me/circulation');
    TestBed.inject(AuthService).restore();
    http.expectOne('/api/auth/session').flush({ ...session, user: { ...session.user, id: 'bea' } });
    await settle();
    expect(old.cancelled).toBe(true);
    expect(() => old.flush(circulation)).toThrow();
    await load(empty);
    expect(root.textContent).not.toContain('Álgebra privada');
  });

  it('AUTH_REQUIRED vuelve a pedir autenticación sin repetir la consulta', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await settle();
    http.expectOne('/api/me/circulation').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    expect(TestBed.inject(AuthService).session()).toBeNull();
    expect(TestBed.inject(AuthService).loginRequested()).toBe(true);
    expect(root.querySelector('app-loans-page article')).toBeNull();
    http.expectNone('/api/me/circulation');
  });

  it('cancela una consulta pendiente al salir de la página', async () => {
    http.expectOne('/api/auth/session').flush(session);
    await settle();
    const pending = http.expectOne('/api/me/circulation');
    await router.navigateByUrl('/');
    await settle();
    expect(pending.cancelled).toBe(true);
  });
});
