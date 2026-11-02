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

export type QueueCancellationFailure = 'QUEUE_ENTRY_NOT_FOUND' | 'QUEUE_ENTRY_FULFILLED'
  | 'CIRCULATION_RECONCILIATION_REQUIRED';

/** closed no implica sobrescribir la causa de un cierre anterior. */
export type QueueCancellationResult = { readonly closed: true } | { readonly code: QueueCancellationFailure };

export interface QueueRepositoryInterface {
  joinQueue(userId: string, bookId: string): Promise<QueueResult>;
  cancelQueue(userId: string, entryId: string): Promise<QueueCancellationResult>;
}
