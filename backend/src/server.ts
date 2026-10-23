import { createApp } from './app.js';
import { checkDatabase, database } from './database.js';
import { serverPort } from './env.js';
import { checkStorage, storage } from './storage.js';
import { BookRepository } from './book/book-repository.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = serverPort();
const frontendDirectory = fileURLToPath(
  new URL('../../frontend/dist/biblioteca/browser/', import.meta.url),
);
const server = createApp({
  checkDatabase,
  checkStorage,
  books: new BookRepository(database),
  ...(existsSync(join(frontendDirectory, 'index.html')) ? { frontendDirectory } : {}),
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
