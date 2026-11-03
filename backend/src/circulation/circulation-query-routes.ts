import express from 'express';
import { requireSession } from '../accounts/accounts.controller.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { CirculationBook, CirculationQueryRepositoryInterface } from './circulation-query.js';

const publicBook = (book: CirculationBook) => ({ id: book.id, title: book.title });

export function circulationQueryRoutes(accounts: AccountsService, queries: CirculationQueryRepositoryInterface) {
  const router = express.Router();
  router.get('/me/circulation', requireSession(accounts), async (_req, res) => {
    const result = await queries.findPersonalCirculation(res.locals.identity.userId);
    // Lista explícita: no propagar campos internos añadidos por un adaptador.
    res.json({
      serverTime: result.serverTime.toISOString(),
      loans: result.loans.map(loan => ({
        id: loan.id, book: publicBook(loan.book), startedAt: loan.startedAt.toISOString(), dueAt: loan.dueAt.toISOString(),
      })),
      waits: result.waits.map(wait => ({
        id: wait.id, book: publicBook(wait.book), joinedAt: wait.joinedAt.toISOString(), position: wait.position,
      })),
      reservations: result.reservations.map(reservation => ({
        id: reservation.id, queueEntryId: reservation.queueEntryId, book: publicBook(reservation.book),
        offeredAt: reservation.offeredAt.toISOString(), expiresAt: reservation.expiresAt.toISOString(),
      })),
      requestConstraints: {
        activeLoanCount: result.requestConstraints.activeLoanCount,
        maxActiveLoans: result.requestConstraints.maxActiveLoans,
        openQueueBookIds: result.requestConstraints.openQueueBookIds,
      },
    });
  });
  return router;
}
