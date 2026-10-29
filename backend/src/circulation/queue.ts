export interface QueueBook {
  readonly id: string;
  readonly title: string;
}

interface QueueEntryBase {
  readonly id: string;
  readonly book: QueueBook;
  readonly joinedAt: Date;
}

export type OpenQueueEntry = QueueEntryBase & (
  | { readonly state: 'WAITING'; readonly position: number }
  | { readonly state: 'OFFERED'; readonly position: null }
);

export type QueueFailure = 'BOOK_NOT_FOUND' | 'BOOK_ALREADY_BORROWED' | 'LOAN_LIMIT_REACHED'
  | 'AVAILABLE_COPIES' | 'CIRCULATION_RECONCILIATION_REQUIRED';

export type QueueResult = { readonly code: QueueFailure } | {
  readonly serverTime: Date;
  readonly entry: OpenQueueEntry;
  readonly created: boolean;
};

export interface QueueRepositoryInterface {
  joinQueue(userId: string, bookId: string): Promise<QueueResult>;
}
