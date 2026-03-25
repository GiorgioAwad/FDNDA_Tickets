# Deploy rápido a Vultr con GHCR

La app sigue corriendo en Vultr para conservar la IP estática whitelisteada por Servilex.
El build pesado sale del VPS y se hace en GitHub Actions.

## Imágenes publicadas

Al hacer `git push origin main`, el workflow publica:

- `ghcr.io/giorgioawad/fdnda-tickets-app:latest`
- `ghcr.io/giorgioawad/fdnda-tickets-tools:latest`

## Variables de GitHub Actions

Configura estas **Repository variables** en GitHub antes de publicar imágenes:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_PAYMENTS_MODE`

Ruta:

`Repository -> Settings -> Secrets and variables -> Actions -> Variables`

Valores recomendados para producción:

```text
NEXT_PUBLIC_APP_URL=https://ticketingfdnda.pe
NEXT_PUBLIC_APP_NAME=Ticketing FDNDA
NEXT_PUBLIC_PAYMENTS_MODE=izipay
```

## Login a GHCR

Para hacer `docker login ghcr.io` en el VPS, usa:

- `username`: tu usuario de GitHub
- `password`: un Personal Access Token (PAT) de GitHub con permiso `read:packages`

Ruta para crearlo:

`GitHub -> Settings -> Developer settings -> Personal access tokens`

Comando recomendado:

```bash
echo TU_GITHUB_PAT | docker login ghcr.io -u TU_USUARIO_GITHUB --password-stdin
```

## Variables en `.env.production`

```env
APP_IMAGE=ghcr.io/giorgioawad/fdnda-tickets-app:latest
TOOLS_IMAGE=ghcr.io/giorgioawad/fdnda-tickets-tools:latest
```

## Deploy en Vultr

```bash
cd /opt/fdnda-tickets
git pull origin main
docker login ghcr.io
docker compose -f docker-compose.prod.yml --env-file .env.production pull app migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d caddy cron
```

## Recuperación de la migración Servilex

Si Prisma se detiene en `20260310201307_add_servilex_catalog` con error `column already exists`:

```bash
docker exec -i fdnda_db psql -U "$DB_USER" -d "$DB_NAME" < scripts/recover_servilex_catalog_migration.sql
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate sh -lc "./node_modules/.bin/prisma migrate resolve --applied 20260310201307_add_servilex_catalog"
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate
```
