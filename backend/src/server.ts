import { createApp } from './app.js';
import { checkDatabase, database } from './database.js';
import { serverPort } from './env.js';
import { checkStorage, storage } from './storage.js';
import { fileURLToPath } from 'node:url';
import { AccountsService } from './accounts/accounts.service.js';
import { PrismaAccountsRepository } from './accounts/prisma-accounts.repository.js';

const port = serverPort();
const production = process.env['NODE_ENV'] === 'production';
const server = createApp({
  checkDatabase, checkStorage,
  accounts: new AccountsService(new PrismaAccountsRepository(database)), production,
  ...(production ? { frontendPath: fileURLToPath(new URL('../../frontend/dist/biblioteca/browser/', import.meta.url)) } : {}),
}).listen(port, () => {
  console.log(`API disponible en el puerto ${port}.`);
});

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
