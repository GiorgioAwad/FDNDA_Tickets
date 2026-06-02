/**
 * Fulfillment manual de una orden cuyo pago se confirmó en Izipay pero cuya
 * notificación (IPN) llegó "Fallido" y dejó la orden en PENDING.
 *
 * Reproduce EXACTAMENTE lo que habría hecho el webhook usando el mismo código
 * (`fulfillPaidOrder`): pasa la orden a PAID, crea los tickets y entitlements,
 * descuenta inventario y dispara la emisión de boleta. Es idempotente: si la
 * orden ya está pagada y con tickets, no hace nada.
 *
 * NO uses un UPDATE de SQL crudo: eso marca PAID pero no crea tickets ni boleta
 * y descuadra el inventario.
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/fulfill-order-manual.ts <ORDEN> [--confirm] [--txid=...] [--ordernum=...]
 *
 *   <ORDEN>     id completo (cuid) o el código corto del panel, p.ej. Z0YG0KL2
 *   --confirm   ejecuta de verdad. Sin esta flag es un DRY-RUN (no escribe nada).
 *   --txid      (opcional) id de transacción Izipay del comprobante
 *   --ordernum  (opcional) número de orden Izipay del comprobante
 */
import { prisma } from "@/lib/prisma"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"

function parseArgs(argv: string[]) {
    const positional: string[] = []
    const flags: Record<string, string | boolean> = {}
    for (const a of argv) {
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=")
            flags[k] = v ?? true
        } else {
            positional.push(a)
        }
    }
    return { positional, flags }
}

function maskDbHost(url?: string): string {
    if (!url) return "(sin DATABASE_URL)"
    try {
        const u = new URL(url)
        return `${u.protocol}//${u.host}${u.pathname}`
    } catch {
        return "(DATABASE_URL no parseable)"
    }
}

async function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2))
    const ref = positional[0]
    const confirm = Boolean(flags.confirm)

    if (!ref) {
        console.error(
            "Uso: tsx scripts/fulfill-order-manual.ts <ORDEN|CODIGO> [--confirm] [--txid=...] [--ordernum=...]"
        )
        process.exit(1)
    }

    // Que el operador confirme contra qué base está corriendo antes de --confirm.
    console.log(`DB destino: ${maskDbHost(process.env.DATABASE_URL)}`)

    const norm = ref.replace(/^#/, "").trim()
    const order = await prisma.order.findFirst({
        where: {
            OR: [{ id: norm }, { id: { endsWith: norm.toLowerCase() } }],
        },
        include: {
            user: { select: { name: true, email: true } },
            orderItems: {
                select: {
                    quantity: true,
                    ticketType: {
                        select: { name: true, event: { select: { title: true } } },
                    },
                },
            },
            tickets: { select: { id: true } },
        },
    })

    if (!order) {
        console.error(`No se encontró ninguna orden para "${ref}".`)
        process.exit(1)
    }

    const shortCode = order.id.slice(-8).toUpperCase()
    console.log("──────────────────────────────────────────")
    console.log(`Orden:   #${shortCode}  (id: ${order.id})`)
    console.log(`Cliente: ${order.user.name} <${order.user.email}>`)
    console.log(`Estado:  ${order.status}   Tipo: ${order.orderType}`)
    console.log(`Monto:   ${order.currency} ${order.totalAmount.toString()}`)
    console.log(`Tickets ya emitidos: ${order.tickets.length}`)
    for (const it of order.orderItems) {
        console.log(
            `  - ${it.quantity}x ${it.ticketType?.name ?? "(merch)"} — ${it.ticketType?.event?.title ?? ""}`
        )
    }
    console.log("──────────────────────────────────────────")

    // Si pasás --txid (o --retry-invoice), permitimos continuar aunque la orden
    // ya esté pagada: la rama "alreadyPaid" de fulfillPaidOrder solo re-sincroniza
    // metadata (nº de operación) y reintenta la boleta, SIN crear entradas nuevas.
    const wantsInvoiceRetry =
        typeof flags.txid === "string" || Boolean(flags["retry-invoice"])
    if (order.status === "PAID" && order.tickets.length > 0) {
        if (!wantsInvoiceRetry) {
            console.log("La orden YA está pagada y con tickets emitidos. Nada que hacer.")
            console.log(
                "Para actualizar el nº de operación y reintentar la boleta, agregá --txid=<numero> --confirm"
            )
            return
        }
        console.log(
            "Orden ya pagada: se actualizará el nº de operación y se reintentará la boleta (no se duplican entradas)."
        )
    }
    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        console.log(`La orden está ${order.status}; no es pagable. Abortando.`)
        return
    }

    if (!confirm) {
        console.log("DRY-RUN: no se escribió nada.")
        console.log("Si los datos de arriba son correctos, repetí el comando con  --confirm")
        return
    }

    const providerResponse = {
        source: "manual-admin-fulfill",
        reason: "IPN de Izipay en estado Fallido; pago confirmado por comprobante del cliente",
        fulfilledBy: "script:fulfill-order-manual",
        fulfilledAt: new Date().toISOString(),
    }

    console.log("Ejecutando fulfillPaidOrder…")
    const result = await fulfillPaidOrder({
        orderId: order.id,
        providerRef: typeof flags.txid === "string" ? flags.txid : undefined,
        providerOrderNumber: typeof flags.ordernum === "string" ? flags.ordernum : undefined,
        providerTransactionId: typeof flags.txid === "string" ? flags.txid : undefined,
        providerResponse,
    })

    console.log("Resultado:", JSON.stringify(result, null, 2))
    if (result.success) {
        console.log("✅ Orden fulfilled. El cliente ya debería ver su QR; la boleta queda en proceso.")
    } else {
        console.error(`❌ No se pudo: ${result.error ?? "error desconocido"}`)
        process.exitCode = 1
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
