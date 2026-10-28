import type { LoanReadingRepositoryInterface } from './loan-repository-interface.js';
import type { PdfAccessSigner } from './loan.js';

export class LoanController {
  constructor(private readonly loans: LoanReadingRepositoryInterface, private readonly signer: PdfAccessSigner) {}

  findReadable(userId: string) { return this.loans.findReadable(userId); }

  async read(loanId: string, userId: string) {
    const reading = await this.loans.findReading(loanId, userId);
    return reading ? this.signer.sign(reading) : null;
  }
}
