import type { BookOccupancy } from './circulation.js';

export interface CirculationRepositoryInterface {
  // Una sola lectura coherente para todos los libros solicitados.
  findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]>;
}
