/**
 * SOLO LECTURA: ubica órdenes por DNI/RUC, email, nº de pedido Izipay
 * (providerOrderNumber), nº de transacción (providerTransactionId), o código
 * corto / id de la orden. Pensado para localizar un pago cobrado-sin-entrada y
 * obtener el código que pide `fulfill-order-manual.ts`.
 *
 * No escribe nada en la base ni llama a Izipay.
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/find-order.ts 46803416
 *   tsx scripts/find-order.ts 00601rrm71kt7r1
 *   tsx scripts/find-order.ts cliente@correo.com
 *
 * Acepta varios términos a la vez.
 */
import { prisma } from "@/lib/prisma"

// Las fechas @db.Date se guardan a mediodía UTC del día civil; leer en UTC.
function entKey(date: Date): string {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

async function main() {
    const terms = process.argv.slice(2).map((t) => t.trim()).filter(Boolean)
    if (terms.length === 0) {
        console.error("Uso: tsx scripts/find-order.ts <DNI|email|nroPedidoIzipay|codigo|id>...")
        process.exit(1)
    }

    for (const term of terms) {
        const norm = term.replace(/^#/, "").trim()
        const orders = await prisma.order.findMany({
            where: {
                OR: [
                    { id: norm },
                    { id: { endsWith: norm.toLowerCase() } },
                    { buyerDocNumber: norm },
                    { providerOrderNumber: norm },
                    { providerTransactionId: norm },
                    { user: { email: norm.toLowerCase() } },
                ],
            },
            orderBy: { createdAt: "desc" },
            take: 25,
            select: {
                id: true,
                status: true,
                totalAmount: true,
                currency: true,
                createdAt: true,
                paidAt: true,
                buyerName: true,
                buyerDocNumber: true,
                providerOrderNumber: true,
                providerTransactionId: true,
                paymentNeedsReview: true,
                user: { select: { name: true, email: true } },
                tickets: {
                    select: {
                        ticketCode: true,
                        entitlements: { select: { date: true, status: true }, orderBy: { date: "asc" } },
                    },
                },
                orderItems: {
                    select: {
                        quantity: true,
                        ticketType: { select: { name: true, event: { select: { title: true, category: true } } } },
                    },
                },
            },
        })

        console.log("══════════════════════════════════════════")
        console.log(`Término "${term}" — ${orders.length} órden(es)`)
        for (const o of orders) {
            console.log("──────────────────────────────────────────")
            console.log(`  Código:  #${o.id.slice(-8).toUpperCase()}   (id: ${o.id})`)
            console.log(`  Cliente: ${o.user.name} <${o.user.email}>   doc=${o.buyerDocNumber ?? "-"} (${o.buyerName ?? "-"})`)
            console.log(`  Estado:  ${o.status}   review=${o.paymentNeedsReview}   tickets=${o.tickets.length}`)
            console.log(`  Monto:   ${o.currency} ${o.totalAmount.toString()}   creada=${o.createdAt.toISOString()}   pagada=${o.paidAt?.toISOString() ?? "-"}`)
            console.log(`  Izipay:  pedido=${o.providerOrderNumber ?? "-"}   tx=${o.providerTransactionId ?? "-"}`)
            for (const it of o.orderItems) {
                const ev = it.ticketType?.event
                console.log(`    - ${it.quantity}x ${it.ticketType?.name ?? "(merch)"} — ${ev?.title ?? ""} [${ev?.category ?? "-"}]`)
            }
            if (o.tickets.length > 0) {
                console.log(`  Entradas emitidas (${o.tickets.length}) y sus fechas habilitadas:`)
                for (const t of o.tickets) {
                    const fechas = t.entitlements
                        .map((e) => `${entKey(e.date)}${e.status === "USED" ? "(usada)" : ""}`)
                        .join(", ") || "(sin entitlements)"
                    console.log(`    · ${t.ticketCode}: ${fechas}`)
                }
            }
        }
    }
}

main()
    .catch((e) => {
        console.error("Error fatal:", e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
