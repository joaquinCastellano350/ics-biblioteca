import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import type { CatalogBook } from './catalog-book';
import { filterCatalogBooksByTitle, normalizeCatalogTitle } from './filter-catalog-books-by-title';

/** Búsqueda por título sobre los libros que entrega el catálogo. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-catalog-title-search',
  standalone: true,
  imports: [FormsModule, InputTextModule],
  styleUrl: './catalog-title-search.component.css',
  templateUrl: './catalog-title-search.component.html',
})
export class CatalogTitleSearchComponent implements OnChanges {
  @Input() books: readonly CatalogBook[] = [];
  @Output() readonly resultsChange = new EventEmitter<readonly CatalogBook[]>();

  protected titleQuery = '';
  protected filteredBooks: readonly CatalogBook[] = [];

  protected get showNoResults(): boolean {
    return normalizeCatalogTitle(this.titleQuery).length > 0 && this.filteredBooks.length === 0;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['books']) return;

    this.filteredBooks = filterCatalogBooksByTitle(this.books, this.titleQuery);
    this.publishResults();
  }

  onTitleQueryChange(title: string): void {
    this.titleQuery = title;
    this.filteredBooks = filterCatalogBooksByTitle(this.books, title);
    this.publishResults();
  }

  private publishResults(): void {
    this.resultsChange.emit(this.filteredBooks);
  }
}
