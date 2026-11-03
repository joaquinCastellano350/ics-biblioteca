import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { providePrimeNG } from 'primeng/config';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';
import { LoanDialog } from './loan-dialog';
import { provideRouter } from '@angular/router';
import type { QueueResponse } from './queue-service';
import { signal } from '@angular/core';
import { LoanQueryService } from './loan-query.service';

const session: AuthResponse = {
  user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
  session: { createdAt: '2026-10-27T12:00:00Z', expiresAt: '2026-10-27T18:00:00Z' }, serverTime: '2026-10-27T12:00:00Z',
};
const book = { id: 'libro', title: 'Sistemas distribuidos', authors: [], subjects: [], availability: { availableCopies: 1, totalCopies: 1 } };
const loan = { id: 'prestamo', bookId: book.id, startedAt: '2026-10-27T12:00:00Z', dueAt: '2026-11-16T12:00:00Z' };

describe('confirmación de préstamo', () => {
  let fixture: ComponentFixture<LoanDialog>;
  let http: HttpTestingController;
  let auth: AuthService;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LoanDialog], providers: [
      providePrimeNG({ unstyled: true }), provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
    ] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.session.set(session);
    auth.status.set('authenticated');
    fixture = TestBed.createComponent(LoanDialog);
    fixture.componentRef.setInput('book', book);
    fixture.detectChanges();
  });
  afterEach(() => { try { http.verify(); } finally { fixture.destroy(); TestBed.resetTestingModule(); } });

  const queued: QueueResponse = { serverTime: session.serverTime, entry: { id: 'entry', book: { id: book.id, title: book.title },
    joinedAt: session.serverTime, state: 'WAITING', position: 3 } };
  function queueMode() { fixture.componentRef.setInput('mode', 'queue'); fixture.detectChanges(); }
  function button(label: string): HTMLButtonElement {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(element => element.textContent?.trim() === label)!;
  }

  it('no solicita al abrir; confirma una sola vez y presenta el vencimiento recibido', () => {
    const granted = vi.fn();
    fixture.componentInstance.granted.subscribe(granted);
    http.expectNone('/api/loans');
    expect(fixture.nativeElement.textContent).toContain('480 horas');
    fixture.componentInstance.confirm();
    fixture.componentInstance.confirm();
    const request = http.expectOne('/api/loans');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    expect(request.request.body).toEqual({ bookId: book.id });
    request.flush({ loan });
    fixture.detectChanges();
    expect(fixture.componentInstance.loan()).toEqual(loan);
    expect(fixture.nativeElement.textContent).toContain('noviembre');
    expect(fixture.nativeElement.querySelector('app-read-book-button')?.textContent).toContain('Empezar a leer');
    const tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    fixture.nativeElement.querySelector('app-read-book-button button').click();
    http.expectOne('/api/loans/prestamo/read-access').flush({ url: 'https://assets.example.org/pdf', expiresAt: loan.dueAt });
    expect(tab.location.replace).toHaveBeenCalledWith('https://assets.example.org/pdf');
    vi.restoreAllMocks();
    fixture.componentInstance.confirm();
    http.expectNone('/api/loans');
    expect(granted).toHaveBeenCalledExactlyOnceWith(loan);
  });
  it('no cierra durante la confirmación y permite reintentar un fallo recuperable', () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.confirm();
    fixture.componentInstance.close();
    expect(closed).not.toHaveBeenCalled();
    http.expectOne('/api/loans').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(fixture.componentInstance.pending()).toBe(false);
    expect(fixture.componentInstance.error()).toContain('no se creará un préstamo duplicado');
    fixture.componentInstance.confirm();
    http.expectOne('/api/loans').flush({ loan });
    fixture.componentInstance.close();
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it('ofrece cola ante el último cupo agotado sin repetir la concesión', () => {
    fixture.componentInstance.confirm();
    http.expectOne('/api/loans').flush({ error: { code: 'NO_AVAILABLE_COPIES' } }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Entrar en la cola');
    expect(fixture.nativeElement.textContent).toContain('último cupo');
    fixture.componentInstance.confirm();
    http.expectNone('/api/loans');
  });
  it('explica el límite y no expone mensajes internos del servidor', () => {
    const granted = vi.fn();
    fixture.componentInstance.granted.subscribe(granted);
    fixture.componentInstance.confirm();
    http.expectOne('/api/loans').flush({ error: { code: 'LOAN_LIMIT_REACHED', message: 'dato privado' } }, { status: 409, statusText: 'Conflict' });
    expect(fixture.componentInstance.error()).toContain('cinco préstamos activos');
    expect(fixture.componentInstance.error()).not.toContain('dato privado');
    expect(granted).not.toHaveBeenCalled();
  });
  it('al recibir AUTH_REQUIRED abre login y exige una nueva confirmación', () => {
    fixture.componentInstance.confirm();
    http.expectOne('/api/loans').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    expect(auth.loginRequested()).toBe(true);
    expect(fixture.componentInstance.loan()).toBeNull();
    http.expectNone('/api/loans');
  });
  it('cierra si la sesión desaparece mientras la solicitud está en vuelo', () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.confirm();
    const request = http.expectOne('/api/loans');
    auth.session.set(null);
    auth.status.set('anonymous');
    fixture.detectChanges();
    expect(closed).toHaveBeenCalled();
    // La identidad se invalida mediante el flujo real de AuthService.
    request.flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' });
    expect(fixture.componentInstance.loan()).toBeNull();
  });

  it('confirma cola con clic real, carga PrimeNG y un único POST; nunca llama a préstamo', () => {
    queueMode(); const changed = vi.fn(); const granted = vi.fn(); const closed = vi.fn();
    fixture.componentInstance.queued.subscribe(changed); fixture.componentInstance.granted.subscribe(granted);
    fixture.componentInstance.closed.subscribe(closed);
    http.expectNone('/api/queue-entries');
    button('Confirmar inscripción').click(); fixture.detectChanges();
    expect(button('Confirmando…').disabled).toBe(true);
    expect(button('Confirmando…').querySelector('[data-p-icon="spinner"]')).not.toBeNull();
    button('Confirmando…').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.componentInstance.confirmQueue(); fixture.componentInstance.confirm(); fixture.componentInstance.close();
    expect(closed).not.toHaveBeenCalled();
    const request = http.expectOne('/api/queue-entries'); expect(request.request.body).toEqual({ bookId: book.id });
    request.flush(queued, { status: 201, statusText: 'Created' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu posición actual es 3');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/prestamos');
    expect(changed).toHaveBeenCalledExactlyOnceWith(queued); expect(granted).not.toHaveBeenCalled();
    fixture.componentInstance.confirmQueue(); http.expectNone('/api/queue-entries'); http.expectNone('/api/loans');
    button('Listo').click(); expect(closed).toHaveBeenCalledOnce();
  });

  for (const state of ['WAITING', 'OFFERED'] as const) {
    it(`200 existente ${state} muestra el estado correcto sin prometer una inscripción nueva`, () => {
      queueMode(); fixture.componentInstance.confirmQueue();
      const result: QueueResponse = state === 'WAITING' ? queued
        : { ...queued, entry: { ...queued.entry, state: 'OFFERED', position: null } };
      http.expectOne('/api/queue-entries').flush(result, { status: 200, statusText: 'OK' }); fixture.detectChanges();
      if (state === 'WAITING') expect(fixture.nativeElement.textContent).toContain('Tu posición actual es 3');
      else {
        expect(fixture.nativeElement.textContent).toContain('turno ofrecido');
        expect(fixture.nativeElement.textContent).not.toContain('Tu posición actual');
        expect(fixture.nativeElement.textContent).not.toContain('reserva vigente');
      }
      fixture.componentInstance.confirmQueue(); http.expectNone('/api/queue-entries');
    });
  }

  it('el conflicto de préstamo pasa a una confirmación de cola sin inscribir automáticamente', () => {
    fixture.componentInstance.confirm();
    http.expectOne('/api/loans').flush({ error: { code: 'NO_AVAILABLE_COPIES' } }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges(); button('Entrar en la cola').click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no concede un préstamo');
    http.expectNone('/api/queue-entries'); http.expectNone('/api/loans');
    button('Confirmar inscripción').click();
    http.expectOne('/api/queue-entries').flush(queued);
  });

  for (const [code, text] of [
    ['BOOK_ALREADY_BORROWED', 'Ya tenés este libro prestado'], ['LOAN_LIMIT_REACHED', 'cinco préstamos activos'],
    ['AVAILABLE_COPIES', 'Ahora hay cupos disponibles'], ['BOOK_NOT_FOUND', 'no está disponible'],
    ['VALIDATION_ERROR', 'No pudimos identificar el libro'],
  ]) {
    it(`rechazo ${code} explica y no reenvía la inscripción`, () => {
      queueMode(); fixture.componentInstance.confirmQueue();
      http.expectOne('/api/queue-entries').flush({ error: { code, message: 'información interna' } }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges(); expect(fixture.nativeElement.querySelector('p-message')?.textContent).toContain(text);
      expect(fixture.nativeElement.textContent).not.toContain('información interna');
      expect(fixture.componentInstance.queueEntry()).toBeNull();
      fixture.componentInstance.confirmQueue(); http.expectNone('/api/queue-entries');
    });
  }

  for (const status of [503, 500, 0]) {
    it(`fallo temporal ${status} conserva confirmación y permite reintento manual`, () => {
      queueMode(); fixture.componentInstance.confirmQueue();
      const request = http.expectOne('/api/queue-entries');
      if (status === 0) request.error(new ProgressEvent('error'));
      else request.flush({ error: { code: status === 503 ? 'CIRCULATION_RECONCILIATION_REQUIRED' : 'INTERNAL_ERROR', message: 'privado' } }, { status, statusText: 'Failure' });
      fixture.detectChanges();
      expect(fixture.componentInstance.pending()).toBe(false); expect(fixture.componentInstance.queueEntry()).toBeNull();
      expect(fixture.nativeElement.querySelector('p-message')).not.toBeNull(); expect(fixture.nativeElement.textContent).not.toContain('privado');
      http.expectNone('/api/queue-entries');
      button('Reintentar inscripción').click(); http.expectOne('/api/queue-entries').flush(queued);
    });
  }

  for (const change of ['logout', 'account', 'same-user-new-session']) {
    it(`cancela cola pendiente y no muestra una respuesta anterior: ${change}`, () => {
      queueMode(); const closed = vi.fn(); const changed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed); fixture.componentInstance.queued.subscribe(changed);
      fixture.componentInstance.confirmQueue(); const request = http.expectOne('/api/queue-entries');
      if (change === 'logout') {
        auth.logout().subscribe(); http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      } else {
        auth.restore(); http.expectOne('/api/auth/session').flush(change === 'account'
          ? { ...session, user: { ...session.user, id: 'bea' } }
          : { ...session, session: { createdAt: '2026-10-27T12:01:00Z', expiresAt: '2026-10-27T18:01:00Z' } });
      }
      fixture.detectChanges(); expect(request.cancelled).toBe(true); expect(closed).toHaveBeenCalled();
      expect(() => request.flush(queued)).toThrow(); expect(changed).not.toHaveBeenCalled();
      expect(fixture.componentInstance.queueEntry()).toBeNull(); expect(fixture.componentInstance.pending()).toBe(false);
    });
  }

  it('retira el resultado privado al cerrar sesión y AUTH_REQUIRED no repite el POST', () => {
    queueMode(); fixture.componentInstance.confirmQueue(); http.expectOne('/api/queue-entries').flush(queued); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu posición actual es 3');
    auth.logout().subscribe(); http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' }); fixture.detectChanges();
    expect(fixture.componentInstance.queueEntry()).toBeNull(); expect(fixture.nativeElement.textContent).not.toContain('Tu posición actual es 3');
    http.expectNone('/api/queue-entries');
  });

  it('un 401 en cola solicita login y exige otra confirmación después de autenticar', () => {
    queueMode(); fixture.componentInstance.confirmQueue();
    http.expectOne('/api/queue-entries').flush({ error: { code: 'AUTH_REQUIRED' } }, { status: 401, statusText: 'Unauthorized' }); fixture.detectChanges();
    expect(auth.loginRequested()).toBe(true); expect(fixture.componentInstance.queueEntry()).toBeNull();
    auth.login('ana@example.org', 'clave').subscribe(); http.expectOne('/api/auth/login').flush(session); fixture.detectChanges();
    http.expectNone('/api/queue-entries');
  });
});

describe('recuperación de foco al cerrar el diálogo', () => {
  let fixture: ComponentFixture<LoanDialog>;
  let opener: HTMLButtonElement;
  let fallback: HTMLElement;
  const loading = signal(false);

  beforeEach(async () => {
    loading.set(false);
    await TestBed.configureTestingModule({ imports: [LoanDialog], providers: [
      providePrimeNG({ unstyled: true }), provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: LoanQueryService, useValue: { loading } },
    ] }).compileComponents();
    const auth = TestBed.inject(AuthService);
    auth.session.set(session); auth.status.set('authenticated');
    opener = document.createElement('button'); opener.textContent = 'Unirse a la cola';
    fallback = document.createElement('main'); fallback.id = 'main-content'; fallback.tabIndex = -1;
    document.body.append(opener, fallback);
    fixture = TestBed.createComponent(LoanDialog);
    opener.focus();
    fixture.componentRef.setInput('book', book);
    fixture.componentRef.setInput('mode', 'queue');
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    fixture.destroy(); opener.remove(); fallback.remove(); TestBed.resetTestingModule();
  });
  async function hide() {
    fixture.componentRef.setInput('book', null);
    fixture.detectChanges();
    fixture.componentInstance.restoreFocus();
    await fixture.whenStable();
  }

  it('devuelve el foco al control habilitado sin solicitudes adicionales', async () => {
    await hide();
    expect(document.activeElement).toBe(opener);
  });
  it('enfoca el destino estable durante la carga y recupera el botón después del render', async () => {
    opener.disabled = true; loading.set(true);
    await hide(); expect(document.activeElement).toBe(fallback);
    opener.disabled = false; loading.set(false);
    fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(opener);
  });
  for (const removed of [false, true]) {
    it(`conserva el destino estable cuando el botón queda ${removed ? 'eliminado' : 'deshabilitado'}`, async () => {
      opener.disabled = true; loading.set(true);
      await hide();
      if (removed) opener.remove();
      loading.set(false); fixture.detectChanges(); await fixture.whenStable();
      expect(document.activeElement).toBe(fallback);
    });
  }
  it('no roba el foco si el usuario lo mueve durante la actualización', async () => {
    opener.disabled = true; loading.set(true); await hide();
    const other = document.createElement('button'); document.body.append(other); other.focus();
    try {
      opener.disabled = false; loading.set(false); fixture.detectChanges(); await fixture.whenStable();
      expect(document.activeElement).toBe(other);
    } finally { other.remove(); }
  });
  it('cancela la recuperación si se abre otro diálogo', async () => {
    opener.disabled = true; loading.set(true); await hide();
    const auth = TestBed.inject(AuthService); auth.loginRequested.set(true);
    fixture.detectChanges(); await fixture.whenStable();
    opener.disabled = false; loading.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).not.toBe(opener);
  });
  it('no recupera un foco pendiente después de navegar', async () => {
    opener.disabled = true; loading.set(true); await hide();
    const url = document.location.href;
    try {
      history.replaceState(null, '', '#otra-pantalla');
      opener.disabled = false; loading.set(false); fixture.detectChanges(); await fixture.whenStable();
      expect(document.activeElement).toBe(fallback);
      fixture.componentInstance.restoreFocus();
      expect(document.activeElement).toBe(fallback);
    } finally { history.replaceState(null, '', url); }
  });
  it('no devuelve el foco al botón anterior si vuelve a abrirse el diálogo', async () => {
    opener.disabled = true; loading.set(true); await hide();
    fixture.componentRef.setInput('book', { ...book, id: 'otro' });
    fixture.detectChanges(); await fixture.whenStable();
    const currentFocus = document.activeElement;
    opener.disabled = false; loading.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(currentFocus);
    expect(document.activeElement).not.toBe(opener);
  });
  it('el cierre mediante Cancelar conserva el mismo ciclo y no envía una inscripción', async () => {
    fixture.componentInstance.closed.subscribe(() => fixture.componentRef.setInput('book', null));
    const cancel = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(element => element.textContent?.trim() === 'Cancelar')!;
    cancel.click(); fixture.detectChanges(); fixture.componentInstance.restoreFocus(); await fixture.whenStable();
    expect(fixture.componentInstance.book()).toBeNull();
    expect(document.activeElement).toBe(opener);
    TestBed.inject(HttpTestingController).expectNone('/api/queue-entries');
  });
});
