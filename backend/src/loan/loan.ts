/** Datos privados necesarios para autorizar la lectura; nunca salen al catálogo. */
export interface LoanReading {
  readonly pdfObjectKey: string;
  readonly dueAt: Date;
  readonly serverTime: Date;
}

export interface PdfAccess {
  readonly url: string;
  readonly expiresAt: string;
}

export interface PdfAccessSigner {
  sign(reading: LoanReading): Promise<PdfAccess | null>;
}
