import { createApp } from './app.js';
import { checkDatabase, database } from './database.js';
import { serverPort } from './env.js';
import { checkStorage, storage } from './storage.js';
import { AccountsService } from './accounts/accounts.service.js';
import { PrismaAccountsRepository } from './accounts/prisma-accounts.repository.js';
import { RegistrationService } from './accounts/registration.service.js';
import { PostgresRegistrationRepository } from './accounts/registration.repository.js';
import { BookRepository } from './book/book-repository.js';
import { SubjectRepository } from './subject/subject-repository.js';
import { CirculationRepository } from './circulation/circulation-repository.js';
import { LoanRepository } from './circulation/loan-repository.js';
import { CirculationQueryRepository } from './circulation/circulation-query-repository.js';
import { QueueRepository } from './circulation/queue-repository.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = serverPort();
const production = process.env['NODE_ENV'] === 'production';
const frontendDirectory = fileURLToPath(new URL('../../frontend/dist/biblioteca/browser/', import.meta.url));
const server = createApp({
  checkDatabase, checkStorage, production,
  accounts: new AccountsService(new PrismaAccountsRepository(database)),
  registrationService: new RegistrationService(new PostgresRegistrationRepository(database)),
  books: new BookRepository(database),
  circulation: new CirculationRepository(database),
  loans: new LoanRepository(database),
  circulationQueries: new CirculationQueryRepository(database),
  queue: new QueueRepository(database),
  subjects: new SubjectRepository(database),
  ...(production && existsSync(join(frontendDirectory, 'index.html')) ? { frontendDirectory } : {}),
}).listen(port, () => { console.log(`API disponible en el puerto ${port}.`); });

server.on('error', () => {
  console.error('No se pudo iniciar el servidor HTTP.');
  process.exitCode = 1;
  storage.destroy();
  void database.$disconnect();
});
function shutdown(): void {
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  server.close(() => {
    storage.destroy();
    void database.$disconnect().finally(() => clearTimeout(timeout));
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
