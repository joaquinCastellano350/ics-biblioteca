import type { BookAvailability } from './circulation.js';
import type { CirculationRepositoryInterface } from './circulation-repository-interface.js';

export class CirculationController {
  constructor(private readonly circulation: CirculationRepositoryInterface) {}

  async findAvailability(bookIds: readonly string[]): Promise<readonly BookAvailability[]> {
    const occupancy = await this.circulation.findOccupancy(bookIds);
    return occupancy.map(({ bookId, totalCopies, activeLoans, heldReservations, eligibleWaiters }) => ({
      bookId,
      totalCopies,
      // La conciliación ya asignó los cupos a reservas persistidas.
      availableCopies: Math.max(0, totalCopies - activeLoans - heldReservations - eligibleWaiters),
    }));
  }
}
