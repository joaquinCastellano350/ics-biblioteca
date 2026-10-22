import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

config({
  path: [
    '../.env.local', '../.env', '.env',
  ].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  ),
  quiet: true,
});

const directUrl = process.env['DATABASE_URL_UNPOOLED'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
