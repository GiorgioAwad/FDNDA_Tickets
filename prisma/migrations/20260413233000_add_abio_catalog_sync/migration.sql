-- Add ABIO catalog sync tables and optional binding reference on ticket types

ALTER TABLE "ticket_types"
ADD COLUMN "servilexBindingId" TEXT;

CREATE TABLE "abio_catalog_services" (
    "id" TEXT NOT NULL,
    "codigoEmp" TEXT NOT NULL,
    "sucursalCodigo" TEXT NOT NULL,
    "servicioCodigo" TEXT NOT NULL,
    "servicioDescripcion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abio_catalog_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abio_catalog_disciplines" (
    "id" TEXT NOT NULL,
    "codigoEmp" TEXT NOT NULL,
    "disciplinaCodigo" TEXT NOT NULL,
    "disciplinaNombre" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abio_catalog_disciplines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abio_catalog_schedules" (
    "id" TEXT NOT NULL,
    "codigoEmp" TEXT NOT NULL,
    "disciplinaCodigo" TEXT NOT NULL,
    "horarioCodigo" TEXT NOT NULL,
    "diaDescripcion" TEXT NOT NULL,
    "lunes" TEXT,
    "martes" TEXT,
    "miercoles" TEXT,
    "jueves" TEXT,
    "viernes" TEXT,
    "sabado" TEXT,
    "domingo" TEXT,
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "duracionHoras" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abio_catalog_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abio_catalog_bindings" (
    "id" TEXT NOT NULL,
    "codigoEmp" TEXT NOT NULL,
    "sucursalCodigo" TEXT NOT NULL,
    "servicioCodigo" TEXT NOT NULL,
    "disciplinaCodigo" TEXT NOT NULL,
    "piscinaCodigo" TEXT NOT NULL,
    "horarioCodigo" TEXT NOT NULL,
    "numeroCupos" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abio_catalog_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abio_catalog_sync_runs" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "deactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abio_catalog_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "abio_catalog_services_codigoEmp_sucursalCodigo_servicioCodigo_key"
ON "abio_catalog_services"("codigoEmp", "sucursalCodigo", "servicioCodigo");

CREATE INDEX "abio_catalog_services_codigoEmp_sucursalCodigo_isActive_idx"
ON "abio_catalog_services"("codigoEmp", "sucursalCodigo", "isActive");

CREATE INDEX "abio_catalog_services_servicioCodigo_idx"
ON "abio_catalog_services"("servicioCodigo");

CREATE UNIQUE INDEX "abio_catalog_disciplines_codigoEmp_disciplinaCodigo_key"
ON "abio_catalog_disciplines"("codigoEmp", "disciplinaCodigo");

CREATE INDEX "abio_catalog_disciplines_codigoEmp_isActive_idx"
ON "abio_catalog_disciplines"("codigoEmp", "isActive");

CREATE INDEX "abio_catalog_disciplines_disciplinaCodigo_idx"
ON "abio_catalog_disciplines"("disciplinaCodigo");

CREATE UNIQUE INDEX "abio_catalog_schedules_codigoEmp_disciplinaCodigo_horarioCodigo_key"
ON "abio_catalog_schedules"("codigoEmp", "disciplinaCodigo", "horarioCodigo");

CREATE INDEX "abio_catalog_schedules_codigoEmp_disciplinaCodigo_isActive_idx"
ON "abio_catalog_schedules"("codigoEmp", "disciplinaCodigo", "isActive");

CREATE INDEX "abio_catalog_schedules_horarioCodigo_idx"
ON "abio_catalog_schedules"("horarioCodigo");

CREATE UNIQUE INDEX "abio_catalog_bindings_codigoEmp_sucursalCodigo_servicioCodigo_disciplinaCodigo_piscinaCodigo_horarioCodigo_key"
ON "abio_catalog_bindings"("codigoEmp", "sucursalCodigo", "servicioCodigo", "disciplinaCodigo", "piscinaCodigo", "horarioCodigo");

CREATE INDEX "abio_catalog_bindings_codigoEmp_sucursalCodigo_servicioCodigo_isActive_idx"
ON "abio_catalog_bindings"("codigoEmp", "sucursalCodigo", "servicioCodigo", "isActive");

CREATE INDEX "abio_catalog_bindings_disciplinaCodigo_horarioCodigo_idx"
ON "abio_catalog_bindings"("disciplinaCodigo", "horarioCodigo");

CREATE INDEX "abio_catalog_sync_runs_resource_startedAt_idx"
ON "abio_catalog_sync_runs"("resource", "startedAt");

CREATE INDEX "abio_catalog_sync_runs_status_startedAt_idx"
ON "abio_catalog_sync_runs"("status", "startedAt");

ALTER TABLE "ticket_types"
ADD CONSTRAINT "ticket_types_servilexBindingId_fkey"
FOREIGN KEY ("servilexBindingId") REFERENCES "abio_catalog_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
