import { Router } from 'express';
import { BookController } from './book-controller.js';

export function bookRoutes(controller: BookController) {
  const router = Router();
  router.get('/', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response.json(await controller.findAll());
    } catch {
      // No exponer mensajes de Prisma, SQL o credenciales de Neon.
      response.status(503).json({
        error: {
          code: 'CATALOG_UNAVAILABLE',
          message: 'No pudimos cargar el catálogo. Intentá nuevamente.',
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
