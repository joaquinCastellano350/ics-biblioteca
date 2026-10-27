import { Router } from 'express';
import { BookController } from './book-controller.js';

export function authorRoutes(controller: BookController) {
  const router = Router();
  router.get('/', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const query = typeof request.query['q'] === 'string' ? request.query['q'] : undefined;
      response.json(await controller.findAuthors(query));
    } catch {
      response.status(503).json({
        error: {
          code: 'CATALOG_UNAVAILABLE',
          message: 'No pudimos cargar los autores. Intentá nuevamente.',
        },
      });
    }
  });
  router.all('/', (_request, response) => {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });
  return router;
}
