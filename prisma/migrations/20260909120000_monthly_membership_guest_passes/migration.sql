BEGIN;

ALTER TABLE "membership_guest_passes" ADD COLUMN "month" TEXT;

-- La fecha es el día civil de Lima guardado como DATE. Conservar cada consumo
-- en su mes original, sin borrar el historial ni descontarlo del mes actual.
UPDATE "membership_guest_passes"
SET "month" = to_char("date", 'YYYY-MM');

ALTER TABLE "membership_guest_passes"
    ALTER COLUMN "month" SET NOT NULL,
    ADD CONSTRAINT "membership_guest_passes_month_date_check"
        CHECK ("month" = to_char("date", 'YYYY-MM'));

CREATE UNIQUE INDEX "membership_guest_passes_ticketId_month_number_key"
ON "membership_guest_passes"("ticketId", "month", "number");

DROP INDEX "membership_guest_passes_ticketId_number_key";

COMMIT;
