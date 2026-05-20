# Setup: Ambiente homologo (Vercel) para pruebas integrales con ABIO

Este runbook crea el ambiente publico equivalente a produccion que pide
ABIO. El objetivo es que toda la prueba E2E (venta web -> pago sandbox ->
envio batch a ABIO -> log) corra sobre URL publica con HTTPS y no sobre
localhost.

## Por que no alcanza con localhost

- Izipay sandbox necesita una URL HTTPS publica para entregar el IPN/return.
- ABIO valida origen IP y solo ve trafico desde el ambiente declarado.
- El batch a 2 minutos solo es realista si corre en infraestructura desplegada,
  no en una laptop que se apaga.

## Arquitectura del ambiente staging

```
GitHub (origin/main) ---- merge ----> rama `staging`
                                         |
                                         v
                                Vercel (Project staging)
                                         |
                       +-----------------+-----------------+
                       v                                   v
                Neon Postgres (staging)              Upstash Redis (staging)
                       |
                       v
                Izipay SANDBOX  +  ABIO homologacion
```

## Paso 1 - Crear la rama `staging` en GitHub

```powershell
# desde la carpeta fdnda-tickets
git fetch origin
git checkout -b staging origin/main
git push -u origin staging
```

## Paso 2 - Crear el Project en Vercel

Vercel tiene una limitacion conocida: **los crons solo disparan en
deployments de Production**, no en Preview. Para que el batch ABIO funcione
automatico cada 2 min hay dos rutas:

### Opcion A (recomendada) - Project separado con `staging` como Production

1. Vercel Dashboard -> Add New -> Project -> Import el repo
   `GiorgioAwad/FDNDA_Tickets`.
2. Nombre del project: `fdnda-tickets-staging`.
3. En **Settings -> Git -> Production Branch** poner `staging` (en vez de
   `main`).
4. Deshabilitar la opcion "Auto-assign Custom Domains in Production" si vas
   a usar el subdominio `*.vercel.app`.
5. La URL queda algo como `https://fdnda-tickets-staging.vercel.app`.
6. Vercel detecta `vercel.json` y registra los crons automaticamente. Como
   esto es el "Production" del project staging, los crons SI disparan.

### Opcion B - Mismo project, rama staging en Preview + cron externo

1. En el project actual configurar variables de entorno para la branch
   `staging` (Environment Variables -> Preview -> Branches -> `staging`).
2. Los crons de `vercel.json` NO se ejecutaran en ese preview.
3. Usar el runner local `npm run abio:remote-batch` (ver
   `docs/ABIO_PRUEBAS_INTEGRALES.md`) que dispara el endpoint cada 2 min
   con el `CRON_SECRET`.

Elegir Opcion A si las pruebas se van a hacer en sesiones largas o si ABIO
exige que el batch corra sin intervencion manual. Opcion B sirve para
pruebas cortas controladas desde la maquina del QA.

## Paso 3 - Cargar variables de entorno en Vercel

Tomar `env.staging.example`, generar secretos nuevos para staging y
cargarlos:

```powershell
# generar secretos (Git Bash, WSL o gitbash en Windows)
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # QR_SECRET
openssl rand -hex 32      # CRON_SECRET
```

En el Vercel Dashboard del project staging:

1. Settings -> Environment Variables -> seleccionar "Production"
   (si seguiste Opcion A) o "Preview" + branch=staging (Opcion B).
2. Pegar todas las variables del archivo `env.staging.example`, una por
   una, con los valores reales.
3. Variables criticas a revisar:
   - `DATABASE_URL`: Neon staging dedicado, NO el de prod.
   - `IZIPAY_*`: credenciales sandbox.
   - `SERVILEX_ENABLED=true` y `SERVILEX_TOKEN` de homologacion.
   - `CRON_SECRET`: usar el mismo que vas a configurar en el runner local
     o en el cron externo.
   - `UPSTASH_REDIS_REST_*`: instancia separada para no consumir rate
     limits de prod.

## Paso 4 - Aplicar migraciones a Neon staging

Desde tu maquina, apuntando a la BD staging:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASS@NEON-STAGING/db?sslmode=require"
npx prisma migrate deploy
```

## Paso 5 - IP fija para ABIO

ABIO suele exigir whitelist de IP saliente.

- **Vercel no expone IP fija** para funciones serverless. Si ABIO requiere
  IP estatica, este ambiente no sirve para la prueba final y hay que
  enviarla desde el VPS (que ya tiene IP fija). En ese caso el "staging
  homologo" es el VPS y Vercel sirve solo para el frontend.
- Si ABIO no exige IP fija para homologacion, Vercel basta.

Confirmar con ABIO antes del Paso 6.

## Paso 6 - Health check

```powershell
curl -s https://fdnda-tickets-staging.vercel.app/api/health
```

Debe devolver `{ ok: true, ... }`.

## Paso 7 - Ejecutar las pruebas

Seguir el runbook [ABIO_PRUEBAS_INTEGRALES.md](./ABIO_PRUEBAS_INTEGRALES.md)
seccion "Ejecucion en staging".

## Limpieza post-prueba

- Vaciar la base Neon staging entre tandas si se acumula ruido.
- Rotar `CRON_SECRET` antes de pasar a produccion.
- No reutilizar las mismas credenciales sandbox en prod.
