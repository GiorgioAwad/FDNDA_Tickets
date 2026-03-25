ALTER TABLE "ticket_types"
ADD COLUMN IF NOT EXISTS "servilexServiceId" TEXT;

CREATE TABLE IF NOT EXISTS "servilex_services" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "indicador" TEXT NOT NULL,
    "disciplina" TEXT NOT NULL,
    "sede" TEXT NOT NULL,
    "clases" INTEGER,
    "descripcion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "servilex_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "servilex_services_codigo_key"
ON "servilex_services"("codigo");

CREATE INDEX IF NOT EXISTS "servilex_services_indicador_idx"
ON "servilex_services"("indicador");

CREATE INDEX IF NOT EXISTS "servilex_services_isActive_idx"
ON "servilex_services"("isActive");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ticket_types_servilexServiceId_fkey'
    ) THEN
        ALTER TABLE "ticket_types"
        ADD CONSTRAINT "ticket_types_servilexServiceId_fkey"
        FOREIGN KEY ("servilexServiceId")
        REFERENCES "servilex_services"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END $$;
