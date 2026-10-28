-- Trabajo durable de conciliación; no instala un emisor de correo.
BEGIN;

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "loan_id" UUID,
    "reservation_id" UUID,
    "queue_entry_id" UUID,
    "kind" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMPTZ(6),
    "lease_expires_at" TIMESTAMPTZ(6),
    "claim_token" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedup_key_key" ON "notification_outbox"("dedup_key");

-- CreateIndex
CREATE INDEX "notification_outbox_loan_id_idx" ON "notification_outbox"("loan_id");

-- CreateIndex
CREATE INDEX "notification_outbox_reservation_id_idx" ON "notification_outbox"("reservation_id");

-- CreateIndex
CREATE INDEX "notification_outbox_queue_entry_id_idx" ON "notification_outbox"("queue_entry_id");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_outbox"
    ADD CONSTRAINT "notification_outbox_origin_check" CHECK (
        num_nonnulls("loan_id", "reservation_id", "queue_entry_id") = 1
    ),
    ADD CONSTRAINT "notification_outbox_kind_origin_check" CHECK (
        ("kind" = 'TURN_AVAILABLE' AND "reservation_id" IS NOT NULL)
        OR ("kind" = 'QUEUE_LIMIT_REJECTED' AND "queue_entry_id" IS NOT NULL)
        OR ("kind" IN ('LOAN_DAY_10', 'LOAN_DUE_IN_3_DAYS', 'LOAN_EXPIRED') AND "loan_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "notification_outbox_state_check" CHECK (
        "state" IN ('PENDING', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED')
    ),
    ADD CONSTRAINT "notification_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
    ADD CONSTRAINT "notification_outbox_claim_check" CHECK (
        ("state" = 'PROCESSING' AND "claimed_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL
            AND "claim_token" IS NOT NULL AND "lease_expires_at" > "claimed_at")
        OR ("state" <> 'PROCESSING' AND "claimed_at" IS NULL AND "lease_expires_at" IS NULL AND "claim_token" IS NULL)
    ),
    ADD CONSTRAINT "notification_outbox_sent_check" CHECK (
        ("state" = 'SENT' AND "sent_at" IS NOT NULL) OR ("state" <> 'SENT' AND "sent_at" IS NULL)
    );

CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox"("next_attempt_at", "scheduled_at")
    WHERE "state" = 'PENDING';
CREATE INDEX "notification_outbox_processing_lease_idx" ON "notification_outbox"("lease_expires_at")
    WHERE "state" = 'PROCESSING';

COMMIT;
