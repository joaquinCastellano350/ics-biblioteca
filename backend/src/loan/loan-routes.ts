import { Router } from 'express';
import { requireSession } from '../accounts/accounts.controller.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { LoanController } from './loan-controller.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loanReadingRoutes(accounts: AccountsService, controller: LoanController) {
  const router = Router();
  router.get('/readable', requireSession(accounts), async (_request, response) => {
    try {
      const result = await controller.findReadable(response.locals['identity'].userId);
      response.json({
        ownerId: result.ownerId, serverTime: result.serverTime.toISOString(),
        loans: result.loans.map(({ id, bookId, dueAt }) => ({ id, bookId, dueAt: dueAt.toISOString() })),
      });
    } catch {
      response.status(503).json({ error: { code: 'READING_UNAVAILABLE', message: 'No pudimos comprobar tus lecturas. Intentá nuevamente.' } });
    }
  });
  router.post('/:loanId/read-access', requireSession(accounts), async (request, response) => {
    if (request.get('X-Biblioteca-Request') !== '1') {
      response.status(403).json({ error: { code: 'REQUEST_NOT_ALLOWED', message: 'La solicitud no está permitida.' } });
      return;
    }
    const loanId = request.params['loanId'];
    if (typeof loanId !== 'string' || !uuidPattern.test(loanId)) {
      response.status(400).json({ error: { code: 'INVALID_LOAN', message: 'El identificador del préstamo no es válido.' } });
      return;
    }
    try {
      const access = await controller.read(loanId, response.locals['identity'].userId);
      if (!access) {
        // No distinguir préstamo ajeno, inexistente, vencido o cerrado.
        response.status(404).json({ error: { code: 'LOAN_NOT_AVAILABLE', message: 'No tenés un préstamo vigente para esta lectura.' } });
        return;
      }
      response.json(access);
    } catch {
      response.status(503).json({ error: { code: 'READING_UNAVAILABLE', message: 'No pudimos abrir el PDF. Intentá nuevamente.' } });
    }
  });
  router.all('/:loanId/read-access', (_request, response) => {
    response.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });
  return router;
}
