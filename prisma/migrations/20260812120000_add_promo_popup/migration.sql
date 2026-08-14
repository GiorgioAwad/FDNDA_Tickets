-- CreateTable
CREATE TABLE "promo_popups" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "eyebrow" TEXT,
    "kicker" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "linkLabel" TEXT,
    "mediaCaption" TEXT,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "promo_popups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "promo_popups" ADD CONSTRAINT "promo_popups_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Contenido actual del popup en produccion, para que el deploy sea transparente
INSERT INTO "promo_popups" (
    "id", "isActive", "eyebrow", "kicker", "title", "description",
    "imageUrl", "linkUrl", "linkLabel", "mediaCaption", "sections", "updatedAt"
) VALUES (
    'default',
    true,
    'Estreno FDNDA',
    'Voces del Agua',
    'Conoce a la nadadora más rápida de la historia del Perú',
    'Rafaela Fernandini comparte el camino detrás de sus récords: disciplina, perseverancia y la pasión de representar al Perú.',
    NULL,
    'https://www.youtube.com/watch?v=AbSRrPAz4Zo',
    'Ver ahora en YouTube',
    'Temporada 1 · Episodio 1',
    ARRAY['INICIO','EVENTOS','MERCH'],
    NOW()
) ON CONFLICT ("id") DO NOTHING;
