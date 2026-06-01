/**
 * Seed para stress test de COMPRA MASIVA (on-sale spike).
 *
 * Crea de forma idempotente:
 *   - 1 evento de prueba publico (slug: stress-purchase-event)
 *   - 1 tipo de entrada simple con stock enorme (sin Servilex, sin validDays)
 *   - N usuarios de prueba (email stress+<i>@loadtest.local) con password fijo
 *
 * Todo queda marcado para cleanup: email domain @loadtest.local y el slug.
 * NO crea ordenes ni toca pagos. Seguro de re-correr.
 *
 * Ejecucion (en el VPS, dentro del contenedor que tiene Prisma + bcryptjs):
 *   docker cp scripts/stress/seed-purchase-stress.mjs fdnda_worker:/app/seed.mjs
 *   docker exec -e STRESS_USERS=300 fdnda_worker node /app/seed.mjs
 *
 * Imprime al final un JSON con { eventId, ticketTypeId, password, userCount }.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const USER_COUNT = Number(process.env.STRESS_USERS || 300)
const PASSWORD = process.env.STRESS_PASSWORD || "StressTest123!"
const EMAIL_DOMAIN = "loadtest.local"
const EVENT_SLUG = "stress-purchase-event"
const TICKET_NAME = "Stress General"
const STOCK = Number(process.env.STRESS_STOCK || 1_000_000)

async function main() {
    console.error(`[seed] hashing password (bcrypt 12)...`)
    const passwordHash = await bcrypt.hash(PASSWORD, 12)

    // --- usuarios de prueba (bulk, idempotente) ---
    console.error(`[seed] creando ${USER_COUNT} usuarios de prueba...`)
    const usersData = Array.from({ length: USER_COUNT }, (_, i) => ({
        name: `Stress User ${i}`,
        email: `stress+${i}@${EMAIL_DOMAIN}`,
        passwordHash,
        role: "USER",
        emailVerifiedAt: new Date(),
    }))
    await prisma.user.createMany({ data: usersData, skipDuplicates: true })

    // creador del evento: el primer usuario de prueba
    const creator = await prisma.user.findUnique({
        where: { email: `stress+0@${EMAIL_DOMAIN}` },
        select: { id: true },
    })
    if (!creator) throw new Error("No se pudo crear/encontrar el usuario creador")

    // --- evento de prueba (upsert por slug) ---
    console.error(`[seed] upsert evento ${EVENT_SLUG}...`)
    const now = Date.now()
    const start = new Date(now + 30 * 24 * 3600 * 1000)
    const end = new Date(now + 31 * 24 * 3600 * 1000)
    const event = await prisma.event.upsert({
        where: { slug: EVENT_SLUG },
        update: { isPublished: true, visibility: "PUBLIC", endDate: end },
        create: {
            slug: EVENT_SLUG,
            title: "Stress Purchase Event (NO publicar)",
            description: "Evento de carga para stress test de compra. Borrar tras la prueba.",
            location: "Lima",
            venue: "Sede de Pruebas",
            startDate: start,
            endDate: end,
            isPublished: true,
            visibility: "PUBLIC",
            category: "EVENTO",
            mode: "RANGE",
            discipline: "Natación",
            createdBy: creator.id,
        },
        select: { id: true },
    })

    // --- ticket type simple con stock enorme ---
    let ticket = await prisma.ticketType.findFirst({
        where: { eventId: event.id, name: TICKET_NAME },
        select: { id: true },
    })
    if (!ticket) {
        console.error(`[seed] creando ticket type "${TICKET_NAME}" (stock ${STOCK})...`)
        ticket = await prisma.ticketType.create({
            data: {
                eventId: event.id,
                name: TICKET_NAME,
                description: "Entrada de prueba para stress",
                price: 10.0,
                currency: "PEN",
                capacity: STOCK,
                sold: 0,
                isActive: true,
                servilexEnabled: false,
                sortOrder: 0,
            },
            select: { id: true },
        })
    } else {
        // resetear stock por si se re-corre
        await prisma.ticketType.update({
            where: { id: ticket.id },
            data: { capacity: STOCK, sold: 0, isActive: true },
        })
    }

    const out = {
        eventId: event.id,
        ticketTypeId: ticket.id,
        slug: EVENT_SLUG,
        password: PASSWORD,
        emailDomain: EMAIL_DOMAIN,
        userCount: USER_COUNT,
        stock: STOCK,
    }
    console.error(`[seed] LISTO. Copia el JSON de abajo y pasalo al asistente:`)
    console.log(JSON.stringify(out))
}

main()
    .catch((e) => {
        console.error("[seed] ERROR:", e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
