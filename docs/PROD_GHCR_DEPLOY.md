# Rapid deploy to Vultr with GHCR

The app continues to run on Vultr to preserve the static IP whitelisted by Servilex.
The heavy build is done in GitHub Actions instead of the VPS.

## Published images

On every `git push origin main`, the workflow publishes:

- `ghcr.io/giorgioawad/fdnda-tickets-app:latest`
- `ghcr.io/giorgioawad/fdnda-tickets-tools:latest`

## GitHub Actions variables

Configure these repository variables before publishing images:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_PAYMENTS_MODE`

Path:

`Repository -> Settings -> Secrets and variables -> Actions -> Variables`

Recommended production values:

```text
NEXT_PUBLIC_APP_URL=https://ticketingfdnda.pe
NEXT_PUBLIC_APP_NAME=Ticketing FDNDA
NEXT_PUBLIC_PAYMENTS_MODE=izipay
```

## GHCR login on the VPS

Create a GitHub PAT with `read:packages` and run:

```bash
echo TU_GITHUB_PAT | docker login ghcr.io -u TU_USUARIO_GITHUB --password-stdin
```

## Required `.env.production` entries

```env
APP_IMAGE=ghcr.io/giorgioawad/fdnda-tickets-app:latest
TOOLS_IMAGE=ghcr.io/giorgioawad/fdnda-tickets-tools:latest
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-NEON-HOST/dbname?sslmode=require
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=fdnda-assets
R2_PUBLIC_BASE_URL=https://assets.ticketingfdnda.pe
```

## Deploy on Vultr

```bash
cd /opt/fdnda-tickets
git pull origin main
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production pull app migrate worker
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app worker caddy
```

## Migration recovery for Servilex drift

If Prisma stops at `20260310201307_add_servilex_catalog` because the column already exists:

```bash
docker exec -i fdnda_db psql -U "$DB_USER" -d "$DB_NAME" < scripts/recover_servilex_catalog_migration.sql
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate sh -lc "./node_modules/.bin/prisma migrate resolve --applied 20260310201307_add_servilex_catalog"
docker compose --profile tools -f docker-compose.prod.yml --env-file .env.production run --rm migrate
```

## Runtime split

- `app`: public site, admin, treasury, checkout, public APIs
- `worker`: email queue, invoice queue, order expiration, Servilex

The web no longer depends on a cron container hitting internal HTTP endpoints.
