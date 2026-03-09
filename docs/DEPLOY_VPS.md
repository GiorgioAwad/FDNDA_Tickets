# 🚀 Guía de Despliegue en VPS - fdnda-tickets

## Arquitectura

```
Internet → Caddy (SSL :443) → Next.js App (:3000) → PostgreSQL (:5432)
                                    ↕
                              Cron Container (emails, invoices, orders)
```

**IP estática del VPS** → se la das a Servilex para su whitelist.

---

## Paso 1: Alquilar el VPS

### Opciones recomendadas:

| Proveedor   | Plan          | RAM  | CPU   | Precio/mes |
|-------------|---------------|------|-------|------------|
| **Hetzner** | CX22          | 4 GB | 2 vCPU | ~€4.51     |
| DigitalOcean| Basic Droplet | 2 GB | 1 vCPU | $6.00      |
| Contabo     | VPS S SSD     | 8 GB | 4 vCPU | €6.50      |

**Recomendación**: Hetzner CX22 (mejor relación calidad-precio).

### Al crear el VPS:
- **OS**: Ubuntu 22.04 o 24.04 LTS
- **Región**: La más cercana a tus usuarios (ej: Ashburn, São Paulo)
- **SSH Key**: Agrega tu clave SSH para acceso seguro
- **Anota la IP pública** (ej: `65.108.XX.XX`)

---

## Paso 2: Configurar el dominio DNS

En tu panel de dominio (GoDaddy, Cloudflare, Namecheap, etc.):

```
Tipo    Nombre                Valor              TTL
A       tickets               65.108.XX.XX       300
A       www.tickets           65.108.XX.XX       300
CNAME   @                     tickets.fdnda.org.pe  (si aplica)
```

> Reemplaza `65.108.XX.XX` con la IP real de tu VPS.
> Reemplaza `tickets.fdnda.org.pe` con tu dominio real.

---

## Paso 3: Preparar el VPS

Conéctate por SSH:

```bash
ssh root@65.108.XX.XX
```

### Instalar Docker:

```bash
# Actualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose plugin
apt install docker-compose-plugin -y

# Verificar instalación
docker --version
docker compose version
```

### Crear usuario para la app (opcional pero recomendado):

```bash
adduser fdnda
usermod -aG docker fdnda
su - fdnda
```

### Crear directorio del proyecto:

```bash
mkdir -p ~/fdnda-tickets
cd ~/fdnda-tickets
```

---

## Paso 4: Subir el código al VPS

### Opción A: Git clone (recomendada)

```bash
# En el VPS
cd ~/fdnda-tickets
git clone https://github.com/GiorgioAwad/fdnda-tickets.git .
```

### Opción B: SCP desde tu máquina local

```powershell
# Desde tu PC Windows
scp -r "G:\COMERCIAL FDNDA\Eventos Web\fdnda-tickets\*" root@65.108.XX.XX:~/fdnda-tickets/
```

---

## Paso 5: Configurar variables de entorno

```bash
cd ~/fdnda-tickets

# Copiar el ejemplo
cp env.production.example .env.production

# Editar con tus valores reales
nano .env.production
```

### Generar secretos seguros:

```bash
# Para NEXTAUTH_SECRET
openssl rand -base64 32

# Para CRON_SECRET
openssl rand -hex 32

# Para QR_SECRET
openssl rand -hex 32

# Para DB_PASSWORD
openssl rand -base64 24
```

### Valores que DEBES cambiar:

| Variable | Qué poner |
|----------|-----------|
| `DB_PASSWORD` | Contraseña fuerte generada |
| `NEXT_PUBLIC_APP_URL` | `https://tickets.fdnda.org.pe` (tu dominio) |
| `NEXTAUTH_URL` | Igual que NEXT_PUBLIC_APP_URL |
| `NEXTAUTH_SECRET` | Generado con openssl |
| `QR_SECRET` | Generado con openssl |
| `CRON_SECRET` | Generado con openssl |
| `RESEND_API_KEY` | Tu API key de Resend |
| `SERVILEX_TOKEN` | Token proporcionado por Servilex |
| `UPSTASH_REDIS_REST_URL` | URL de tu instancia Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Token de Upstash |

---

## Paso 6: Configurar Caddy (dominio)

```bash
nano Caddyfile
```

Cambia `tickets.fdnda.org.pe` por tu dominio real. Caddy genera el certificado SSL automáticamente.

---

## Paso 7: Construir y levantar todo

```bash
cd ~/fdnda-tickets

# Construir la imagen de la app (primera vez tarda ~3-5 min)
docker compose -f docker-compose.prod.yml build

# Levantar todos los servicios
docker compose -f docker-compose.prod.yml up -d

# Ver logs en tiempo real
docker compose -f docker-compose.prod.yml logs -f
```

### Verificar que todo está corriendo:

```bash
docker compose -f docker-compose.prod.yml ps
```

Deberías ver 4 contenedores: `fdnda_db`, `fdnda_app`, `fdnda_caddy`, `fdnda_cron`.

---

## Paso 8: Aplicar migraciones y crear admin

```bash
# Ejecutar migraciones
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# Crear usuario admin (ajusta email y contraseña)
docker compose -f docker-compose.prod.yml exec app node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash('Admin123!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'admin@fdnda.org.pe' },
    update: { passwordHash: hash, role: 'ADMIN' },
    create: {
      name: 'Administrador FDNDA',
      email: 'admin@fdnda.org.pe',
      passwordHash: hash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('Admin:', user.email, user.role);
  await prisma.\$disconnect();
})();
"
```

---

## Paso 9: Verificar el despliegue

```bash
# Health check
curl -s https://tickets.fdnda.org.pe/api/health | python3 -m json.tool

# Verificar SSL
curl -sI https://tickets.fdnda.org.pe | head -5
```

Abre tu navegador en `https://tickets.fdnda.org.pe` y verifica que todo funciona.

---

## Paso 10: Dar la IP a Servilex

1. Obtén la IP pública de tu VPS:
   ```bash
   curl -s ifconfig.me
   ```

2. Envíala a Servilex/ABIO para que la agreguen a su whitelist.

3. Una vez confirmada, activa en `.env.production`:
   ```
   SERVILEX_ENABLED=true
   ```

4. Reconstruir:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build app
   ```

---

## Mantenimiento

### Actualizar la app (tras push a GitHub):

```bash
cd ~/fdnda-tickets
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
```

### Ver logs:

```bash
# Todos los servicios
docker compose -f docker-compose.prod.yml logs -f

# Solo la app
docker compose -f docker-compose.prod.yml logs -f app

# Solo cron
docker compose -f docker-compose.prod.yml logs -f cron
```

### Backup de base de datos:

```bash
# Crear backup
docker compose -f docker-compose.prod.yml exec db pg_dump -U fdnda fdnda_tickets > backup_$(date +%Y%m%d).sql

# Restaurar backup
docker compose -f docker-compose.prod.yml exec -T db psql -U fdnda fdnda_tickets < backup_20260309.sql
```

### Reiniciar servicios:

```bash
docker compose -f docker-compose.prod.yml restart app
docker compose -f docker-compose.prod.yml restart caddy
```

### Monitorear recursos:

```bash
docker stats
```

---

## Migración desde Neon (si dejas de usar Neon)

Si quieres mover los datos de Neon al PostgreSQL del VPS:

```bash
# Exportar de Neon
pg_dump "postgresql://user:pass@neon-host/neondb?sslmode=require" > neon_export.sql

# Importar al VPS
docker compose -f docker-compose.prod.yml exec -T db psql -U fdnda fdnda_tickets < neon_export.sql
```

---

## Firewall (UFW)

```bash
# Permitir solo SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

---

## Backup automático (cron del sistema)

```bash
# Editar crontab del sistema
crontab -e

# Agregar backup diario a las 3am
0 3 * * * cd /root/fdnda-tickets && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U fdnda fdnda_tickets | gzip > /root/backups/fdnda_$(date +\%Y\%m\%d).sql.gz && find /root/backups -name "*.gz" -mtime +30 -delete
```

```bash
# Crear directorio de backups
mkdir -p /root/backups
```
