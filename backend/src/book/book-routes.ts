import { Router } from 'express';
import { BookController } from './book-controller.js';
import { CATALOG_PAGE_SIZE } from './book-repository.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function repeatedQueryValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function bookRoutes(controller: BookController) {
  const router = Router();
  router.get('/', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const title = typeof request.query['title'] === 'string' ? request.query['title'] : undefined;
      const authorIds = repeatedQueryValues(request.query['authorIds']);
      const subjectIds = repeatedQueryValues(request.query['subjectIds']);
      const rawPage = request.query['page'] === undefined ? '1' : request.query['page'];
      const page = typeof rawPage === 'string' && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : NaN;
      if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * CATALOG_PAGE_SIZE)) {
        response.status(400).json({ error: { code: 'INVALID_QUERY' } });
        return;
      }
      if (subjectIds.some((id) => !uuidPattern.test(id))) {
        response.status(400).json({ error: { code: 'INVALID_QUERY' } });
        return;
      }
      response.json(await controller.findAll({
        ...(title === undefined ? {} : { title }),
        ...(authorIds.length ? { authorIds } : {}),
        ...(subjectIds.length ? { subjectIds } : {}),
        page,
      }));
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
