# ABIO - Pruebas integrales

Este runbook cubre la prueba que pidio ABIO: venta web completa, pago con
tarjetas de prueba, envio batch de ventas y log detallado de cada envio.

**Importante - ambiente homologo**: ABIO requiere que la prueba se ejecute
desde un ambiente publico equivalente a produccion, no desde `localhost`.
Para eso usamos un Vercel Preview/Project staging (ver
[STAGING_VERCEL_SETUP.md](./STAGING_VERCEL_SETUP.md)). El runbook local
sigue documentado al final como herramienta de debug, pero la evidencia
oficial que se entrega a ABIO debe salir del ambiente staging.

## Veredicto tecnico actual

La plataforma cumple la arquitectura solicitada por ABIO si las variables estan activas:

- Venta iniciada desde la web: el checkout crea una orden local y confirma el pago con Izipay cuando `PAYMENTS_MODE=izipay`.
- Envio a ABIO no en linea: al confirmar pago, `fulfillPaidOrder` crea registros `Invoice` en estado `PENDING`; el envio real lo hace `processInvoiceQueue`.
- Batch cada 2 minutos: el worker usa `WORKER_INVOICE_INTERVAL_MS=120000`.
- Envio secuencial: `processInvoiceQueue` procesa los comprobantes en orden con un loop secuencial y evita ejecuciones simultaneas dentro del proceso.
- Log: cada `Invoice` guarda `traceId`, payload enviado, respuesta ABIO, HTTP status, fecha de envio, reintentos, error, recibo e invoice number. El script `npm run abio:log` exporta esa evidencia a CSV y JSON.

Punto importante: si pruebas en `localhost`, el checkout de navegador puede funcionar, pero cualquier webhook/IPN servidor-a-servidor de Izipay solo llegara si Izipay puede ver una URL publica. Para validar IPN completo usa un ambiente publico de homologacion o un tunel HTTPS.

## Variables minimas

Revisa que en `.env.local` o `.env` esten configuradas:

```env
PAYMENTS_MODE=izipay
NEXT_PUBLIC_PAYMENTS_MODE=izipay
SERVILEX_ENABLED=true
SERVILEX_ENDPOINT=https://abio-pse.ue.r.appspot.com/fpdn/invoice
SERVILEX_TOKEN=...
WORKER_INVOICE_INTERVAL_MS=120000
WORKER_INVOICE_BATCH_SIZE=10
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

No registres ni compartas CVV, numero completo de tarjeta ni claves de Izipay/ABIO en los logs de evidencia.

## Ejecucion en staging (modo oficial para evidencia ABIO)

Pre-requisito: ambiente desplegado segun
[STAGING_VERCEL_SETUP.md](./STAGING_VERCEL_SETUP.md). Para los pasos de
abajo asumimos URL `https://fdnda-tickets-staging.vercel.app` (reemplazar
por la real).

1. Verifica que el ambiente esta sano:

```powershell
curl -s https://fdnda-tickets-staging.vercel.app/api/health
```

2. Genera ventas desde esa URL publica usando las tarjetas de prueba de
   Izipay sandbox. Completar el flujo hasta que cada orden quede `PAID`.
   Idealmente, crear varias ordenes para tener volumen real en el batch.

3. Disparar los lotes cada 2 minutos:

   **Opcion A** - Project staging con `staging` como Production: los crons
   de `vercel.json` ejecutan `/api/cron/process-invoices` automaticamente.
   Solo hay que monitorear la consola de Vercel y la base.

   **Opcion B** - Vercel Preview o cuando se quiere disparo manual desde la
   maquina del QA: usar el runner local que apunta al ambiente publico.

```powershell
# .env.local debe tener CRON_SECRET = mismo valor que esta en Vercel
npm run abio:remote-batch -- `
  --base https://fdnda-tickets-staging.vercel.app `
  --interval 120 `
  --max 30 `
  --label "abio-homologacion-$(Get-Date -Format yyyyMMdd-HHmm)"
```

   - Hace POST a `/api/cron/process-invoices` con `Authorization: Bearer
     $CRON_SECRET`.
   - Espera 120 segundos entre cada disparo (igual que el cron real).
   - Limita a 30 corridas (configurable con `--max`, omitir para ejecucion
     continua) y permite Ctrl+C para detener.
   - Guarda log NDJSON detallado en `tmp/abio-remote-batch-<fecha>.ndjson`
     con `t`, HTTP status, body de respuesta de cada lote y `label`
     identificable para la evidencia.

   Para una sola corrida ad-hoc: agregar `--once`.

4. Exporta la evidencia consolidada desde la base de staging:

```powershell
# Apuntar a la BD staging temporalmente
$env:DATABASE_URL = "postgresql://USER:PASS@NEON-STAGING/db?sslmode=require"
npm run abio:log -- --from 2026-05-19 --only-sent
```

   El export genera CSV y JSON en `tmp/` por cada `Invoice` enviado, con
   `traceId`, `httpStatus`, `sentToProvider`, `sentAt`, payload y
   respuesta ABIO.

5. Empaqueta para ABIO (un zip por tanda de pruebas):

   - `tmp/abio-remote-batch-*.ndjson` (log de cada disparo HTTP).
   - `tmp/abio-batch-export-*.csv` y `.json` (un registro por Invoice).
   - Captura de Vercel mostrando hora y estado de cada deployment + cron.
   - Lista de ordenes pagadas y tarjetas usadas (sin CVV ni PAN completo).

## Ejecucion local (debug)

> Solo para depurar el flujo en la maquina de desarrollo, **no es la
> evidencia oficial** que ABIO va a aceptar.

1. Levanta la web:

```bash
npm run dev
```

En PowerShell, si Windows bloquea `npm.ps1`, usa `npm.cmd run ...` para los mismos comandos.

2. Genera ventas desde la web en `http://localhost:3000`.

Usa las tarjetas de prueba de la pasarela y completa el checkout hasta que la orden quede pagada.

3. Ejecuta el batch.

Opcion continua, recomendada para simular produccion:

```bash
npm run worker
```

Este comando carga `.env.local` y `.env` antes de iniciar Prisma. En produccion, las variables pueden venir directamente del entorno del contenedor.

Opcion manual, una corrida por lote:

```bash
npm run abio:batch
```

Si lo haces manualmente, espera 2 minutos entre cada corrida:

```powershell
npm run abio:batch
Start-Sleep -Seconds 120
npm run abio:batch
```

4. Exporta el log de evidencia:

```bash
npm run abio:log -- --from 2026-05-18 --only-sent
```

Tambien puedes filtrar una orden especifica:

```bash
npm run abio:log -- --order-id <ORDER_ID>
```

El export genera dos archivos en `tmp/`: un `.csv` para revisar rapidamente y un `.json` con mas detalle tecnico.

## Criterios de exito

Una prueba se considera OK cuando:

- La orden queda `PAID`.
- Se crea al menos un `Invoice` con datos ABIO.
- Antes del batch, el `Invoice` esta `PENDING`.
- Despues del batch, el `Invoice` queda `ISSUED`.
- El log tiene `sentAt`, `httpStatus` exitoso, `sentToProvider=true`, `traceId` y respuesta ABIO.
- Si ABIO devuelve recibo/hash/numero/PDF, esos campos quedan registrados.

Si queda `FAILED_RETRYABLE` o `FAILED_REQUIRES_REVIEW`, exporta el log y revisa `lastError`, `httpStatus`, `abioErrorCode` y `abioErrorMessage`.

## Evidencia para ABIO

Para cada tanda de pruebas conserva:

- CSV/JSON generado por `npm run abio:log`.
- Captura o listado de ordenes pagadas.
- Fecha y hora de cada corrida batch.
- Cantidad de ventas enviadas.
- Errores y reintentos, si los hubo.

Con eso se cubre el registro detallado que ABIO solicito para analizar incidentes antes del pase a produccion.
