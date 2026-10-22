import express from 'express';
import { join } from 'node:path';
import { accountErrorHandler, accountsController } from './accounts/accounts.controller.js';
import type { AccountsService } from './accounts/accounts.service.js';

interface AppServices {
  checkDatabase: () => Promise<void>;
  checkStorage: () => Promise<void>;
  accounts?: AccountsService;
  production?: boolean;
  frontendPath?: string;
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

  if (services.accounts) app.use('/api', accountsController(services.accounts, services.production ?? false));
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No se encontró el recurso.' } });
  });

  if (services.frontendPath) {
    app.use(express.static(services.frontendPath));
    app.get('/{*path}', (request, response, next) => {
      if (!request.accepts('html')) return next();
      response.set('Cache-Control', 'no-cache').sendFile(join(services.frontendPath!, 'index.html'));
    });
  }
  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No se encontró el recurso.' } });
  });
  app.use(accountErrorHandler);

  return app;
}
