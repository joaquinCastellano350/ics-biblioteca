import type { LoanReading, ReadableLoans } from './loan.js';

export interface LoanReadingRepositoryInterface {
  findReading(loanId: string, userId: string): Promise<LoanReading | null>;
  findReadable(userId: string): Promise<ReadableLoans>;
}
