import express from 'express';
import { join } from 'node:path';
import { accountErrorHandler, accountsController } from './accounts/accounts.controller.js';
import type { AccountsService } from './accounts/accounts.service.js';
import type { RegistrationHandlerService } from './accounts/registration.service.js';
import type { PublicUser } from './accounts/accounts.repository.js';
import type { BookRepositoryInterface } from './book/book-repository-interface.js';
import { BookController } from './book/book-controller.js';
import { bookRoutes } from './book/book-routes.js';
import { authorRoutes } from './book/author-routes.js';
import type { SubjectRepositoryInterface } from './subject/subject-repository-interface.js';
import { SubjectController } from './subject/subject-controller.js';
import { subjectRoutes } from './subject/subject-routes.js';

interface AppServices {
  checkDatabase: () => Promise<void>;
  checkStorage: () => Promise<void>;
  accounts?: AccountsService;
  registrationService?: RegistrationHandlerService;
  listUniversities?: () => Promise<PublicUser['university'][]>;
  production?: boolean;
  books?: BookRepositoryInterface;
  subjects?: SubjectRepositoryInterface;
  frontendDirectory?: string;
}

export function createApp(services: AppServices) {
  const app = express();
  app.disable('x-powered-by');

  if (services.books) {
    const controller = new BookController(services.books);
    app.use('/api/books', bookRoutes(controller));
    app.use('/api/authors', authorRoutes(controller));
  }
  if (services.subjects) {
    app.use('/api/subjects', subjectRoutes(new SubjectController(services.subjects)));
  }

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/ready', async (_request, response) => {
    const [database, storage] = await Promise.allSettled([services.checkDatabase(), services.checkStorage()]);
    const ready = database.status === 'fulfilled' && storage.status === 'fulfilled';
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
      storage: storage.status === 'fulfilled' ? 'ok' : 'unavailable',
    });
  });
  app.use('/api', accountsController(
    services.accounts, services.production ?? false, services.registrationService, services.listUniversities,
  ));
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No se encontró el recurso.' } });
  });
  if (services.frontendDirectory) {
    const directory = services.frontendDirectory;
    app.use(express.static(directory));
    app.get('/{*path}', (request, response, next) => {
      if (!request.accepts('html')) return next();
      response.set('Cache-Control', 'no-cache').sendFile(join(directory, 'index.html'));
    });
  }
  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'No se encontró el recurso.' } });
  });
  app.use(accountErrorHandler);
  return app;
}
