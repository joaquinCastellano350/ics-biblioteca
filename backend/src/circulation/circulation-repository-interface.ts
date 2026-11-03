import type { BookOccupancy } from './circulation.js';

export interface CirculationRepositoryInterface {
  // Ocupación para el catálogo; la implementación puede conciliar antes de leerla.
  // Para integrar cambios en una misma transacción, usar reconcileBooks(tx, ids).
  findOccupancy(bookIds: readonly string[]): Promise<readonly BookOccupancy[]>;
}
