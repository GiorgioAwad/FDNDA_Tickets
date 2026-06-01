/**
 * Cleanup del stress test de compra masiva.
 * Borra: ordenes (y orderItems) de los usuarios de prueba, el evento de prueba
 * (con sus ticket types via cascade) y los usuarios @loadtest.local.
 *
 * Ejecucion (en el VPS):
 *   docker cp scripts/stress/cleanup-purchase-stress.mjs fdnda_worker:/app/cleanup.mjs
 *   docker exec fdnda_worker node /app/cleanup.mjs
 */
import { PrismaClient } from "@prisma/client"

// Prisma 7 exige driver adapter (igual que src/lib/prisma.ts).
async function makePrisma() {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL no definido en el entorno")
    if (process.env.PRISMA_DATABASE_ADAPTER === "neon") {
        const { PrismaNeon } = await import("@prisma/adapter-neon")
        const { neonConfig } = await import("@neondatabase/serverless")
        const ws = (await import("ws")).default
        neonConfig.webSocketConstructor = ws
        return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) })
    }
    const { PrismaPg } = await import("@prisma/adapter-pg")
    const { Pool } = await import("pg")
    return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
}

const prisma = await makePrisma()
const EMAIL_DOMAIN = "loadtest.local"
const EVENT_SLUG = "stress-purchase-event"

async function main() {
    const users = await prisma.user.findMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
        select: { id: true },
    })
    const userIds = users.map((u) => u.id)
    console.error(`[cleanup] ${userIds.length} usuarios de prueba`)

    if (userIds.length) {
        const orders = await prisma.order.findMany({
            where: { userId: { in: userIds } },
            select: { id: true },
        })
        const orderIds = orders.map((o) => o.id)
        console.error(`[cleanup] ${orderIds.length} ordenes de prueba`)
        if (orderIds.length) {
            await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
            await prisma.discountUsage.deleteMany({ where: { orderId: { in: orderIds } } })
            // tickets emitidos (por si algun pago mock completo)
            await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
            await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
        }
    }

    // evento de prueba (cascade borra ticketTypes)
    const ev = await prisma.event.findUnique({ where: { slug: EVENT_SLUG }, select: { id: true } })
    if (ev) {
        await prisma.event.delete({ where: { id: ev.id } })
        console.error(`[cleanup] evento ${EVENT_SLUG} borrado`)
    }

    if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } })
        console.error(`[cleanup] ${userIds.length} usuarios borrados`)
    }
    console.error("[cleanup] LISTO")
}

main()
    .catch((e) => {
        console.error("[cleanup] ERROR:", e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
