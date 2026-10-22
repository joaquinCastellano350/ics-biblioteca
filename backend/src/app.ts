import express from 'express';
import type { University } from './modules/accounts/universities.repository.js';

interface AppServices {
  checkDatabase: () => Promise<void>;
  checkStorage: () => Promise<void>;
  listUniversities: () => Promise<University[]>;
}

export function createApp(services: AppServices) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/ready', async (_request, response) => {
    const [database, storage] = await Promise.allSettled([
      services.checkDatabase(), services.checkStorage(),
    ]);
    const ready = database.status === 'fulfilled' && storage.status === 'fulfilled';
    // No devolver errores de los proveedores: pueden contener credenciales.
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
      storage: storage.status === 'fulfilled' ? 'ok' : 'unavailable',
    });
  });

  app.get('/api/universities', async (_request, response) => {
    try {
      const universities = await services.listUniversities();
      response.json({ universities });
    } catch {
      response.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'No se pudieron consultar las facultades. Intentá nuevamente más tarde.',
        },
      });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' });
  });

  return app;
}
