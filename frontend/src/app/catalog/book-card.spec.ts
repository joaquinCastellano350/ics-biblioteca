import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';
import { BookCard } from './book-card';
import type { BookCirculationState } from '../loans/loan-query.service';

describe('BookCard: estado propio y acción accesible', () => {
  let fixture: ComponentFixture<BookCard>;
  const book = { id: 'book', title: 'Redes', authors: [], subjects: [], availability: { availableCopies: 1, totalCopies: 2 } };
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookCard], providers: [providePrimeNG({ unstyled: true })] });
    fixture = TestBed.createComponent(BookCard);
    fixture.componentRef.setInput('book', book);
    fixture.detectChanges();
  });
  function button(): HTMLButtonElement { return fixture.nativeElement.querySelector('button'); }

  it('permite solicitar un libro con cupos sin mostrar información privada al visitante', () => {
    const requested = vi.fn();
    fixture.componentInstance.requestLoan.subscribe(requested);
    expect(button().disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.personal-state')).toBeNull();
    button().click();
    expect(requested).toHaveBeenCalledExactlyOnceWith(book);
  });

  for (const label of ['Lo tenés prestado', 'En espera', 'Tu turno llegó', 'Tenés cinco préstamos activos']) {
    it(`presenta ${label} con PrimeNG y explica el botón deshabilitado`, () => {
      const personal: BookCirculationState = { label, detail: 'Detalle del estado propio', disabledReason: 'Motivo visible', checking: false };
      fixture.componentRef.setInput('personal', personal);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('p-tag')?.textContent).toContain(label);
      expect(button().disabled).toBe(true);
      const description = button().getAttribute('aria-describedby');
      expect(description).toBe('loan-reason-book');
      expect(fixture.nativeElement.querySelector(`#${description}`)?.textContent).toBe('Motivo visible');
      const requested = vi.fn();
      fixture.componentInstance.requestLoan.subscribe(requested);
      button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.componentInstance.request();
      expect(requested).not.toHaveBeenCalled();
    });
  }

  it('bloquea por una comprobación fallida con explicación ARIA y recupera la acción al retirarla', () => {
    const reason = 'No pudimos comprobar tus préstamos. Reintentá para continuar';
    const requested = vi.fn();
    fixture.componentInstance.requestLoan.subscribe(requested);
    fixture.componentRef.setInput('requestBlockReason', reason);
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    const description = button().getAttribute('aria-describedby');
    expect(description).toBe('loan-reason-book');
    expect(fixture.nativeElement.querySelector(`#${description}`)?.textContent).toBe(reason);
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.componentInstance.request();
    expect(requested).not.toHaveBeenCalled();
    fixture.componentRef.setInput('requestBlockReason', '');
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
    expect(button().hasAttribute('aria-describedby')).toBe(false);
    button().click();
    expect(requested).toHaveBeenCalledExactlyOnceWith(book);
  });

  it('cero cupos deshabilita solo la acción y conserva metadatos legibles', () => {
    fixture.componentRef.setInput('book', { ...book, availability: { availableCopies: 0, totalCopies: 2 } });
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('article').hasAttribute('aria-disabled')).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Sin cupos disponibles');
    expect(fixture.nativeElement.textContent).toContain('Redes');
  });

  it('la tarjeta grisada conserva un botón PrimeNG de cola independiente y enfocable', () => {
    const unavailable = { ...book, availability: { availableCopies: 0, totalCopies: 2 } };
    fixture.componentRef.setInput('book', unavailable); fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const queue = buttons[1]!;
    const queued = vi.fn(); const loan = vi.fn();
    fixture.componentInstance.joinQueue.subscribe(queued);
    fixture.componentInstance.requestLoan.subscribe(loan);
    expect(buttons[0]!.disabled).toBe(true); expect(queue.disabled).toBe(false);
    expect(queue.getAttribute('type')).toBe('button');
    expect(queue.getAttribute('aria-label')).toBe('Unirse a la cola de Redes');
    queue.focus(); expect(document.activeElement).toBe(queue);
    queue.click(); expect(queued).toHaveBeenCalledExactlyOnceWith(unavailable);
    expect(loan).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('p-button').length).toBe(2);
  });

  for (const label of ['Lo tenés prestado', 'En espera', 'Tu turno llegó', 'Tenés cinco préstamos activos', 'Conciliación pendiente', 'Comprobando tus préstamos']) {
    it(`bloquea también la cola y conserva el motivo ARIA para ${label}`, () => {
      fixture.componentRef.setInput('book', { ...book, availability: { availableCopies: 0, totalCopies: 2 } });
      fixture.componentRef.setInput('personal', { label, detail: '', disabledReason: 'Motivo de bloqueo', checking: label === 'Comprobando tus préstamos' });
      fixture.detectChanges();
      const queue = fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement;
      expect(queue.disabled).toBe(true);
      const id = queue.getAttribute('aria-describedby');
      expect(id).toBe('queue-reason-book');
      expect(fixture.nativeElement.querySelector(`#${id}`)?.textContent).toBe('Motivo de bloqueo');
      const queued = vi.fn(); fixture.componentInstance.joinQueue.subscribe(queued);
      queue.dispatchEvent(new MouseEvent('click', { bubbles: true })); fixture.componentInstance.requestQueue();
      expect(queued).not.toHaveBeenCalled();
    });
  }

  it('no ofrece cola con cupos y retira el bloqueo personal al volver a visitante', () => {
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    const queued = vi.fn(); fixture.componentInstance.joinQueue.subscribe(queued);
    fixture.componentInstance.requestQueue(); expect(queued).not.toHaveBeenCalled();
    fixture.componentRef.setInput('book', { ...book, availability: { availableCopies: 0, totalCopies: 2 } });
    fixture.componentRef.setInput('requestBlockReason', 'No pudimos comprobar tus préstamos.'); fixture.detectChanges();
    expect((fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(true);
    fixture.componentRef.setInput('requestBlockReason', ''); fixture.componentRef.setInput('personal', null); fixture.detectChanges();
    expect((fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('la comprobación muestra el spinner nativo de PrimeNG y bloquea el envío', () => {
    fixture.componentRef.setInput('personal', { label: 'Comprobando tus préstamos', detail: '', disabledReason: 'Comprobando tus préstamos', checking: true });
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    expect(button().querySelector('[data-p-icon="spinner"]')).not.toBeNull();
    fixture.componentRef.setInput('personal', null);
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.personal-state')).toBeNull();
  });
});
