import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({
  path: [
    '../../.env.local', '../../.env', '../.env',
  ].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  ),
  quiet: true,
});

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

export function serverPort(): number {
  const port = Number(process.env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  return port;
}
