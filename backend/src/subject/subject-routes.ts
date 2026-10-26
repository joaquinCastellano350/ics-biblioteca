import { Router } from 'express';
import { SubjectController } from './subject-controller.js';

export function subjectRoutes(controller: SubjectController) {
  const router = Router();
  router.get('/', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response.json(await controller.findAll());
    } catch {
      response.status(503).json({
        error: {
          code: 'SUBJECTS_UNAVAILABLE',
          message: 'No pudimos cargar las materias. Intentá nuevamente.',
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
