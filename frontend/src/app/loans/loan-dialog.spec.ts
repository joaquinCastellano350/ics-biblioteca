import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { providePrimeNG } from 'primeng/config';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import type { AuthResponse } from '../auth/auth.types';
import { LoanDialog } from './loan-dialog';

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
      providePrimeNG({ unstyled: true }), provideHttpClient(), provideHttpClientTesting(),
    ] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.session.set(session);
    auth.status.set('authenticated');
    fixture = TestBed.createComponent(LoanDialog);
    fixture.componentRef.setInput('book', book);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

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
});
