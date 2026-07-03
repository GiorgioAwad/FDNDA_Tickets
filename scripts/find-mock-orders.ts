/**
 * Identifica órdenes fabricadas por el pago SIMULADO (mock) — sin cobro real y
 * sin número de operación. Vector del incidente 2026-07-03: la build de Vercel
 * (fdnda-tickets.vercel.app) corría con PAYMENTS_MODE=mock apuntando a la BD de
 * PRODUCCIÓN, así que quien entraba por esa URL recibía la entrada al instante
 * (mockIzipayPayment -> fulfillPaidOrder) sin pagar.
 *
 * Firma de una orden mock:
 *   - provider === "MOCK", y/o
 *   - providerRef empieza con "MOCK-", y/o
 *   - providerResponse.mock === true
 *
 * SOLO LECTURA: no escribe nada. Para revertir usar la remediación (aparte).
 *
 * Correr dentro del contenedor worker (tiene la DATABASE_URL de prod):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     exec worker npx tsx scripts/find-mock-orders.ts
 */
import { prisma } from "@/lib/prisma"

function entKey(date: Date): string {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

async function main() {
    console.log(`\n========== ÓRDENES MOCK (pago simulado, sin cobro real) — SOLO LECTURA ==========\n`)

    const orders = await prisma.order.findMany({
        where: {
            OR: [
                { provider: "MOCK" },
                { providerRef: { startsWith: "MOCK-" } },
                { providerResponse: { path: ["mock"], equals: true } },
            ],
        },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            status: true,
            provider: true,
            providerRef: true,
            currency: true,
            totalAmount: true,
            orderType: true,
            paymentNeedsReview: true,
            createdAt: true,
            paidAt: true,
            buyerName: true,
            buyerEmail: true,
            buyerDocNumber: true,
            user: { select: { email: true } },
            tickets: {
                select: {
                    ticketCode: true,
                    status: true,
                    entitlements: {
                        select: { date: true, status: true, usedAt: true },
                    },
                },
            },
            invoices: {
                select: {
                    documentType: true,
                    invoiceNumber: true,
                    status: true,
                    reciboHash: true,
                    traceId: true,
                    issuedAt: true,
                },
            },
        },
    })

    if (orders.length === 0) {
        console.log("✅ No hay órdenes con firma mock en esta base de datos.\n")
        return
    }

    let paidCount = 0
    let activeTicketCount = 0
    let issuedInvoiceCount = 0
    let scannedCount = 0
    let paidAmount = 0

    for (const o of orders) {
        const isPaidLike = o.status === "PAID" || o.paidAt !== null
        if (isPaidLike) {
            paidCount++
            paidAmount += Number(o.totalAmount)
        }
        const activeTickets = o.tickets.filter((t) => t.status === "ACTIVE")
        activeTicketCount += activeTickets.length
        const scanned = o.tickets.some((t) =>
            t.entitlements.some((e) => e.status === "USED" || e.usedAt !== null)
        )
        if (scanned) scannedCount++
        const issued = o.invoices.filter((i) => i.status === "ISSUED")
        issuedInvoiceCount += issued.length

        console.log(
            `#${o.id.slice(-8).toUpperCase()}  ${o.currency} ${o.totalAmount.toString()}  [${o.orderType}]  ` +
                `status=${o.status}  provider=${o.provider}  ${o.paidAt?.toISOString() ?? "sin paidAt"}`
        )
        console.log(`  orderId: ${o.id}`)
        console.log(
            `  Cliente: ${o.buyerName ?? "-"} <${o.user?.email ?? o.buyerEmail ?? "-"}>  doc=${o.buyerDocNumber ?? "-"}`
        )
        console.log(`  providerRef: ${o.providerRef ?? "-"}${o.paymentNeedsReview ? "  (paymentNeedsReview=true)" : ""}`)
        console.log(`  Entradas (${o.tickets.length}):`)
        for (const t of o.tickets) {
            const fechas = t.entitlements
                .map((e) => `${entKey(e.date)}${e.status === "USED" || e.usedAt ? "(USADA)" : ""}`)
                .join(", ")
            console.log(`    · ${t.ticketCode}  [${t.status}]  ${fechas || "sin fechas"}`)
        }
        if (o.invoices.length > 0) {
            console.log(`  Boletas/comprobantes (${o.invoices.length}):`)
            for (const inv of o.invoices) {
                const flag = inv.status === "ISSUED" ? "  <-- EMITIDA: ANULAR EN SUNAT/ABIO (manual)" : ""
                console.log(
                    `    · ${inv.documentType} ${inv.invoiceNumber ?? "(sin nro)"}  [${inv.status}]  ` +
                        `reciboHash=${inv.reciboHash ?? "-"}  trace=${inv.traceId ?? "-"}${flag}`
                )
            }
        } else {
            console.log(`  Boletas/comprobantes: ninguna`)
        }
        if (scanned) console.log(`  ⚠️  TIENE ENTITLEMENT USADO (ya escaneada) — revisar manualmente.`)
        console.log("")
    }

    console.log(`---------------------------------------------------------------`)
    console.log(`Total órdenes con firma mock : ${orders.length}`)
    console.log(`  · PAID / con paidAt        : ${paidCount}  (S/ ${paidAmount.toFixed(2)} sin cobro real)`)
    console.log(`  · Entradas ACTIVE          : ${activeTicketCount}`)
    console.log(`  · Órdenes ya escaneadas    : ${scannedCount}`)
    console.log(`  · Boletas ISSUED (anular)  : ${issuedInvoiceCount}`)
    console.log(`---------------------------------------------------------------\n`)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
