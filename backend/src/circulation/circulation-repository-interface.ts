import type { BookOccupancy } from './circulation.js';

export interface CirculationRepositoryInterface {
  // Concilia y devuelve la ocupación de todos los libros en una transacción.
  findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]>;
}
