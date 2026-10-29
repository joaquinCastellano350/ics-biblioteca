import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { LoanReading, PdfAccess, PdfAccessSigner } from './loan.js';

export const PDF_ACCESS_SECONDS = 300;

export class S3PdfAccessSigner implements PdfAccessSigner {
  constructor(private readonly storage: S3Client, private readonly bucket: string) {}

  async sign({ pdfObjectKey, dueAt, serverTime }: LoanReading): Promise<PdfAccess | null> {
    // SigV4 firma con precisión de segundos. Redondear hacia abajo evita que
    // la URL sobreviva al préstamo, incluso en su último segundo.
    const signingDate = new Date(Math.floor(serverTime.getTime() / 1000) * 1000);
    const expiresIn = Math.min(PDF_ACCESS_SECONDS, Math.floor((dueAt.getTime() - signingDate.getTime()) / 1000));
    const expiresAt = new Date(signingDate.getTime() + expiresIn * 1000);
    if (!Number.isFinite(expiresIn) || expiresIn < 1 || expiresAt <= serverTime) return null;
    const url = await getSignedUrl(this.storage, new GetObjectCommand({
      Bucket: this.bucket,
      Key: pdfObjectKey,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'inline',
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn, signingDate });
    return { url, expiresAt: expiresAt.toISOString() };
  }
}
