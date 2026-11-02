import express from 'express';
import validator from 'validator';
import { requireSession } from '../accounts/accounts.controller.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { QueueCancellationFailure, QueueFailure, QueueRepositoryInterface } from './queue.js';

const failures: Record<QueueFailure, { status: number; message: string }> = {
  BOOK_NOT_FOUND: { status: 404, message: 'No encontramos este libro en el catálogo.' },
  BOOK_ALREADY_BORROWED: { status: 409, message: 'Ya tenés este libro prestado.' },
  LOAN_LIMIT_REACHED: { status: 409, message: 'Ya tenés cinco préstamos activos. Podrás entrar cuando venza alguno.' },
  AVAILABLE_COPIES: { status: 409, message: 'Hay cupos disponibles. Podés solicitar el préstamo.' },
  CIRCULATION_RECONCILIATION_REQUIRED: { status: 503, message: 'El estado de este libro necesita actualizarse. Intentá nuevamente más tarde.' },
};

const cancellationFailures: Record<QueueCancellationFailure, { status: number; message: string }> = {
  QUEUE_ENTRY_NOT_FOUND: { status: 404, message: 'No encontramos esa entrada de cola.' },
  QUEUE_ENTRY_FULFILLED: { status: 409, message: 'Esta entrada ya se utilizó para obtener un préstamo.' },
  CIRCULATION_RECONCILIATION_REQUIRED: failures.CIRCULATION_RECONCILIATION_REQUIRED,
};

export function queueRoutes(accounts: AccountsService, queue: QueueRepositoryInterface) {
  const router = express.Router();
  router.post('/:entryId/cancel', requireSession(accounts), async (req, res) => {
    const entryId = req.params['entryId'];
    // No necesita datos en el cuerpo: admite ausencia o {}. El middleware
    // compartido mantiene application/json para POST y rechaza JSON malformado.
    const body: unknown = req.body;
    const invalidBody = body !== undefined && (body === null || typeof body !== 'object'
      || Array.isArray(body) || Object.keys(body).length !== 0);
    if (typeof entryId !== 'string' || !validator.isUUID(entryId)
      || invalidBody) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enviá un identificador de entrada válido, sin propiedades adicionales.' } });
      return;
    }
    const result = await queue.cancelQueue(res.locals.identity.userId, entryId);
    if ('code' in result) {
      const failure = cancellationFailures[result.code];
      res.status(failure.status).json({ error: { code: result.code, message: failure.message } });
      return;
    }
    res.status(204).end();
  });
  // El montaje posterior a accountsController conserva su protección de escritura
  // y el parser JSON compartido, igual que POST /api/loans.
  router.post('/', requireSession(accounts), async (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !('bookId' in body)
      || typeof body.bookId !== 'string' || !validator.isUUID(body.bookId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enviá únicamente un identificador de libro válido.' } });
      return;
    }
    const result = await queue.joinQueue(res.locals.identity.userId, body.bookId);
    if ('code' in result) {
      const failure = failures[result.code];
      res.status(failure.status).json({ error: { code: result.code, message: failure.message } });
      return;
    }
    const entry = result.entry;
    res.status(result.created ? 201 : 200).json({ serverTime: result.serverTime.toISOString(), entry: {
      id: entry.id, book: { id: entry.book.id, title: entry.book.title }, state: entry.state,
      joinedAt: entry.joinedAt.toISOString(), position: entry.position,
    } });
  });
  return router;
}
