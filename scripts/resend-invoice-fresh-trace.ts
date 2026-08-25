/**
 * Reenvía a ABIO uno o más comprobantes con un traceId NUEVO por invoice.
 *
 * Contexto: cuando ABIO confirma que un comprobante NO se emitió pero su trace
 * viejo quedó "pegado" (devolvía HTTP 201 con meta.status:null y un reciboHash
 * que NO es prueba de emisión), reintentar con el mismo trace es peligroso:
 * ABIO puede responder DUPLICATE_TRACE y sendServilexInvoice marca eso como
 * ok=true, lo que provocaría un falso ISSUED sin emisión real.
 *
 * Este script:
 *   - Fuerza un traceId fresco por invoice (evita la trampa DUPLICATE_TRACE).
 *   - Envía UNA sola vez (sin reintentos automáticos del worker).
 *   - Marca ISSUED SOLO si ABIO responde meta.status === "success" (emisión
 *     real). Nunca marca ISSUED por DUPLICATE_TRACE ni por status:null.
 *
 * Uso (dentro del contenedor worker):
 *   # dry-run (no envía, no toca la BD; muestra el payload y el trace nuevo)
 *   tsx --tsconfig tsconfig.json scripts/resend-invoice-fresh-trace.ts <invoiceId> [<invoiceId> ...]
 *   # aplicar (envía a ABIO y marca ISSUED si emite de verdad)
 *   tsx --tsconfig tsconfig.json scripts/resend-invoice-fresh-trace.ts <invoiceId> [...] --apply
 *
 * El invoiceId es la parte después de "req-" en el traceId del panel.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
    buildServilexPayload,
    getServilexConfig,
    sendServilexInvoice,
} from "@/lib/servilex"

const INVOICE_INCLUDE = {
    order: {
        include: {
            user: { select: { id: true, email: true, name: true } },
            orderItems: {
                include: {
                    ticketType: {
                        include: {
                            event: {
                                select: {
                                    id: true,
                                    startDate: true,
                                    category: true,
                                    servilexSucursalCode: true,
                                },
                            },
                        },
                    },
                    merchVariant: {
                        select: {
                            id: true,
                            size: true,
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    servilexServiceCode: true,
                                    servilexSucursalCode: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    },
} satisfies Prisma.InvoiceInclude

function freshTraceId(invoiceId: string): string {
    return `req-${invoiceId}-r${Date.now().toString(36)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function getStoredResponseSummary(value: unknown) {
    const response = asRecord(value)
    const meta = asRecord(response?.meta)
    const error = asRecord(response?.error)

    return {
        metaStatus: typeof meta?.status === "string" ? meta.status : null,
        errorCode: typeof error?.codigo === "string" ? error.codigo : null,
        errorMessage: typeof error?.mensaje === "string" ? error.mensaje : null,
    }
}

async function resendOne(rawId: string, apply: boolean, confirmedNotIssued: boolean) {
    const invoiceId = rawId.replace(/^req-/, "").trim()
    console.log(`\n════════ Invoice ${invoiceId} ════════`)

    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: INVOICE_INCLUDE,
    })

    if (!invoice) {
        console.log(`❌ Invoice no encontrado: ${invoiceId}`)
        return { id: invoiceId, result: "not_found" as const }
    }
    if (invoice.order.status !== "PAID") {
        console.log(`❌ La orden no está PAID (${invoice.order.status}). Se omite.`)
        return { id: invoiceId, result: "not_paid" as const }
    }
    const storedResponse = getStoredResponseSummary(invoice.providerResponse)
    const canOverrideFalseIssued =
        confirmedNotIssued &&
        invoice.status === "ISSUED" &&
        !invoice.invoiceNumber &&
        !invoice.pdfUrl

    console.log(`   Orden     : ${invoice.orderId} (${invoice.order.status})`)
    console.log(`   Estado    : ${invoice.status} · reintentos ${invoice.retryCount}`)
    console.log(`   Trace viejo: ${invoice.traceId ?? "—"}`)
    console.log(`   HTTP      : ${invoice.httpStatus ?? "—"}`)
    console.log(`   Meta/error: ${storedResponse.metaStatus ?? "null"} / ${storedResponse.errorCode ?? "—"}`)
    console.log(`   Número/PDF: ${invoice.invoiceNumber ?? "—"} / ${invoice.pdfUrl ?? "—"}`)
    console.log(`   ReciboHash: ${invoice.reciboHash ?? "—"}`)

    if (invoice.status === "ISSUED" && !canOverrideFalseIssued) {
        console.log(
            `⚠️  Ya está ISSUED (${invoice.invoiceNumber ?? "sin número"}). Se omite para no duplicar.\n` +
                "   Solo se permite excepcionarlo con --confirmed-not-issued cuando ABIO confirmó que no existe,\n" +
                "   y el registro local no tiene número ni PDF."
        )
        return { id: invoiceId, result: "already_issued" as const }
    }

    if (canOverrideFalseIssued) {
        console.log("   EXCEPCIÓN : ABIO confirmó que este falso ISSUED no fue emitido.")
        console.log(`   Respuesta anterior: ${JSON.stringify(invoice.providerResponse)}`)
    }

    const config = getServilexConfig()
    const newTrace = freshTraceId(invoiceId)
    console.log(`   Comprador : ${invoice.buyerName ?? "—"} (${invoice.buyerDocNumber ?? "—"})`)
    console.log(`   Trace NUEVO: ${newTrace}`)

    // Fuerza el trace nuevo en el source antes de construir el payload.
    const payload = buildServilexPayload(
        {
            ...invoice,
            traceId: newTrace,
            servilexAssignedTotal: invoice.assignedTotal,
        },
        config
    )

    if (!apply) {
        console.log("\n   [DRY-RUN] Payload que se enviaría (usa --apply para enviar):")
        console.log(JSON.stringify(payload, null, 2))
        return { id: invoiceId, result: "dry_run" as const }
    }

    console.log(`\n   Enviando a ${config.endpoint} ...`)
    const response = await sendServilexInvoice(payload, config)
    const metaStatus = response.parsed?.meta?.status ?? null

    console.log("   ── Respuesta de ABIO ──")
    console.log(
        JSON.stringify(
            {
                httpStatus: response.status,
                metaStatus,
                errorCode: response.errorCode ?? null,
                invoiceNumber: response.invoiceNumber ?? null,
                reciboHash: response.reciboHash ?? null,
                pdfUrl: response.pdfUrl ?? null,
            },
            null,
            2
        )
    )
    console.log("   Body completo:")
    console.log(JSON.stringify(response.responseBody, null, 2))

    // Éxito REAL = ABIO reporta meta.status === "success".
    // OJO: response.ok también es true para DUPLICATE_TRACE — NO lo usamos.
    const genuinelyIssued = metaStatus === "success"

    if (genuinelyIssued) {
        const now = new Date()
        await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                status: "ISSUED",
                traceId: newTrace,
                requestPayload: response.rawPayload,
                requestSignature: response.signature,
                httpStatus: response.status,
                providerResponse: (response.responseBody ?? {}) as object,
                reciboHash: response.reciboHash || (canOverrideFalseIssued ? null : invoice.reciboHash),
                pdfUrl: response.pdfUrl || (canOverrideFalseIssued ? null : invoice.pdfUrl),
                invoiceNumber: response.invoiceNumber || (canOverrideFalseIssued ? null : invoice.invoiceNumber),
                sentToProvider: true,
                sentAt: now,
                issuedAt: canOverrideFalseIssued ? now : (invoice.issuedAt || now),
                lastError: null,
            },
        })
        console.log("\n   ✅ EMITIDO. Invoice marcado ISSUED con el trace nuevo.")
        return { id: invoiceId, result: "issued" as const }
    }

    if (response.errorCode === "DUPLICATE_TRACE") {
        console.log(
            "\n   ⛔ ABIO respondió DUPLICATE_TRACE con un trace NUEVO — inesperado.\n" +
                "      NO se marcó ISSUED (no hay prueba de emisión real). Escalar a ABIO."
        )
        return { id: invoiceId, result: "duplicate_trace" as const }
    }

    console.log(
        "\n   ❌ ABIO no emitió (meta.status != success). NO se modificó la BD.\n" +
            `      Detalle: ${response.errorMessage ?? "sin mensaje"}. Escalar a ABIO con este body.`
    )
    return { id: invoiceId, result: "failed" as const }
}

async function main() {
    const args = process.argv.slice(2)
    const apply = args.includes("--apply")
    const confirmedNotIssued = args.includes("--confirmed-not-issued")
    const ids = args.filter((a) => !a.startsWith("--"))

    if (ids.length === 0) {
        throw new Error(
            "Uso: tsx scripts/resend-invoice-fresh-trace.ts <invoiceId> [<invoiceId> ...] [--confirmed-not-issued] [--apply]"
        )
    }

    console.log(apply ? "MODO APPLY — se enviará a ABIO." : "MODO DRY-RUN — no se envía nada.")

    const results: { id: string; result: string }[] = []
    for (const id of ids) {
        results.push(await resendOne(id, apply, confirmedNotIssued))
    }

    console.log("\n════════ Resumen ════════")
    for (const r of results) console.log(`  ${r.id}: ${r.result}`)
}

main()
    .catch((e) => {
        console.error("Error:", e instanceof Error ? e.message : e)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
