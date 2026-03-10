# Ticketing FDNDA

Sistema de venta de tickets para eventos de la Fundación FDNDA.

**URL Produccion:** https://ticketingfdnda.pe

## Tech Stack

- **Framework:** Next.js 16 (App Router, standalone output)
- **Base de datos:** PostgreSQL 15 + Prisma ORM
- **Autenticacion:** NextAuth.js
- **Estilos:** Tailwind CSS
- **Pagos:** Izipay (redirect y embedded con QR/Yape/Plin)
- **Facturacion:** Servilex/ABIO (boletas y facturas SUNAT)
- **Emails:** Resend (con cola asincrona)
- **Cache:** Upstash Redis
- **Hosting:** Vultr VPS + Docker + Caddy (SSL automatico)

## Arquitectura de Produccion

```
Usuario -> ticketingfdnda.pe -> Caddy (SSL, puertos 80/443)
                                  -> Next.js (app:3000)
                                       ├── PostgreSQL (datos)
                                       ├── Upstash Redis (cache)
                                       ├── Resend (emails)
                                       ├── Izipay (pagos)
                                       └── Servilex (facturas SUNAT)
```

### Contenedores Docker

| Contenedor | Imagen | Funcion |
|------------|--------|---------|
| `fdnda_app` | node:20-alpine (build custom) | App Next.js |
| `fdnda_db` | postgres:15-alpine | Base de datos |
| `fdnda_caddy` | caddy:2-alpine | Reverse proxy + SSL automatico |
| `fdnda_cron` | alpine:3.19 | Jobs programados (emails, facturas, expirar ordenes) |

### Cron Jobs

| Job | Frecuencia | Endpoint |
|-----|------------|----------|
| Procesar emails | Cada 1 min | `/api/cron/process-emails` |
| Procesar facturas | Cada 2 min | `/api/cron/process-invoices` |
| Expirar ordenes | Cada 5 min | `/api/cron/expire-orders` |

## Desarrollo Local

### Requisitos

- Node.js 20+
- Docker y Docker Compose

### Levantar el entorno

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar PostgreSQL y Adminer (dev)
docker compose up -d

# 3. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con tus valores

# 4. Generar Prisma client y correr migraciones
npx prisma generate
npx prisma migrate dev

# 5. Iniciar el servidor de desarrollo
npm run dev
```

La app estara en http://localhost:3000 y Adminer en http://localhost:8080.

## Despliegue en Produccion (Vultr VPS)

### Archivos clave

- `Dockerfile` - Build multi-stage de la app Next.js
- `docker-compose.prod.yml` - Orquestacion de todos los servicios
- `.env.production` - Variables de entorno (NO commitear)
- `Caddyfile` - Configuracion del reverse proxy

### Primer despliegue

```bash
# En el servidor
cd /opt/fdnda-tickets
git clone <repo> .

# Crear .env.production con todas las variables
nano .env.production

# Levantar todo
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Actualizar la web (deploy)

```bash
# 1. Desde tu maquina local: push a GitHub
git add .
git commit -m "descripcion del cambio"
git push

# 2. En el servidor (SSH):
cd /opt/fdnda-tickets
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build app
```

### Solo cambiar variables de entorno

```bash
# Editar .env.production en el servidor
nano /opt/fdnda-tickets/.env.production

# Recrear el contenedor (sin rebuild)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate app
```

### Comandos utiles

```bash
# Ver estado de contenedores
docker compose -f docker-compose.prod.yml --env-file .env.production ps

# Ver logs de la app
docker compose -f docker-compose.prod.yml --env-file .env.production logs app --tail 50 -f

# Health check (desde dentro del contenedor)
docker exec fdnda_app wget -qO- http://127.0.0.1:3000/api/health

# Correr migraciones de Prisma
docker exec fdnda_app npx prisma migrate deploy

# Reiniciar un servicio
docker compose -f docker-compose.prod.yml --env-file .env.production restart app

# Ver logs de Caddy
docker compose -f docker-compose.prod.yml --env-file .env.production logs caddy --tail 50
```

## Variables de Entorno

### Docker Compose (en .env.production)

| Variable | Descripcion |
|----------|-------------|
| `DB_USER` | Usuario de PostgreSQL |
| `DB_PASSWORD` | Password de PostgreSQL |
| `DB_NAME` | Nombre de la base de datos |
| `CRON_SECRET` | Token para autenticar los cron jobs |

### App (en .env.production)

| Variable | Descripcion |
|----------|-------------|
| `NEXTAUTH_SECRET` | Secret para firmar sesiones |
| `NEXTAUTH_URL` | URL publica de la app |
| `RESEND_API_KEY` | API key de Resend para emails |
| `EMAIL_FROM` | Email remitente |
| `IZIPAY_*` | Credenciales de Izipay |
| `SERVILEX_*` | Credenciales de Servilex/ABIO |
| `QR_SECRET` | Secret para generar QR de tickets |
| `UPSTASH_REDIS_*` | Credenciales de Upstash Redis |
| `NEXT_PUBLIC_APP_URL` | URL publica (usada en el frontend) |
| `NEXT_PUBLIC_PAYMENTS_MODE` | Modo de pagos: `mock` o `izipay` |

## Servicios Externos

| Servicio | Uso | Estado |
|----------|-----|--------|
| **Vultr** | VPS con IP estatica | Activo |
| **Resend** | Emails transaccionales | Activo |
| **Upstash Redis** | Cache y cola de emails | Activo |
| **Izipay** | Pasarela de pagos | Sandbox (mock) |
| **Servilex/ABIO** | Facturacion electronica SUNAT | Deshabilitado |
| **Neon** | PostgreSQL cloud (solo para dev/Vercel) | Activo (dev) |
