# Produccion Masiva - Checklist Operativo

## Estado del codigo

Se corrigieron riesgos de concurrencia y escalamiento en:
- Stock atomico en creacion de orden.
- Idempotencia de webhook IziPay con lock distribuido + transiciones atomicas.
- Evitar doble fulfillment de orden pagada.
- Escaneo QR atomico (`AVAILABLE -> USED`) en endpoints de scanner.
- Canje de cortesia atomico y validado contra stock.
- Liberacion de stock por cancelaciones y por expiracion automatica de `PENDING`.
- Nuevo cron de expiracion: `/api/cron/expire-orders` cada 5 minutos.
- ISR + paginacion en `/eventos` y polling de stock en detalle de evento.
- Cache headers para APIs publicas de eventos.
- Pool de Prisma reducido para serverless (`DB_POOL_MAX=5`, `DB_POOL_MIN=0`).
- Indices compuestos para consultas de alto volumen.

## Servicios obligatorios para salir a produccion

1. Vercel (app + cron)
- Cron activo para:
  - `/api/cron/process-emails` cada minuto.
  - `/api/cron/expire-orders` cada 5 minutos.
- Variables de entorno en Production configuradas.

2. Neon PostgreSQL
- Usar URL pooler (`-pooler`) en `DATABASE_URL`.
- Ejecutar migraciones en produccion: `npx prisma migrate deploy`.
- Confirmar autosuspend/autoscaling.

3. Upstash Redis
- Requerido para locks distribuidos, cola de emails y rate limiting.
- Configurar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.

4. IziPay Produccion
- Credenciales reales (`IZIPAY_*`) y webhook a:
  - `https://<tu-dominio>/api/payments/izipay/webhook`
- Validar firma webhook en ambiente real.

5. Proveedor de email transaccional
- El codigo ya soporta `EMAIL_PROVIDER="ses"` (mantiene `resend` como fallback).
- Para SES en produccion, configurar:
  - Dominio verificado (DKIM/SPF/DMARC).
  - Credenciales IAM minimas.
  - Variables: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

## Bloqueantes antes de abrir ventas reales

1. Configuracion IziPay de produccion
- El flujo real ya esta implementado (`/api/payments/izipay/session` + redireccion desde checkout).
- Debes definir `PAYMENTS_MODE=izipay`, `NEXT_PUBLIC_PAYMENTS_MODE=izipay` y, si aplica a tu cuenta, `IZIPAY_CHECKOUT_URL`.

2. Migraciones en produccion
- Falta aplicar migraciones nuevas (indices) en DB productiva.

3. Pruebas de carga
- Ejecutar k6/Artillery para validar 200+ concurrencia y confirmar que no hay sobreventa.

## Variables nuevas/relevantes

- `DB_POOL_MAX`
- `DB_POOL_MIN`
- `CRON_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `USE_EMAIL_QUEUE`
- `IZIPAY_CHECKOUT_URL` (opcional segun formato de respuesta de IziPay)

## Comandos de despliegue sugeridos

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
```

## Monitoreo recomendado

- Sentry (errores de runtime).
- Uptime check a `/api/health`.
- Alertas de cola de emails (pendientes/fallidos).
- Dashboard Neon (conexiones, CPU, latencia).
- Dashboard Upstash (ops/s, latencia, errores).
