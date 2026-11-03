import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile, readdir } from 'node:fs/promises';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Solo pruebas: PostgreSQL en memoria con el mismo cliente y adaptador Prisma
// del proceso productivo. No lee credenciales ni accede al proyecto de Neon.
export async function catalogDatabase() {
  const database = await PGlite.create();
  // Fija la zona de la sesión de pruebas, como en Neon: el puente pg/PGlite
  // no debe reinterpretar los timestamps según la zona local de Windows.
  await database.exec("SET TIME ZONE 'UTC'");
  const migrations = new URL('../prisma/migrations/', import.meta.url);
  const directories = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    const migration = await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8');
    await database.exec(migration);
  }
  const server = new PGLiteSocketServer({ db: database, port: 0, host: '127.0.0.1' });
  await server.start();
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: `postgresql://postgres@${server.getServerConn()}/postgres?sslmode=disable`,
      max: 1,
      connectionTimeoutMillis: 5000,
    }),
  });
  return {
    client,
    postgres: database,
    async close() {
      await client.$disconnect();
      await server.stop();
      await database.close();
    },
  };
}
