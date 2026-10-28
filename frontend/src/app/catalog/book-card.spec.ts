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
