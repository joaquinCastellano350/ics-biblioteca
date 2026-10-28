import express from 'express';
import validator from 'validator';
import { requireSession } from '../accounts/accounts.controller.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { LoanFailure, LoanRepositoryInterface } from './loan.js';

const failures: Record<LoanFailure, { status: number; message: string }> = {
  BOOK_NOT_FOUND: { status: 404, message: 'No encontramos este libro en el catálogo.' },
  LOAN_LIMIT_REACHED: { status: 409, message: 'Ya tenés cinco préstamos activos. Podrás solicitar otro cuando venza alguno.' },
  OPEN_QUEUE_ENTRY: { status: 409, message: 'Ya estás esperando este libro o tenés un cupo reservado. Conservamos tu turno.' },
  NO_AVAILABLE_COPIES: { status: 409, message: 'El último cupo se ocupó mientras elegías. Podés esperar tu turno en la cola.' },
};

export function loanRoutes(accounts: AccountsService, loans: LoanRepositoryInterface) {
  const router = express.Router();
  router.post('/', requireSession(accounts), async (req, res) => {
    const bookId: unknown = req.body?.bookId;
    if (typeof bookId !== 'string' || !validator.isUUID(bookId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Seleccioná un libro válido.' } });
      return;
    }
    const result = await loans.requestLoan(res.locals.identity.userId, bookId);
    if ('code' in result) {
      const failure = failures[result.code];
      res.status(failure.status).json({ error: { code: result.code, message: failure.message } });
      return;
    }
    res.status(result.created ? 201 : 200).json({ loan: result.loan });
  });
  return router;
}
