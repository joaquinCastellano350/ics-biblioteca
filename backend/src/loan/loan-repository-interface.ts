import type { LoanReading } from './loan.js';

export interface LoanReadingRepositoryInterface {
  findReading(loanId: string, userId: string): Promise<LoanReading | null>;
}
