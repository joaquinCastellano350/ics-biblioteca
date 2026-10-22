import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { database } from '../src/database.js';
import { storage, storageBucket } from '../src/storage.js';

const apiUrl = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const key = `_connectivity-check/${randomUUID()}.txt`;
const content = 'ICS-Biblioteca: Neon connectivity check\n';
let uploaded = false;

try {
  const ready = await fetch(`${apiUrl}/api/ready`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', database: 'ok', storage: 'ok' });
  console.log('PASS Express -> Prisma -> PostgreSQL: HTTP 200 y SELECT 1.');

  await storage.send(new PutObjectCommand({
    Bucket: storageBucket, Key: key, Body: content, ContentType: 'text/plain',
  }));
  uploaded = true;
  const object = await storage.send(new GetObjectCommand({ Bucket: storageBucket, Key: key }));
  assert.equal(await object.Body?.transformToString(), content);
  console.log('PASS Object Storage: carga y descarga autenticadas.');

  const signedUrl = await getSignedUrl(storage, new GetObjectCommand({
    Bucket: storageBucket, Key: key,
  }), { expiresIn: 60 });
  const signedResponse = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
  assert.equal(signedResponse.status, 200);
  assert.equal(await signedResponse.text(), content);
  console.log('PASS URL firmada: descarga HTTP 200 con contenido correcto.');

  const unsignedUrl = new URL(signedUrl);
  unsignedUrl.search = '';
  const unsignedResponse = await fetch(unsignedUrl, { signal: AbortSignal.timeout(30_000) });
  assert.ok([401, 403].includes(unsignedResponse.status));
  console.log(`PASS Bucket privado: acceso anónimo rechazado (${unsignedResponse.status}).`);
} catch (error) {
  // No imprimir URLs firmadas, credenciales ni mensajes de los proveedores.
  console.error('FAIL Comprobación de servicios:', error instanceof Error ? error.name : 'Error');
  process.exitCode = 1;
} finally {
  try {
    if (uploaded) {
      await storage.send(new DeleteObjectCommand({ Bucket: storageBucket, Key: key }));
      let removed = false;
      try {
        await storage.send(new HeadObjectCommand({ Bucket: storageBucket, Key: key }));
      } catch (error) {
        removed = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
      }
      assert.ok(removed, 'El objeto de prueba debe quedar eliminado.');
      console.log('PASS Limpieza: objeto temporal eliminado.');
    }
  } catch {
    console.error('FAIL No se pudo verificar la limpieza del objeto de prueba.');
    process.exitCode = 1;
  } finally {
    storage.destroy();
    await database.$disconnect();
  }
}
