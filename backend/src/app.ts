import express from 'express';
import { join } from 'node:path';
import type { BookRepositoryInterface } from './book/book-repository-interface.js';
import { BookController } from './book/book-controller.js';
import { bookRoutes } from './book/book-routes.js';

interface AppServices {
  checkDatabase: () => Promise<void>;
  checkStorage: () => Promise<void>;
  books?: BookRepositoryInterface;
  frontendDirectory?: string;
}

export function createApp(services: AppServices) {
  const app = express();
  app.disable('x-powered-by');

  if (services.books) {
    app.use('/api/books', bookRoutes(new BookController(services.books)));
  }

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/ready', async (_request, response) => {
    const [database, storage] = await Promise.allSettled([
      services.checkDatabase(),
      services.checkStorage(),
    ]);
    const ready = database.status === 'fulfilled' && storage.status === 'fulfilled';
    // No devolver errores de los proveedores: pueden contener credenciales.
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
      storage: storage.status === 'fulfilled' ? 'ok' : 'unavailable',
    });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' });
  });

  if (services.frontendDirectory) {
    const directory = services.frontendDirectory;
    app.use(express.static(directory));
    app.get('/{*path}', (_request, response) => {
      response.sendFile(join(directory, 'index.html'));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'NOT_FOUND' });
  });

  return app;
}
