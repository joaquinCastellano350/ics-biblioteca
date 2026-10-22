import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CatalogBook } from './catalog-book';
import { CatalogTitleSearchComponent } from './catalog-title-search.component';

describe('CatalogTitleSearchComponent', () => {
  let fixture: ComponentFixture<CatalogTitleSearchComponent>;
  let component: CatalogTitleSearchComponent;
  let emittedResults: (readonly CatalogBook[])[];

  const books: CatalogBook[] = [
    { id: 'book-1', title: 'La búsqueda del tiempo perdido', authors: [], subjects: [] },
    { id: 'book-2', title: 'Introducción a la programación', authors: [], subjects: [] },
    { id: 'book-3', title: 'Historia de la ciencia', authors: [], subjects: [] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CatalogTitleSearchComponent] }).compileComponents();
    fixture = TestBed.createComponent(CatalogTitleSearchComponent);
    component = fixture.componentInstance;
    emittedResults = [];
    component.resultsChange.subscribe((value) => emittedResults.push(value));
    fixture.componentRef.setInput('books', books);
    fixture.detectChanges();
  });

  it('emite los resultados iniciales al recibir la lista por primera vez', () => {
    expect(emittedResults).toHaveLength(1);
    expect(emittedResults[0]).toEqual(books);
  });

  it('emite resultados recalculados cuando cambia la lista de entrada', () => {
    component.onTitleQueryChange('historia');
    const updatedBooks = [books[0], books[2]];
    fixture.componentRef.setInput('books', updatedBooks);
    fixture.detectChanges();

    expect(emittedResults.at(-1)?.map((book) => book.id)).toEqual(['book-3']);
  });

  it('actualiza por coincidencia parcial mientras se escribe y busca solo en el título', () => {
    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    input.value = 'búsqueda del tiempo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(emittedResults.at(-1)?.map((book) => book.id)).toEqual(['book-1']);

    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(emittedResults.at(-1)).toEqual([]);
  });

  it('ignora mayúsculas y tildes', () => {
    component.onTitleQueryChange('INTRODUCCION A LA PROGRAMACION');

    expect(emittedResults.at(-1)?.map((book) => book.id)).toEqual(['book-2']);
  });

  it('al borrar la consulta devuelve completa la lista de entrada actual', () => {
    const sourceBooks = [books[2]];
    fixture.componentRef.setInput('books', sourceBooks);
    fixture.detectChanges();
    component.onTitleQueryChange('sin coincidencias');
    component.onTitleQueryChange('');

    expect(emittedResults.at(-1)).toEqual(sourceBooks);
  });

  it('muestra «Sin resultados» solo cuando hay una búsqueda sin coincidencias', () => {
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();

    component.onTitleQueryChange('título inexistente');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent.trim()).toBe('Sin resultados');

    const input = fixture.nativeElement.querySelector('#catalog-title-search') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
});
