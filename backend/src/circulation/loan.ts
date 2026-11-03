export interface GrantedLoan {
  readonly id: string;
  readonly bookId: string;
  readonly startedAt: Date;
  readonly dueAt: Date;
}

export type LoanFailure = 'BOOK_NOT_FOUND' | 'LOAN_LIMIT_REACHED' | 'OPEN_QUEUE_ENTRY' | 'NO_AVAILABLE_COPIES';
export type LoanResult = { readonly loan: GrantedLoan; readonly created: boolean } | { readonly code: LoanFailure };

export interface LoanRepositoryInterface {
  requestLoan(userId: string, bookId: string): Promise<LoanResult>;
}
