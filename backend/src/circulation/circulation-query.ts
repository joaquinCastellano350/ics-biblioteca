export interface CirculationBook {
  readonly id: string;
  readonly title: string;
}

export interface PersonalLoan {
  readonly id: string;
  readonly book: CirculationBook;
  readonly startedAt: Date;
  readonly dueAt: Date;
}

export interface PersonalWait {
  readonly id: string;
  readonly book: CirculationBook;
  readonly joinedAt: Date;
  readonly position: number;
}

export interface PersonalReservation {
  readonly id: string;
  readonly queueEntryId: string;
  readonly book: CirculationBook;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
}

/** Fotografía de lectura; no concede préstamos ni concilia la cola. */
export interface PersonalCirculation {
  readonly serverTime: Date;
  readonly loans: readonly PersonalLoan[];
  readonly waits: readonly PersonalWait[];
  readonly reservations: readonly PersonalReservation[];
  readonly requestConstraints: {
    readonly activeLoanCount: number;
    readonly maxActiveLoans: number;
    readonly openQueueBookIds: readonly string[];
  };
}

export interface CirculationQueryRepositoryInterface {
  findPersonalCirculation(userId: string): Promise<PersonalCirculation>;
}
