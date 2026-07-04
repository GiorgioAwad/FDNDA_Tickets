/**
 * Remediación de órdenes fabricadas por el pago SIMULADO (mock) — sin cobro real
 * ni número de operación. Vector: la build de Vercel (fdnda-tickets.vercel.app,
 * ya ELIMINADA) corría PAYMENTS_MODE=mock sobre la BD de PRODUCCIÓN.
 * Ver scripts/find-mock-orders.ts (identificación) y
 * scripts/remediate-query-false-paid.ts (mismo patrón de reverso).
 *
 * Firma: providerRef LIKE 'MOCK-%'  OR  providerResponse.mock=true  OR provider=MOCK.
 * Solo actúa sobre órdenes que SIGUEN status=PAID (las ya CANCELLED se saltan).
 *
 * Por defecto DRY-RUN (no escribe nada):
 *   docker compose ... exec worker npx tsx scripts/remediate-mock-orders.ts
 *
 * Aplicar el reverso (orden->CANCELLED, entradas ACTIVE->CANCELLED, libera
 * inventario, paymentNeedsReview=true):
 *   APPLY=1 npx tsx scripts/remediate-mock-orders.ts
 *
 * Salta las ya ESCANEADAS (entitlement USED) salvo FORCE_USED=1: esas personas
 * ya ingresaron sin pagar → decisión manual de Giorgio.
 * NUNCA anula boletas SUNAT (acción externa): solo las lista.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

const APPLY = process.env.APPLY === "1"
const FORCE_USED = process.env.FORCE_USED === "1"

function entKey(date: Date): string {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

async function main() {
    console.log(
        `\n========== REMEDIACIÓN órdenes mock  [${APPLY ? "APPLY (escribe)" : "DRY-RUN (solo lectura)"}]${FORCE_USED ? "  +FORCE_USED" : ""} ==========\n`
    )

    const candidates = await prisma.order.findMany({
        where: {
            status: "PAID",
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
            orderType: true,
            totalAmount: true,
            currency: true,
            paidAt: true,
            buyerName: true,
            buyerDocNumber: true,
            providerRef: true,
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
                select: { id: true, status: true, documentType: true, invoiceNumber: true },
            },
        },
    })

    console.log(`Órdenes PAID con firma mock (sin cobro real): ${candidates.length}\n`)

    let totalAmount = 0
    let issuedBoletas = 0
    let skippedUsed = 0
    let applied = 0

    for (const o of candidates) {
        const usedEnt = o.tickets.some((t) => t.entitlements.some((e) => e.status === "USED"))
        totalAmount += Number(o.totalAmount)

        console.log("──────────────────────────────────────────────")
        console.log(
            `#${o.id.slice(-8).toUpperCase()}  ${o.currency} ${o.totalAmount.toString()}  [${o.orderType}]  ${o.paidAt?.toISOString() ?? "-"}`
        )
        console.log(`  Cliente: ${o.buyerName ?? "-"} <${o.user?.email ?? "-"}>  doc=${o.buyerDocNumber ?? "-"}`)
        console.log(`  providerRef: ${o.providerRef ?? "-"}  (provider=${o.provider})`)
        console.log(`  Entradas (${o.tickets.length}):`)
        for (const t of o.tickets) {
            const fechas =
                t.entitlements.map((e) => `${entKey(e.date)}${e.status === "USED" ? "(USADA!)" : ""}`).join(", ") ||
                "(sin entitlements)"
            console.log(`    · ${t.ticketCode}  [${t.status}]  ${fechas}`)
        }
        const issued = o.invoices.filter((i) => i.status === "ISSUED")
        issuedBoletas += issued.length
        if (issued.length > 0) {
            for (const inv of issued) {
                console.log(`    · ${inv.documentType} ${inv.invoiceNumber ?? "(sin nro)"}  [ISSUED]  <-- ANULAR EN SUNAT/ABIO (manual)`)
            }
        }

        if (usedEnt && !FORCE_USED) {
            skippedUsed++
            console.log(`  ⚠️  YA ESCANEADA (entitlement USADO). SE SALTA (FORCE_USED=1 para forzar). Ya ingresó sin pagar → decisión manual.`)
            continue
        }

        console.log(
            `  Plan: orden -> CANCELLED, ${o.tickets.length} entrada(s) -> CANCELLED, liberar inventario, paymentNeedsReview=true${issued.length ? `, + ${issued.length} boleta(s) a anular en SUNAT (manual)` : ""}`
        )

        if (APPLY) {
            const prevResponse =
                o.providerResponse && typeof o.providerResponse === "object" && !Array.isArray(o.providerResponse)
                    ? (o.providerResponse as Prisma.JsonObject)
                    : {}
            await prisma.$transaction(async (tx) => {
                await tx.ticket.updateMany({
                    where: { orderId: o.id, status: "ACTIVE" },
                    data: { status: "CANCELLED" },
                })

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
                            ...prevResponse,
                            _remediation: {
                                reason: "mock-vercel: entrada emitida por pago simulado, sin cobro real",
                                providerRef: o.providerRef,
                                usedEntitlement: usedEnt,
                                revertedAt: new Date().toISOString(),
                            },
                        } as Prisma.InputJsonValue,
                    },
                })
            })
            applied++
            console.log(`  ✅ APLICADO.${usedEnt ? "  (ojo: ya había ingresado)" : ""}`)
        }
    }

    console.log("\n========== RESUMEN ==========")
    console.log(`PAID con firma mock: ${candidates.length}  | Monto falso: ${candidates[0]?.currency ?? "PEN"} ${totalAmount.toFixed(2)}`)
    console.log(`Boletas ISSUED a anular en SUNAT/ABIO (manual): ${issuedBoletas}`)
    console.log(`Saltadas por escaneo previo (USED): ${skippedUsed}${skippedUsed && !FORCE_USED ? "  (usar FORCE_USED=1 para incluirlas)" : ""}`)
    if (APPLY) console.log(`Órdenes revertidas en BD: ${applied}`)
    else console.log(`\n(DRY-RUN: no se escribió nada. Aplicar: APPLY=1 npx tsx scripts/remediate-mock-orders.ts)`)
}

main()
    .catch((e) => {
        console.error("ERR", e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
