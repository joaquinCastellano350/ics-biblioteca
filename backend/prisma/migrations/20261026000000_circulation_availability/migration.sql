-- SCRUM-18: base compartida de circulación, según Confluence v4.
-- No carga datos ni implementa concesiones, conciliación o notificaciones.
BEGIN;

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "order_seq" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'WAITING',
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "queue_entry_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "offered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "reservation_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_order_seq_key" ON "queue_entries"("order_seq");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_id_user_id_book_id_key" ON "queue_entries"("id", "user_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_queue_entry_id_key" ON "reservations"("queue_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_id_user_id_book_id_key" ON "reservations"("id", "user_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_queue_entry_id_user_id_book_id_key" ON "reservations"("queue_entry_id", "user_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "loans_reservation_id_key" ON "loans"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "loans_reservation_id_user_id_book_id_key" ON "loans"("reservation_id", "user_id", "book_id");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_queue_entry_id_user_id_book_id_fkey" FOREIGN KEY ("queue_entry_id", "user_id", "book_id") REFERENCES "queue_entries"("id", "user_id", "book_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_reservation_id_user_id_book_id_fkey" FOREIGN KEY ("reservation_id", "user_id", "book_id") REFERENCES "reservations"("id", "user_id", "book_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no expresa en el esquema: estados, cierres y duraciones.
ALTER TABLE "queue_entries"
    ADD CONSTRAINT "queue_entries_state_check" CHECK (
        "state" IN ('WAITING', 'OFFERED', 'FULFILLED', 'CANCELLED', 'EXPIRED', 'REJECTED_LIMIT')
    ),
    ADD CONSTRAINT "queue_entries_closed_at_check" CHECK (
        ("state" IN ('WAITING', 'OFFERED') AND "closed_at" IS NULL)
        OR ("state" IN ('FULFILLED', 'CANCELLED', 'EXPIRED', 'REJECTED_LIMIT')
            AND "closed_at" IS NOT NULL AND "closed_at" >= "joined_at")
    );

ALTER TABLE "reservations"
    ADD CONSTRAINT "reservations_duration_check" CHECK (
        "expires_at" = "offered_at" + interval '24 hours'
    ),
    ADD CONSTRAINT "reservations_state_check" CHECK (
        "state" IN ('HELD', 'CONSUMED', 'EXPIRED', 'CANCELLED', 'REJECTED_LIMIT')
    ),
    ADD CONSTRAINT "reservations_closed_at_check" CHECK (
        ("state" = 'HELD' AND "closed_at" IS NULL)
        OR ("state" IN ('CONSUMED', 'EXPIRED', 'CANCELLED', 'REJECTED_LIMIT')
            AND "closed_at" IS NOT NULL AND "closed_at" >= "offered_at")
    ),
    ADD CONSTRAINT "reservations_expired_at_check" CHECK (
        "state" <> 'EXPIRED' OR "closed_at" >= "expires_at"
    );

ALTER TABLE "loans"
    ADD CONSTRAINT "loans_duration_check" CHECK (
        "due_at" = "started_at" + interval '480 hours'
    ),
    ADD CONSTRAINT "loans_closed_at_check" CHECK (
        "closed_at" IS NULL OR "closed_at" >= "due_at"
    );

-- Abierto no equivale a vigente: el servicio también debe comparar las fechas
-- con el reloj de PostgreSQL. No usar now() en predicados de índices.
CREATE UNIQUE INDEX "queue_entries_user_book_open_key"
    ON "queue_entries"("user_id", "book_id") WHERE "state" IN ('WAITING', 'OFFERED');
CREATE INDEX "queue_entries_book_waiting_order_idx"
    ON "queue_entries"("book_id", "order_seq") WHERE "state" = 'WAITING';
CREATE INDEX "queue_entries_user_open_idx"
    ON "queue_entries"("user_id") WHERE "state" IN ('WAITING', 'OFFERED');
CREATE UNIQUE INDEX "loans_user_book_open_key"
    ON "loans"("user_id", "book_id") WHERE "closed_at" IS NULL;
CREATE INDEX "loans_book_due_open_idx"
    ON "loans"("book_id", "due_at") WHERE "closed_at" IS NULL;
CREATE INDEX "loans_user_due_open_idx"
    ON "loans"("user_id", "due_at") WHERE "closed_at" IS NULL;
CREATE INDEX "reservations_book_expires_held_idx"
    ON "reservations"("book_id", "expires_at") WHERE "state" = 'HELD';
CREATE INDEX "reservations_user_held_idx"
    ON "reservations"("user_id") WHERE "state" = 'HELD';

COMMIT;
