# 🚀 FDNDA Tickets - Checklist Completo del Sistema

## 📊 Estado Actual del Sistema (Actualizado: 01 Feb 2026)

---

## ✅ FUNCIONALIDADES IMPLEMENTADAS

### 🎫 Core - Venta de Entradas
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Listado de eventos públicos | ✅ | `/eventos` |
| Página de evento con tipos de entrada | ✅ | `/eventos/[slug]` |
| Carrito de compras | ✅ | Persistente en localStorage |
| Checkout con datos de asistentes | ✅ | `/checkout` |
| Pagos Mock (desarrollo) | ✅ | Simulador para pruebas |
| Pagos Izipay (producción) | ✅ | Webhook implementado |
| Generación de tickets con QR | ✅ | HMAC-SHA256 firmado |
| Email de confirmación | ✅ | Con tickets adjuntos |
| Historial de compras del usuario | ✅ | `/mi-cuenta/entradas` |

### 🎁 Sistema de Cortesías
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Generación de lotes de cortesías | ✅ | Admin panel |
| Códigos de canje únicos | ✅ | 8 caracteres |
| Pre-asignación de asistentes (nombre/DNI) | ✅ | Opcional por entrada |
| Canje de cortesías en página de evento | ✅ | Integrado en TicketPurchaseCard |
| Página dedicada de canje | ✅ | `/canjear` |
| Vista de detalle de lotes | ✅ | Modal con estado de cada código |
| Historial de lotes | ✅ | Admin panel |

### 💰 Sistema de Descuentos
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Códigos porcentuales | ✅ | Ej: 20% off |
| Códigos de monto fijo | ✅ | Ej: S/ 50 off |
| Límite de usos totales | ✅ | Configurable |
| Límite de usos por usuario | ✅ | Configurable |
| Monto mínimo de compra | ✅ | Opcional |
| Fecha de validez (desde/hasta) | ✅ | Opcional |
| Activar/desactivar código | ✅ | Toggle |
| Aplicación en checkout | ✅ | Campo de código |
| Registro de uso (DiscountUsage) | ✅ | Con monto ahorrado |

### 📱 Scanner de Entradas
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Scanner por cámara (QR) | ✅ | `/scanner` |
| Búsqueda manual por código | ✅ | Fallback |
| Validación de firma QR | ✅ | HMAC-SHA256 |
| Registro de escaneos | ✅ | Con fecha/hora |
| Soporte multi-día | ✅ | Entitlements por día |
| Rate limiting scanner | ✅ | 300/min |

### 👤 Gestión de Usuarios
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Registro con verificación email | ✅ | Token 24h |
| Login con email/password | ✅ | bcrypt factor 12 |
| Recuperar contraseña | ✅ | Via email |
| Perfil de usuario editable | ✅ | `/mi-cuenta` |
| Roles (USER/STAFF/ADMIN) | ✅ | JWT |

### 📊 Panel Admin
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Dashboard resumen | ✅ | `/admin` |
| CRUD de eventos | ✅ | `/admin/eventos` |
| Gestión de tipos de entrada | ✅ | Dentro de cada evento |
| Gestión de días de evento | ✅ | EventDaysManager |
| Vista de asistentes por evento | ✅ | Con filtros |
| Exportar lista de asistentes | ✅ | CSV/Excel |
| Vista de ingresos | ✅ | `/admin/ingresos` |
| Detalle de órdenes | ✅ | Modal con tickets |
| Gestión de cortesías | ✅ | `/admin/cortesias` |
| Gestión de descuentos | ✅ | Tab en cortesías |
| Reportes de ventas | ✅ | `/admin/reportes` |

### 🔒 Seguridad
| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Rate limiting (Upstash Redis) | ✅ | Login, API, pagos, scanner |
| Security headers | ✅ | HSTS, CSP, XSS |
| Health check endpoint | ✅ | `/api/health` |
| Protección contra sobreventa | ✅ | Transacciones atómicas |
| Validación de inputs (Zod) | ✅ | Todas las APIs |
| Middleware de autenticación | ✅ | Rutas protegidas |

---

## ⚠️ PENDIENTE / POR MEJORAR

### 🔴 Alta Prioridad
| Item | Descripción | Impacto |
|------|-------------|---------|
| Integración Izipay real | Solo hay webhook, falta form de pago | Producción |
| Manejo de órdenes pendientes | Limpiar órdenes PENDING antiguas | Integridad datos |
| Reenvío de tickets por email | Botón para reenviar confirmación | UX |

### 🟡 Media Prioridad
| Item | Descripción | Impacto |
|------|-------------|---------|
| Facturación electrónica | No implementado | Fiscal |
| Notificaciones push | No implementado | Marketing |
| Dashboard en tiempo real | Gráficos no son live | Admin UX |
| Exportar descuentos a CSV | Solo visual | Admin |
| Búsqueda global admin | No hay search bar | Admin UX |

### 🟢 Baja Prioridad / Nice to Have
| Item | Descripción | Impacto |
|------|-------------|---------|
| Dark mode | Solo light | UX |
| PWA / Offline | No implementado | Mobile |
| Multi-idioma (i18n) | Solo español | Alcance |
| Tickets con diseño personalizable | Template fijo | Branding |
| Historial de cambios (audit log) | No implementado | Trazabilidad |

---

## 🔧 Variables de Entorno Requeridas

```env
# === BASE DE DATOS ===
DATABASE_URL="postgresql://..."

# === AUTENTICACIÓN ===
NEXTAUTH_SECRET="generar-32-chars-minimo"
NEXTAUTH_URL="https://tu-dominio.com"
AUTH_TRUST_HOST=true

# === EMAIL ===
RESEND_API_KEY="re_xxxxx"
EMAIL_FROM="Eventos <tickets@tu-dominio.com>"

# === IZIPAY ===
IZIPAY_MERCHANT_CODE="tu-merchant"
IZIPAY_API_KEY="tu-api-key"
IZIPAY_HASH_KEY="tu-hash-key"
IZIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."
IZIPAY_ENDPOINT="https://api.izipay.pe"  # Producción

# === PAGOS ===
PAYMENTS_MODE="izipay"  # o "mock" para dev
NEXT_PUBLIC_PAYMENTS_MODE="izipay"

# === SEGURIDAD ===
QR_SECRET="minimo-32-caracteres-para-hmac"

# === RATE LIMITING ===
UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="xxx"

# === APP ===
NEXT_PUBLIC_APP_URL="https://tu-dominio.com"
NEXT_PUBLIC_APP_NAME="FDNDA Tickets"
```

---

## ✅ Checklist Pre-Deploy Producción

### Configuración
- [ ] Actualizar DATABASE_URL a Neon producción
- [ ] Generar nuevo NEXTAUTH_SECRET
- [ ] Generar nuevo QR_SECRET
- [ ] Configurar Upstash Redis
- [ ] Cambiar PAYMENTS_MODE a "izipay"
- [ ] Verificar credenciales Izipay son de producción
- [ ] Configurar dominio SSL

### Testing
- [ ] Probar registro de usuario
- [ ] Probar verificación de email
- [ ] Probar compra completa (mock)
- [ ] Probar generación de cortesía
- [ ] Probar canje de cortesía
- [ ] Probar scanner QR
- [ ] Probar aplicar descuento
- [ ] Verificar /api/health

### Monitoreo
- [ ] Configurar alertas health check
- [ ] Revisar logs de errores
- [ ] Monitorear uso de conexiones DB

---

## 📈 Métricas del Sistema

| Métrica | Límite Actual | Recomendación |
|---------|--------------|---------------|
| Conexiones DB | 20 (free) | Upgrade a 100 (Launch) |
| Rate limit login | 5/min | Suficiente |
| Rate limit API | 100/min | Suficiente |
| Rate limit scanner | 300/min | Ajustar si hay más staff |
| Rate limit pagos | 10/min | Suficiente |

---

*Última actualización: 01 de Febrero 2026*

