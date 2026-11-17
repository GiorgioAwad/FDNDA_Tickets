-- Cupos por franja editables (override del catálogo de horarios). Nullable e
-- idempotente: se puede aplicar antes de desplegar el código que la usa.
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "membershipSlotCapacities" JSONB;
