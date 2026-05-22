# Setup: Staging en el VPS Vultr (homologo a produccion)

Este runbook crea `https://staging.ticketingfdnda.pe` en el **mismo VPS
Vultr** donde corre produccion. Asi reusamos la IP fija que ABIO ya
whitelisteo: no necesitamos pedir whitelist adicional para el ambiente
de pruebas.

> Reemplaza `STAGING_VERCEL_SETUP.md`. Vercel quedo descartado porque no
> expone IP fija para funciones serverless.

## Arquitectura final en el VPS

```
                       Internet
                          |
                          v
                  Caddy :443 (container fdnda_caddy del compose prod)
                  /            \
                 v              v
       ticketingfdnda.pe   staging.ticketingfdnda.pe
        fdnda_app:3000      fdnda_app_staging:3000
            |                       |
            v                       v
        fdnda_db (prod)         Neon staging DB
            |                       |
        fdnda_worker            fdnda_worker_staging
        (red web prod)          (red staging-internal + red prod_web via Caddy)
```

- Caddy lo manda el compose de prod. Staging NO lanza su propio Caddy.
- Staging joinea la red `fdnda-tickets_web` (creada por prod) para que
  Caddy pueda alcanzar `fdnda_app_staging:3000`.
- BD staging: **Neon dedicado** (cloud), no compartas postgres con prod.
- IP saliente: la del VPS, que ABIO ya tiene whitelisteada.

## Paso 1 - DNS

En punto.pe (o donde manejes el DNS de `ticketingfdnda.pe`):

```
Tipo    Nombre     Valor              TTL
A       staging    65.108.XX.XX       300
```

`65.108.XX.XX` = IP publica del VPS prod (la que ABIO ya tiene
whitelisteada). Esperar 5-10 min para propagacion DNS.

## Paso 2 - Verificar la red Docker de prod

La red externa que usa staging para alcanzar Caddy se llama
`fdnda-tickets_web` por defecto (prefijo `fdnda-tickets_` viene del
nombre de la carpeta `~/fdnda-tickets` del compose prod).

```bash
ssh root@65.108.XX.XX
docker network ls | grep web
# debe listar: fdnda-tickets_web ... bridge
```

Si tu carpeta prod tiene otro nombre (ej. `~/fdnda-prod`), la red sera
`fdnda-prod_web`. En ese caso, edita `docker-compose.staging.yml` en la
seccion final:

```yaml
networks:
  prod_web:
    external: true
    name: fdnda-tickets_web   # <-- ajustar al nombre real
```

## Paso 3 - Clonar la rama staging en el VPS

Mantener prod y staging como **clones separados** del repo:

```bash
ssh root@65.108.XX.XX
mkdir -p ~/fdnda-staging
cd ~/fdnda-staging
git clone --branch staging https://github.com/GiorgioAwad/FDNDA_Tickets.git .
```

## Paso 4 - Crear la BD staging en Neon

1. Login en Neon, crear un nuevo project `fdnda-staging`.
2. Branch `main`, region `us-east-1` (cerca del VPS y de Servilex GAE).
3. Copiar la `DATABASE_URL` con `sslmode=require`.

## Paso 5 - Configurar .env.staging

```bash
cd ~/fdnda-staging
cp env.staging.example .env.staging
nano .env.staging
```

Generar secretos nuevos (no reusar los de prod):

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # QR_SECRET
openssl rand -hex 32      # CRON_SECRET (tomar nota, lo usa el cron interno)
```

Variables criticas:

| Variable | Que poner |
|----------|-----------|
| `DATABASE_URL` | Neon staging (paso 4) |
| `NEXT_PUBLIC_APP_URL` | `https://staging.ticketingfdnda.pe` |
| `NEXTAUTH_URL` | `https://staging.ticketingfdnda.pe` |
| `PAYMENTS_MODE` | `izipay` |
| `IZIPAY_*` | credenciales **sandbox** de Izipay |
| `SERVILEX_ENABLED` | `true` |
| `SERVILEX_TOKEN` | token de **homologacion** de ABIO |
| `UPSTASH_REDIS_REST_*` | instancia Upstash dedicada a staging |
| `CRON_SECRET` | distinto al de prod |

## Paso 6 - Agregar el sitio staging al Caddyfile de prod

El Caddy que corre en el VPS pertenece al compose prod. Hay que sumarle
el bloque para `staging.ticketingfdnda.pe`.

```bash
# desde el VPS, en la carpeta de prod
cd ~/fdnda-tickets
nano Caddyfile
```

Pegar al final del archivo el contenido de
`~/fdnda-staging/Caddyfile.staging`. Luego recargar Caddy:

```bash
docker compose -f docker-compose.prod.yml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile
```

> Importante: este cambio del Caddyfile NO viene del repo (origin/main
> sigue limpio de "cosas de staging"). Es una edicion manual en el VPS.
> Si pull-eas main y el Caddyfile cambia, vas a tener que repegar el
> bloque. Alternativa mas robusta: usar `import` en el Caddyfile (ver
> seccion "Alternativa con import" al final).

## Paso 7 - Pull de imagenes GHCR y aplicar migraciones

> Las imagenes se buildean en GitHub Actions (`.github/workflows/publish-images.yml`)
> en cada push a `staging`. El VPS NO buildea (poco espacio en disco) — solo
> hace `pull`. Tags usados:
> - `ghcr.io/giorgioawad/fdnda-tickets-app:staging`
> - `ghcr.io/giorgioawad/fdnda-tickets-tools:staging`

Requisito una vez: estar logueado en GHCR en el VPS (mismo PAT que prod
con `read:packages` — ver `docs/PROD_GHCR_DEPLOY.md` seccion "GHCR login").

```bash
cd ~/fdnda-staging
docker compose -f docker-compose.staging.yml --profile tools \
  --env-file .env.staging pull app-staging worker-staging migrate-staging
```

Migrar la BD staging:

```bash
docker compose -f docker-compose.staging.yml --profile tools \
  --env-file .env.staging run --rm migrate-staging
```

## Paso 8 - Levantar staging

```bash
docker compose -f docker-compose.staging.yml up -d
```

Verificar:

```bash
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs -f app-staging
```

Esperar 1-2 min para que Caddy emita el certificado SSL (Let's Encrypt)
del subdominio.

## Paso 9 - Health check

Desde tu maquina:

```powershell
curl -s https://staging.ticketingfdnda.pe/api/health
```

Debe devolver `{ ok: true, ... }`. Si devuelve 502, revisar:

```bash
docker compose -f docker-compose.staging.yml logs app-staging
docker compose -f docker-compose.prod.yml logs caddy | grep staging
```

## Paso 10 - Crear admin staging

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging \
  exec app-staging node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash('AdminStaging123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin-staging@fdnda.org.pe' },
    update: { passwordHash: hash, role: 'ADMIN' },
    create: {
      name: 'Admin Staging',
      email: 'admin-staging@fdnda.org.pe',
      passwordHash: hash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.\$disconnect();
})();
"
```

## Paso 11 - Confirmar IP a ABIO

```bash
curl -s ifconfig.me
```

Confirma con ABIO que esa IP esta whitelisteada. Como es el mismo VPS de
prod, ya deberia estarlo.

## Cron y secuencialidad cada 2 min

Vercel no esta involucrado, asi que `vercel.json` NO se usa. El cron en
staging corre dentro del contenedor `fdnda_worker_staging` (script
`scripts/worker-runner.mjs`), que respeta:

- `WORKER_INVOICE_INTERVAL_MS=120000` (2 min entre lotes)
- `WORKER_INVOICE_BATCH_SIZE=10`
- Lock Redis `abio:batch:lock` (NX EX 110s) en el endpoint cron — si
  prefieres usar el endpoint HTTP `/api/cron/process-invoices` desde un
  cron externo, ese mismo lock evita solapamientos.

Para ejecutar las pruebas integrales ver
[ABIO_PRUEBAS_INTEGRALES.md](./ABIO_PRUEBAS_INTEGRALES.md) seccion
"Ejecucion en staging (VPS)".

## Mantenimiento

```bash
# Pull de cambios (rama staging) — el build lo hizo GitHub Actions
cd ~/fdnda-staging
git pull origin staging
docker compose -f docker-compose.staging.yml --profile tools \
  --env-file .env.staging pull app-staging worker-staging migrate-staging
docker compose -f docker-compose.staging.yml --profile tools \
  --env-file .env.staging run --rm migrate-staging
docker compose -f docker-compose.staging.yml up -d
```

```bash
# Detener staging temporalmente
docker compose -f docker-compose.staging.yml down

# Logs en vivo
docker compose -f docker-compose.staging.yml logs -f
```

## Alternativa con `import` (opcional, mas mantenible)

Si te molesta tener que repegar el bloque cada vez que pulleas main,
cambia el Caddyfile de prod para que importe una carpeta extra:

```caddy
# en ~/fdnda-tickets/Caddyfile, agregar al inicio:
import /etc/caddy/sites.d/*.caddy
```

Y agrega al `caddy` service del docker-compose.prod.yml un volumen:

```yaml
caddy:
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
    - ../fdnda-staging/Caddyfile.staging:/etc/caddy/sites.d/staging.caddy:ro
    - caddy_data:/data
    - caddy_config:/config
```

Asi cualquier `git pull origin staging` en `~/fdnda-staging` actualiza
el bloque que Caddy carga al recargar. Ese cambio del compose prod si
necesitarias commitearlo a `main` cuando lo decidas.

## Limpieza

Entre tandas de pruebas, si la BD acumula ruido:

```bash
# Reset suave (cuidado: borra TODOS los datos de staging)
docker compose -f docker-compose.staging.yml --profile tools \
  --env-file .env.staging run --rm migrate-staging -- /bin/sh -lc \
  "./node_modules/.bin/prisma migrate reset --force --skip-seed"
```
