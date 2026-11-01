import type { GrantedLoan } from './loan.js';

export type ReservationFailure = 'RESERVATION_NOT_FOUND' | 'RESERVATION_EXPIRED'
  | 'RESERVATION_CANCELLED' | 'RESERVATION_REJECTED_LIMIT';
export type ReservationResult = { readonly loan: GrantedLoan; readonly created: boolean; readonly active: boolean }
  | { readonly code: ReservationFailure };

export interface ReservationRepositoryInterface {
  acceptReservation(userId: string, reservationId: string): Promise<ReservationResult>;
}
