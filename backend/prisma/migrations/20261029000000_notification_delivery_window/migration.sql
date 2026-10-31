-- Conserva la ventana de idempotencia del proveedor entre reinicios.
-- Los avisos ya intentados se detienen para revisión: no conocemos la fecha
-- de su primera llamada y no es seguro reenviarlos automáticamente.
BEGIN;

ALTER TABLE notification_outbox ADD COLUMN first_attempt_at TIMESTAMPTZ(6);
UPDATE notification_outbox SET first_attempt_at = '1970-01-01T00:00:00Z'
    WHERE attempt_count > 0;

COMMIT;
