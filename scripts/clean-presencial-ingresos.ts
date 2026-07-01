/**
 * Limpia los "ingresos" del dashboard para las órdenes PRESENCIAL de un lote:
 * pone totalAmount / unitPrice / subtotal en 0 porque NO fueron ingresos web
 * (se pagaron por Caja/Transferencia). NO toca el carnet: la orden sigue PAID y
 * los tickets siguen ACTIVE, así que el socio conserva su QR/horario.
 *
 * También VERIFICA que ninguna de esas órdenes tenga comprobante (Invoice)
 * emitido; si encuentra alguno, ABORTA (no toca nada) para que lo revises.
 *
 * DRY-RUN por defecto.
 *
 * Uso:
 *   tsx --env-file=.env scripts/clean-presencial-ingresos.ts --batch=membresias-2026
 *   tsx --env-file=.env scripts/clean-presencial-ingresos.ts --batch=membresias-2026 --confirm
 */
import { prisma } from "@/lib/prisma"

function parseArgs(argv: string[]) {
    const flags: Record<string, string | boolean> = {}
    for (const arg of argv) {
        if (arg.startsWith("--")) {
            const [k, ...rest] = arg.slice(2).split("=")
            flags[k] = rest.length ? rest.join("=") : true
        }
    }
    return flags
}

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const parsed = new URL(url)
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

async function main() {
    const flags = parseArgs(process.argv.slice(2))
    const batch = typeof flags.batch === "string" && flags.batch.trim() ? flags.batch.trim() : "membresias-2026"
    const confirm = flags.confirm === true || flags.confirm === "true" || flags.confirm === "1"
    const prefix = `PRES-${batch}:`

    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)
    console.log(`Lote: ${batch} (providerOrderNumber empieza con "${prefix}")`)
    console.log(`Modo: ${confirm ? "CONFIRM" : "DRY-RUN"}`)
    console.log("")

    const orders = await prisma.order.findMany({
        where: {
            provider: "PRESENCIAL",
            providerOrderNumber: { startsWith: prefix },
        },
        select: {
            id: true,
            status: true,
            totalAmount: true,
            documentType: true,
            buyerName: true,
            buyerEmail: true,
            providerOrderNumber: true,
            orderItems: { select: { id: true, unitPrice: true, subtotal: true } },
            invoices: { select: { id: true, status: true, invoiceNumber: true, documentType: true } },
        },
        orderBy: { createdAt: "asc" },
    })

    if (orders.length === 0) {
        console.log("No se encontraron órdenes PRESENCIAL para ese lote. Nada que hacer.")
        return
    }

    const sum = orders.reduce((acc, o) => acc + Number(o.totalAmount), 0)
    const nonZero = orders.filter((o) => Number(o.totalAmount) !== 0)
    const withInvoices = orders.filter((o) => o.invoices.length > 0)
    const invoiceTotal = orders.reduce((acc, o) => acc + o.invoices.length, 0)

    console.log(`Órdenes PRESENCIAL del lote: ${orders.length}`)
    console.log(`Monto total actual (infla ingresos web): S/ ${sum.toFixed(2)}`)
    console.log(`Con monto != 0 (a limpiar): ${nonZero.length}`)
    console.log(`Comprobantes (Invoice) encontrados: ${invoiceTotal} en ${withInvoices.length} orden(es)`)
    console.log("")

    if (withInvoices.length > 0) {
        console.log("⚠️  Estas órdenes SÍ tienen comprobante(s) — revisar antes de limpiar:")
        for (const o of withInvoices) {
            const inv = o.invoices
                .map((i) => `${i.documentType}/${i.status}${i.invoiceNumber ? ` ${i.invoiceNumber}` : ""}`)
                .join(", ")
            console.log(`  - ${o.id.slice(-8).toUpperCase()} ${o.buyerName ?? ""}: ${inv}`)
        }
        console.log("")
    } else {
        console.log("✅ Ninguna orden del lote tiene comprobante emitido (no se generó boleta).")
        console.log("")
    }

    if (!confirm) {
        console.log("Detalle (primeras 40):")
        for (const o of orders.slice(0, 40)) {
            console.log(
                `  ${o.id.slice(-8).toUpperCase()}  S/ ${Number(o.totalAmount).toFixed(2).padStart(8)}  ${o.status.padEnd(9)} ${o.buyerName ?? ""}`
            )
        }
        console.log("")
        console.log("DRY-RUN: no se escribió nada. Repite con --confirm para poner en 0 el monto (sin tocar el carnet).")
        return
    }

    if (withInvoices.length > 0) {
        throw new Error(
            `Abortado: ${withInvoices.length} orden(es) tienen comprobante. No se limpió nada. Revisa esos comprobantes primero.`
        )
    }

    if (nonZero.length === 0) {
        console.log("Todas ya están en 0. Nada que actualizar.")
        return
    }

    const updated = await prisma.$transaction(async (tx) => {
        let orderCount = 0
        let itemCount = 0
        for (const o of nonZero) {
            await tx.order.update({ where: { id: o.id }, data: { totalAmount: 0 } })
            const items = await tx.orderItem.updateMany({
                where: { orderId: o.id },
                data: { unitPrice: 0, subtotal: 0 },
            })
            orderCount += 1
            itemCount += items.count
        }
        return { orderCount, itemCount }
    }, { timeout: 60_000 })

    console.log("")
    console.log(`Listo: ${updated.orderCount} orden(es) y ${updated.itemCount} ítem(s) puestos en S/ 0.`)
    console.log("Los carnets siguen intactos (orden PAID, tickets ACTIVE). El dashboard ya no cuenta estos montos.")
}

main()
    .catch((error) => {
        console.error("Error fatal:", error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
        process.exit(process.exitCode ?? 0)
    })
