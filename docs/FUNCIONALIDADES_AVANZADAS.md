# Funcionalidades Avanzadas - FDNDA Tickets

## 1. 🧾 Facturación Electrónica (Perú - SUNAT)

### Opciones de Implementación

#### Opción A: Integrar con un OSE (Operador de Servicios Electrónicos)
Los OSE son empresas autorizadas por SUNAT para validar y enviar comprobantes electrónicos.

**Proveedores recomendados:**
1. **NUBEFACT** (más popular en Perú)
   - API REST fácil de integrar
   - Precio: desde S/0.15 por documento
   - Web: https://nubefact.com/

2. **EFACT**
   - Integración con varios ERPs
   - Web: https://efact.pe/

3. **GREENTER** (open source)
   - Librería PHP gratuita
   - Requiere más configuración técnica
   - GitHub: https://github.com/thegreenter/greenter

#### Implementación con NUBEFACT (Recomendado)

```typescript
// src/lib/facturacion.ts
interface FacturaData {
  tipo_documento: "FACTURA" | "BOLETA"
  serie: string
  numero: number
  cliente: {
    tipo_documento: "DNI" | "RUC"
    numero_documento: string
    razon_social: string
    direccion?: string
  }
  items: {
    descripcion: string
    cantidad: number
    precio_unitario: number
    igv: number
  }[]
  total: number
}

async function emitirComprobante(data: FacturaData) {
  const response = await fetch("https://api.nubefact.com/api/v1/documento", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.NUBEFACT_TOKEN}`
    },
    body: JSON.stringify({
      operacion: "generar_comprobante",
      tipo_de_comprobante: data.tipo_documento === "BOLETA" ? 2 : 1,
      serie: data.serie,
      numero: data.numero,
      sunat_transaction: 1, // Venta
      cliente_tipo_de_documento: data.cliente.tipo_documento === "DNI" ? 1 : 6,
      cliente_numero_de_documento: data.cliente.numero_documento,
      cliente_denominacion: data.cliente.razon_social,
      cliente_direccion: data.cliente.direccion || "",
      moneda: 1, // Soles
      porcentaje_de_igv: 18,
      total_gravada: data.total / 1.18,
      total_igv: data.total - (data.total / 1.18),
      total: data.total,
      items: data.items.map((item, i) => ({
        unidad_de_medida: "NIU",
        codigo: `TICKET-${i + 1}`,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        valor_unitario: item.precio_unitario / 1.18,
        precio_unitario: item.precio_unitario,
        igv: item.precio_unitario - (item.precio_unitario / 1.18),
        subtotal: item.cantidad * item.precio_unitario / 1.18,
        total: item.cantidad * item.precio_unitario,
      }))
    })
  })
  
  return response.json()
}
```

#### Flujo de Facturación:
1. Usuario completa compra y selecciona tipo de comprobante (Boleta/Factura)
2. Si es Factura, solicitar RUC y razón social
3. Al confirmar pago, emitir comprobante vía API del OSE
4. Guardar respuesta (PDF, XML, CDR) en la base de datos
5. Enviar por email al cliente

### Costos aproximados:
- Registro OSE: S/0 - S/500 (único)
- Por comprobante: S/0.10 - S/0.20
- Mensualidad: S/50 - S/200 (según volumen)

---

## 2. 🔔 Notificaciones Push

### Opciones de Implementación

#### Opción A: Firebase Cloud Messaging (FCM) - RECOMENDADO
- Gratis hasta millones de mensajes
- Soporta Web y Mobile
- Fácil integración con Next.js

#### Opción B: OneSignal
- Interfaz visual para campañas
- Plan gratis hasta 10,000 suscriptores

#### Opción C: Pusher / Ably
- Para notificaciones en tiempo real
- Basado en WebSockets

### Implementación con Firebase (Web Push)

#### 1. Configurar Firebase:
```bash
npm install firebase
```

```typescript
// src/lib/firebase.ts
import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, onMessage } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export async function requestNotificationPermission() {
  const messaging = getMessaging(app)
  
  try {
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
      })
      
      // Guardar token en base de datos vinculado al usuario
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ token })
      })
      
      return token
    }
  } catch (error) {
    console.error('Error getting notification permission:', error)
  }
}

export function onMessageListener() {
  const messaging = getMessaging(app)
  return new Promise((resolve) => {
    onMessage(messaging, (payload) => {
      resolve(payload)
    })
  })
}
```

#### 2. Service Worker (public/firebase-messaging-sw.js):
```javascript
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: "...",
  projectId: "...",
  messagingSenderId: "...",
  appId: "..."
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification
  self.registration.showNotification(title, {
    body,
    icon: icon || '/logo.png',
    badge: '/logo.png'
  })
})
```

#### 3. Enviar notificaciones desde el servidor:
```typescript
// src/lib/push-notifications.ts
import admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  })
}

interface NotificationPayload {
  title: string
  body: string
  icon?: string
  data?: Record<string, string>
}

export async function sendPushNotification(
  tokens: string[], 
  notification: NotificationPayload
) {
  const message = {
    notification: {
      title: notification.title,
      body: notification.body,
      icon: notification.icon || '/logo.png'
    },
    data: notification.data || {},
    tokens
  }
  
  const response = await admin.messaging().sendEachForMulticast(message)
  return response
}

// Ejemplo: Notificar sobre evento próximo
export async function notifyUpcomingEvent(eventId: string) {
  const tickets = await prisma.ticket.findMany({
    where: { eventId, status: 'ACTIVE' },
    include: { 
      user: { 
        include: { pushTokens: true } 
      },
      event: true
    }
  })
  
  const tokens = tickets
    .flatMap(t => t.user.pushTokens.map(pt => pt.token))
    .filter(Boolean)
  
  if (tokens.length > 0) {
    await sendPushNotification(tokens, {
      title: '¡Tu evento es mañana! 🎉',
      body: `Recuerda que tienes entradas para ${tickets[0].event.title}`,
      data: { eventId, url: `/mi-cuenta/entradas` }
    })
  }
}
```

### Casos de uso para notificaciones:
- ✅ Confirmación de compra
- 🎫 Recordatorio 24h antes del evento
- 📍 Cuando llega al venue (geolocalización)
- 🆕 Nuevos eventos de disciplinas favoritas
- 💰 Ofertas y descuentos especiales
- ⚠️ Cambios en eventos (horario, venue, etc.)

---

## 3. 📊 Dashboard en Tiempo Real

### Tecnologías recomendadas:

#### Opción A: Pusher (WebSockets as a Service)
- Fácil de implementar
- Precio: Plan gratis hasta 200K mensajes/día

#### Opción B: Socket.io
- Open source, más control
- Requiere servidor propio

#### Opción C: Server-Sent Events (SSE)
- Nativo del navegador
- Solo unidireccional (servidor → cliente)
- Gratis, sin dependencias

### Implementación con Pusher (Recomendado)

```bash
npm install pusher pusher-js
```

#### 1. Configurar Pusher Server:
```typescript
// src/lib/pusher.ts
import Pusher from 'pusher'

export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true
})

// Emitir evento cuando hay nueva venta
export async function broadcastNewSale(sale: {
  eventId: string
  amount: number
  ticketCount: number
}) {
  await pusherServer.trigger('admin-dashboard', 'new-sale', sale)
}

// Emitir evento cuando se escanea entrada
export async function broadcastScan(scan: {
  eventId: string
  ticketCode: string
  attendeeName: string
}) {
  await pusherServer.trigger(`event-${scan.eventId}`, 'new-scan', scan)
}
```

#### 2. Cliente React con Pusher:
```typescript
// src/hooks/use-realtime-dashboard.ts
'use client'
import { useEffect, useState } from 'react'
import Pusher from 'pusher-js'

interface DashboardStats {
  todaySales: number
  todayTickets: number
  activeScans: number
  recentSales: Sale[]
}

export function useRealtimeDashboard(initialData: DashboardStats) {
  const [stats, setStats] = useState(initialData)

  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!
    })

    const channel = pusher.subscribe('admin-dashboard')

    channel.bind('new-sale', (data: Sale) => {
      setStats(prev => ({
        ...prev,
        todaySales: prev.todaySales + data.amount,
        todayTickets: prev.todayTickets + data.ticketCount,
        recentSales: [data, ...prev.recentSales].slice(0, 10)
      }))
    })

    channel.bind('new-scan', () => {
      setStats(prev => ({
        ...prev,
        activeScans: prev.activeScans + 1
      }))
    })

    return () => {
      channel.unbind_all()
      channel.unsubscribe()
      pusher.disconnect()
    }
  }, [])

  return stats
}
```

#### 3. Dashboard Component:
```tsx
// src/app/admin/dashboard/RealtimeDashboard.tsx
'use client'
import { useRealtimeDashboard } from '@/hooks/use-realtime-dashboard'
import { Card } from '@/components/ui/card'
import { formatPrice } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

export function RealtimeDashboard({ initialData }) {
  const stats = useRealtimeDashboard(initialData)

  return (
    <div className="space-y-6">
      {/* Stats con animación */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Ventas Hoy</p>
          <motion.p 
            key={stats.todaySales}
            initial={{ scale: 1.2, color: '#22c55e' }}
            animate={{ scale: 1, color: '#000' }}
            className="text-2xl font-bold"
          >
            {formatPrice(stats.todaySales)}
          </motion.p>
        </Card>
        {/* ... más stats */}
      </div>

      {/* Feed de ventas en tiempo real */}
      <Card className="p-4">
        <h3 className="font-bold mb-4">Ventas Recientes</h3>
        <AnimatePresence>
          {stats.recentSales.map((sale) => (
            <motion.div
              key={sale.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="p-3 border-b"
            >
              <p>{sale.userName} - {formatPrice(sale.amount)}</p>
              <p className="text-xs text-gray-500">{sale.eventTitle}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </Card>
    </div>
  )
}
```

### Qué mostrar en tiempo real:
- 💰 Contador de ventas del día (animado)
- 🎫 Entradas vendidas (con +1 animado)
- 📍 Mapa de escaneos en vivo (durante evento)
- 👥 Asistentes ingresados vs total
- 🔔 Feed de actividad reciente
- 📈 Gráfico de ventas que se actualiza

---

## Resumen de Costos Mensuales Estimados

| Funcionalidad | Servicio | Costo Estimado |
|--------------|----------|----------------|
| Facturación | NUBEFACT | S/50-150/mes |
| Push Notifications | Firebase | Gratis* |
| Dashboard Real-time | Pusher | Gratis** |

*Firebase FCM es gratis para volúmenes normales
**Pusher gratis hasta 200K mensajes/día

## Prioridad de Implementación Sugerida

1. **Notificaciones Push** (1-2 días)
   - Alto impacto en UX
   - Gratis
   - Mejora engagement

2. **Dashboard en Tiempo Real** (2-3 días)
   - Valor para administradores
   - Bajo costo

3. **Facturación Electrónica** (3-5 días)
   - Requisito legal para empresas
   - Requiere registro en SUNAT
   - Más complejo de implementar

---

## Próximos Pasos

Para implementar cualquiera de estas funcionalidades, necesitarás:

1. **Push Notifications:**
   - Crear proyecto en Firebase Console
   - Configurar Web Push certificates
   - Agregar modelo `PushToken` en Prisma

2. **Dashboard Real-time:**
   - Crear cuenta en Pusher
   - Configurar channels y eventos
   - Modificar APIs de venta/escaneo para emitir eventos

3. **Facturación:**
   - Registrar empresa en SUNAT
   - Contratar servicio OSE
   - Obtener certificado digital
   - Configurar series de comprobantes
