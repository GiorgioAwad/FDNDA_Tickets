/**
 * Remediación de órdenes marcadas PAID por la vía "query" SIN cobro real
 * (bug de searchIzipayTransaction: code "00" del sobre != pago). Ver
 * isIzipayQueryPaymentApproved en src/lib/izipay.ts.
 *
 * Por defecto DRY-RUN: solo reporta, no escribe nada.
 *   tsx scripts/remediate-query-false-paid.ts
 *
 * Para aplicar el reverso en BD (orden -> CANCELLED, entradas -> CANCELLED,
 * libera inventario, marca paymentNeedsReview):
 *   APPLY=1 tsx scripts/remediate-query-false-paid.ts
 *
 * NUNCA anula boletas SUNAT (acción externa irreversible): solo las lista para
 * que se anulen en ABIO/Servilex manualmente. Salta órdenes con entitlement USED
 * (ya escaneado) salvo FORCE_USED=1.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { extractIzipayOperationNumber } from "@/lib/payment-details"

const APPLY = process.env.APPLY === "1"
const FORCE_USED = process.env.FORCE_USED === "1"

const PAID_STATES = ["aceptado", "pagado", "autorizado", "aprobado", "completado"]

function entKey(date: Date): string {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

function realState(pr: unknown): { state: string; codeAuth: string } {
    const env = pr as Record<string, unknown> | null
    const data = (env?.data ?? env) as Record<string, unknown> | null
    const response = data?.response as Record<string, unknown> | undefined
    const order = Array.isArray(response?.order) ? (response?.order[0] as Record<string, unknown>) : undefined
    return {
        state: String(order?.stateMessage ?? "").trim(),
        codeAuth: String(order?.codeAuth ?? "").trim(),
    }
}

function isReallyPaid(state: string, codeAuth: string): boolean {
    const s = state.toLowerCase()
    return codeAuth !== "" && PAID_STATES.some((p) => s.includes(p))
}

async function main() {
    console.log(`\n========== REMEDIACIÓN query-false-paid  [${APPLY ? "APPLY (escribe)" : "DRY-RUN (solo lectura)"}] ==========\n`)

    const candidates = await prisma.order.findMany({
        where: {
            status: "PAID",
            provider: "IZIPAY",
            providerResponse: { path: ["source"], equals: "query" },
        },
        orderBy: { paidAt: "asc" },
        select: {
            id: true,
            status: true,
            orderType: true,
            totalAmount: true,
            currency: true,
            paidAt: true,
            buyerName: true,
            buyerDocNumber: true,
            providerRef: true,
            providerTransactionId: true,
            providerResponse: true,
            user: { select: { email: true } },
            tickets: {
                select: {
                    id: true,
                    ticketCode: true,
                    status: true,
                    entitlements: { select: { date: true, status: true }, orderBy: { date: "asc" } },
                },
            },
            invoices: {
                select: {
                    id: true,
                    status: true,
                    documentType: true,
                    invoiceNumber: true,
                    issuedAt: true,
                    pdfUrl: true,
                },
            },
        },
    })

    const toRemediate = candidates.filter((o) => {
        const { state, codeAuth } = realState(o.providerResponse)
        return !isReallyPaid(state, codeAuth)
    })

    console.log(`Órdenes PAID vía "query": ${candidates.length}  ->  a remediar (sin cobro real): ${toRemediate.length}\n`)

    let totalAmount = 0
    let issuedBoletas = 0
    let skippedUsed = 0
    let applied = 0

    for (const o of toRemediate) {
        const { state, codeAuth } = realState(o.providerResponse)
        const usedEnt = o.tickets.some((t) => t.entitlements.some((e) => e.status === "USED"))
        const op = extractIzipayOperationNumber(o)
        totalAmount += Number(o.totalAmount)

        console.log("──────────────────────────────────────────────")
        console.log(`#${o.id.slice(-8).toUpperCase()}  ${o.currency} ${o.totalAmount.toString()}  [${o.orderType}]  ${o.paidAt?.toISOString() ?? "-"}`)
        console.log(`  Cliente: ${o.buyerName ?? "-"} <${o.user.email}>  doc=${o.buyerDocNumber ?? "-"}`)
        console.log(`  Izipay real: estado="${state}"  codeAuth="${codeAuth || "(vacío)"}"  op=${op ?? "-"}`)
        console.log(`  Entradas (${o.tickets.length}):`)
        for (const t of o.tickets) {
            const fechas = t.entitlements.map((e) => `${entKey(e.date)}${e.status === "USED" ? "(USADA!)" : ""}`).join(", ") || "(sin entitlements)"
            console.log(`    · ${t.ticketCode}  [${t.status}]  ${fechas}`)
        }
        const issued = o.invoices.filter((i) => i.status === "ISSUED")
        issuedBoletas += issued.length
        if (o.invoices.length > 0) {
            console.log(`  Boletas/comprobantes (${o.invoices.length}):`)
            for (const inv of o.invoices) {
                console.log(`    · ${inv.documentType} ${inv.invoiceNumber ?? "(sin nro)"}  [${inv.status}]  ${inv.issuedAt?.toISOString() ?? ""}${inv.status === "ISSUED" ? "  <-- ANULAR EN SUNAT/ABIO (manual)" : ""}`)
            }
        }

        if (usedEnt && !FORCE_USED) {
            skippedUsed++
            console.log(`  ⚠️  TIENE ENTITLEMENT USADO (ya escaneada). SE SALTA (usar FORCE_USED=1 para forzar). Revisar manualmente.`)
            continue
        }

        console.log(`  Plan: orden -> CANCELLED, ${o.tickets.length} entrada(s) -> CANCELLED, liberar inventario, paymentNeedsReview=true${issued.length ? `, + ${issued.length} boleta(s) a anular en SUNAT (manual)` : ""}`)

        if (APPLY) {
            await prisma.$transaction(async (tx) => {
                await tx.ticket.updateMany({
                    where: { orderId: o.id, status: "ACTIVE" },
                    data: { status: "CANCELLED" },
                })

                // Liberar inventario por ítem (sold + merch reserved).
                const items = await tx.orderItem.findMany({
                    where: { orderId: o.id },
                    select: { ticketTypeId: true, merchVariantId: true, quantity: true },
                })
                for (const it of items) {
                    if (it.merchVariantId) {
                        await tx.$queryRaw`
                            UPDATE "merch_variants"
                            SET "reserved" = GREATEST("reserved" - ${it.quantity}, 0), "updatedAt" = NOW()
                            WHERE "id" = ${it.merchVariantId}`
                        continue
                    }
                    if (it.ticketTypeId) {
                        await tx.ticketType.updateMany({
                            where: { id: it.ticketTypeId, sold: { gte: it.quantity } },
                            data: { sold: { decrement: it.quantity } },
                        })
                    }
                }

                await tx.order.update({
                    where: { id: o.id },
                    data: {
                        status: "CANCELLED",
                        paymentNeedsReview: true,
                        providerResponse: {
                            ...(o.providerResponse as Prisma.JsonObject),
                            _remediation: {
                                reason: "query-false-paid: sin cobro real en Izipay",
                                realState: state,
                                revertedAt: new Date().toISOString(),
                            },
                        } as Prisma.InputJsonValue,
                    },
                })
            })
            applied++
            console.log(`  ✅ APLICADO.`)
        }
    }

    console.log("\n========== RESUMEN ==========")
    console.log(`A remediar: ${toRemediate.length}  | Monto total falso: ${toRemediate[0]?.currency ?? "PEN"} ${totalAmount.toFixed(2)}`)
    console.log(`Boletas ISSUED a anular en SUNAT/ABIO (manual): ${issuedBoletas}`)
    console.log(`Saltadas por entitlement USADO: ${skippedUsed}`)
    if (APPLY) console.log(`Órdenes revertidas en BD: ${applied}`)
    else console.log(`\n(DRY-RUN: no se escribió nada. Para aplicar el reverso en BD: APPLY=1 tsx scripts/remediate-query-false-paid.ts)`)
}

main()
    .catch((e) => { console.error("ERR", e); process.exitCode = 1 })
    .finally(async () => { await prisma.$disconnect() })
