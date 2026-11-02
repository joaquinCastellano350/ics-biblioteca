import express from 'express';
import validator from 'validator';
import { requireSession } from '../accounts/accounts.controller.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { ReservationController } from './reservation-controller.js';
import type { ReservationFailure } from './reservation.js';

const failures: Record<ReservationFailure, { status: number; message: string }> = {
  RESERVATION_NOT_FOUND: { status: 404, message: 'El enlace no está disponible para esta cuenta. Ingresá con la cuenta que recibió el aviso.' },
  RESERVATION_EXPIRED: { status: 409, message: 'El plazo de tu reserva terminó. Podés consultar los cupos actuales desde el catálogo.' },
  RESERVATION_CANCELLED: { status: 409, message: 'Esta reserva ya no está disponible. El turno se dejó pasar o se canceló.' },
  RESERVATION_REJECTED_LIMIT: { status: 409, message: 'La reserva se canceló porque ya tenés cinco préstamos activos. Tu posición se retiró y el cupo se ofreció a la siguiente persona elegible, o quedó disponible.' },
};

export function reservationRoutes(accounts: AccountsService, controller: ReservationController) {
  const router = express.Router();
  router.post('/:reservationId/accept', requireSession(accounts), async (req, res) => {
    const reservationId = req.params.reservationId;
    if (typeof reservationId !== 'string' || !validator.isUUID(reservationId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'El enlace de reserva no es válido.' } });
      return;
    }
    const result = await controller.accept(res.locals.identity.userId, reservationId);
    if ('code' in result) {
      const failure = failures[result.code];
      res.status(failure.status).json({ error: { code: result.code, message: failure.message } });
      return;
    }
    res.status(result.created ? 201 : 200).json(result);
  });
  router.all('/:reservationId/accept', (_req, res) => {
    res.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Usá la página para aceptar la reserva.' } });
  });
  return router;
}
