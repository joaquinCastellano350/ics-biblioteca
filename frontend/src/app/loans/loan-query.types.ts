export interface CirculationBook {
  readonly id: string;
  readonly title: string;
}

export interface PersonalLoan {
  readonly id: string;
  readonly book: CirculationBook;
  readonly startedAt: string;
  readonly dueAt: string;
}

export interface PersonalWait {
  readonly id: string;
  readonly book: CirculationBook;
  readonly joinedAt: string;
  readonly position: number;
}

export interface PersonalReservation {
  readonly id: string;
  readonly queueEntryId: string;
  readonly book: CirculationBook;
  readonly offeredAt: string;
  readonly expiresAt: string;
}

export interface PersonalCirculation {
  readonly serverTime: string;
  readonly loans: readonly PersonalLoan[];
  readonly waits: readonly PersonalWait[];
  readonly reservations: readonly PersonalReservation[];
  readonly requestConstraints: {
    readonly activeLoanCount: number;
    readonly maxActiveLoans: number;
    readonly openQueueBookIds: readonly string[];
  };
}
