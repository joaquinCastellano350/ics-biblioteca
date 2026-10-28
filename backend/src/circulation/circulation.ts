// Lecturas compartidas de circulación. Los modelos persistidos están en Prisma.
// No se devuelve información de estudiantes en el catálogo público.
export interface BookOccupancy {
  readonly bookId: string;
  readonly totalCopies: number;
  readonly activeLoans: number;
  readonly heldReservations: number;
}

export interface BookAvailability {
  readonly bookId: string;
  readonly totalCopies: number;
  readonly availableCopies: number;
}
