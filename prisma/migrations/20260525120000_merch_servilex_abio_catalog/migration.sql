-- Permite vincular productos merch al catalogo ABIO (AbioCatalogService) para emisión Servilex OS.
-- servilexServiceCode: codigo ABIO (string), mas flexible que el FK previo a servilex_services (que solo tenía indicador AC).
-- servilexSucursalCode: sucursal ABIO para el comprobante; si null, se usa el default del env SERVILEX_SUCURSAL.
-- Se conserva servilexServiceId como columna nullable por compatibilidad con datos previos.

ALTER TABLE "merch_products"
  ADD COLUMN IF NOT EXISTS "servilexServiceCode" TEXT,
  ADD COLUMN IF NOT EXISTS "servilexSucursalCode" TEXT;
