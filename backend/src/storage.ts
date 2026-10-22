import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { requiredEnv } from './env.js';

export const storageBucket = process.env['STORAGE_BUCKET'] ?? 'assets';

// Neon requiere direccionamiento por ruta; las credenciales quedan en la API.
export const storage = new S3Client({
  endpoint: requiredEnv('AWS_ENDPOINT_URL_S3'),
  region: requiredEnv('AWS_REGION'),
  credentials: {
    accessKeyId: requiredEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('AWS_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
});

export async function checkStorage(): Promise<void> {
  await storage.send(new HeadBucketCommand({ Bucket: storageBucket }));
}
