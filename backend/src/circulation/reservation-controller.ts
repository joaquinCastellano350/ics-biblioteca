import type { ReservationRepositoryInterface } from './reservation.js';

export class ReservationController {
  constructor(private readonly reservations: ReservationRepositoryInterface) {}

  accept(userId: string, reservationId: string) {
    return this.reservations.acceptReservation(userId, reservationId);
  }
}
