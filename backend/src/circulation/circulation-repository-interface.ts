import type { BookOccupancy } from './circulation.js';

export interface CirculationRepositoryInterface {
  // Consulta ocupación y persiste solo los rechazos por límite al llegar el turno.
  findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]>;
}
