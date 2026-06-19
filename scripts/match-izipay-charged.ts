/**
 * Cruza el reporte de transacciones de Izipay (CSV exportado del back office)
 * contra la base de datos para encontrar órdenes COBRADAS-SIN-ENTRADA:
 * transacciones que Izipay aprobó (Estado ABONADA / DEPOSITADA / AUTORIZADA)
 * pero cuya orden en NUESTRA BD no está PAID o no tiene entrada emitida.
 *
 * SOLO LECTURA: no escribe nada. Imprime el listado y comandos sugeridos.
 *
 * Implementa la regla de oro: SOLO considera transacciones realmente cobradas
 * según el reporte de Izipay (la plata recibida); ignora DENEGADA y demás.
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/match-izipay-charged.ts <ruta-al-csv>
 *
 * El CSV se copia al contenedor con: docker cp ReporteTrx.csv fdnda_worker:/tmp/trx.csv
 */
import fs from "node:fs"
import { prisma } from "@/lib/prisma"

// Estados de Izipay que significan "se cobró" (dinero capturado/abonado).
const PAID_STATES = new Set(["ABONADA", "DEPOSITADA", "AUTORIZADA"])

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const u = new URL(url)
        return `${u.protocol}//${u.host}${u.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

// El "Número de pedido" de Izipay = últimos 15 chars alfanuméricos del order.id.
const last15 = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "").slice(-15).toLowerCase()

type CsvRow = {
    orderNumber: string
    monto: number
    estado: string
    txId: string
    userId: string
}

async function main() {
    const csvPath = process.argv[2]
    if (!csvPath) {
        console.error("Uso: tsx scripts/match-izipay-charged.ts <ruta-al-csv>")
        process.exit(1)
    }

    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)

    const raw = fs.readFileSync(csvPath, "utf8")
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)

    // Solo usamos columnas tempranas (antes de los campos de texto libre con
    // posibles comas): 1=pedido, 2=monto, 3=estado, 4=idTransaccion, 5=idComprador.
    const rows: CsvRow[] = []
    const seen = new Set<string>()
    let paidCount = 0
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",")
        const orderNumber = (cols[1] ?? "").trim()
        const monto = Number((cols[2] ?? "").trim())
        const estado = (cols[3] ?? "").trim().toUpperCase()
        const txId = (cols[4] ?? "").trim()
        const userId = (cols[5] ?? "").trim()
        if (!orderNumber) continue
        if (!PAID_STATES.has(estado)) continue
        paidCount++
        if (seen.has(orderNumber.toLowerCase())) continue
        seen.add(orderNumber.toLowerCase())
        rows.push({ orderNumber, monto, estado, txId, userId })
    }

    console.log(`Filas pagadas en CSV: ${paidCount} (pedidos únicos: ${rows.length})`)

    // Cargamos todas las órdenes Izipay una sola vez y armamos índice por nº de pedido.
    const orders = await prisma.order.findMany({
        where: { provider: "IZIPAY" },
        select: {
            id: true,
            status: true,
            totalAmount: true,
            providerOrderNumber: true,
            user: { select: { name: true, email: true } },
            _count: { select: { tickets: true } },
            orderItems: {
                take: 1,
                select: { ticketType: { select: { name: true, event: { select: { title: true, category: true } } } } },
            },
        },
    })

    type OrderRow = (typeof orders)[number]
    const byKey = new Map<string, OrderRow>()
    for (const o of orders) {
        byKey.set(last15(o.id), o)
        if (o.providerOrderNumber) byKey.set(o.providerOrderNumber.toLowerCase(), o)
    }

    const needsRecovery: Array<{ row: CsvRow; order: OrderRow }> = []
    const okPaid: CsvRow[] = []
    const notFound: CsvRow[] = []

    for (const r of rows) {
        const order = byKey.get(r.orderNumber.toLowerCase())
        if (!order) {
            notFound.push(r)
            continue
        }
        const hasTickets = order._count.tickets > 0
        if (order.status === "PAID" && hasTickets) {
            okPaid.push(r)
            continue
        }
        needsRecovery.push({ row: r, order })
    }

    console.log("══════════════════════════════════════════")
    console.log(`✅ Cobradas y con entrada (OK): ${okPaid.length}`)
    console.log(`❓ En CSV pagadas pero la orden no se halló en BD: ${notFound.length}`)
    console.log(`🚨 COBRADAS-SIN-ENTRADA (a recuperar): ${needsRecovery.length}`)
    console.log("══════════════════════════════════════════")

    if (needsRecovery.length > 0) {
        console.log("\n=== ÓRDENES COBRADAS-SIN-ENTRADA ===")
        for (const { row, order } of needsRecovery) {
            const code = order.id.slice(-8).toUpperCase()
            const cat = order.orderItems[0]?.ticketType?.event?.category ?? "-"
            const montoBD = Number(order.totalAmount)
            const mismatch = Number.isFinite(row.monto) && Math.abs(row.monto - montoBD) > 0.01 ? "  ⚠️ MONTO != BD" : ""
            console.log("──────────────────────────────────────────")
            console.log(`  #${code}  ${order.user.name} <${order.user.email}>`)
            console.log(`  CSV: ${row.estado} S/${row.monto}   BD: ${order.status} tickets=${order._count.tickets} S/${montoBD}${mismatch}`)
            console.log(`  Evento: ${order.orderItems[0]?.ticketType?.event?.title ?? "-"} [${cat}]   pedido=${row.orderNumber}  tx=${row.txId}`)
            // Comando sugerido: piscina con cupo posiblemente cerrado -> cortesía
            // (no toca inventario ni boleta). Otros -> recuperación normal.
            if (cat === "PISCINA_LIBRE") {
                console.log(`  → docker exec -it fdnda_worker ./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/grant-courtesy-ticket.ts ${row.orderNumber} --confirm`)
            } else {
                console.log(`  → docker exec -it fdnda_worker ./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/fulfill-order-manual.ts ${row.orderNumber} --confirm --recover-cancelled --ordernum=${row.orderNumber} --txid=${row.txId}`)
            }
        }
    }

    if (notFound.length > 0) {
        console.log("\n=== EN CSV PAGADAS PERO SIN ORDEN EN BD (revisar manual) ===")
        for (const r of notFound) {
            console.log(`  pedido=${r.orderNumber}  ${r.estado} S/${r.monto}  tx=${r.txId}  userId=${r.userId}`)
        }
    }

    console.log("\nNOTA: revisá cada caso antes de emitir. SOLO emití las que confirmes pagadas en tu cuenta.")
}

main()
    .catch((e) => {
        console.error("Error fatal:", e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
