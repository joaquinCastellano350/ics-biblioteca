import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { requiredEnv } from './env.js';

// Una instancia compartida reutiliza las conexiones del proceso de Express.
const adapter = new PrismaPg({
  connectionString: requiredEnv('DATABASE_URL'),
  max: 5,
  connectionTimeoutMillis: 15_000,
});

export const database = new PrismaClient({ adapter });

export async function checkDatabase(): Promise<void> {
  await database.$queryRaw`SELECT 1`;
}
