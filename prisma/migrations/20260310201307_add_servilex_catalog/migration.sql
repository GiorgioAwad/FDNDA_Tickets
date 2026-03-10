-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "servilexServiceId" TEXT;

-- CreateTable
CREATE TABLE "servilex_services" (
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

-- CreateIndex
CREATE UNIQUE INDEX "servilex_services_codigo_key" ON "servilex_services"("codigo");

-- CreateIndex
CREATE INDEX "servilex_services_indicador_idx" ON "servilex_services"("indicador");

-- CreateIndex
CREATE INDEX "servilex_services_isActive_idx" ON "servilex_services"("isActive");

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_servilexServiceId_fkey" FOREIGN KEY ("servilexServiceId") REFERENCES "servilex_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
