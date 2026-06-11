/**
 * Exporta, para los pagos Izipay NO completados, el objeto `iziConfig` que se
 * envió (request) y la respuesta que devolvió Izipay (response), para remitirlos
 * a soporte Izipay durante el análisis de un incidente.
 *
 * SOLO LECTURA: no toca la base ni Izipay.
 *
 * Reconstruye el request con el MISMO builder de producción
 * (`buildCheckoutConfig`), de modo que los valores normalizados (billing, etc.)
 * coinciden con lo enviado. `transactionId` y `orderNumber` salen de la orden;
 * `dateTimeTransaction` se reconstruye del timestamp embebido en el
 * `transactionId` (los primeros 13 dígitos = epoch ms de creación).
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/izipay-export-pending.ts [horasAtras] [maxOrdenes] [DATABASE_URL]
 *
 *   horasAtras   ventana hacia atrás (default 48)
 *   maxOrdenes   límite de órdenes (default 200)
 *   DATABASE_URL opcional; si no, lo toma de process.env.DATABASE_URL
 *
 * Salida: imprime un resumen y escribe el JSON completo en
 *   scripts/out/izipay-pending-<timestamp>.json
 */
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"
import { buildCheckoutConfig, findIzipayConfigViolations } from "@/lib/izipay-config"
import { getIzipayMode } from "@/lib/izipay"

// Se usa pg directo (no Prisma) para que el script sea autosuficiente y rapido
// tanto local como en el contenedor: solo necesita DATABASE_URL.

function reconstructDateTimeTransaction(transactionId: string): string {
    // El transactionId de producción es `${Date.now()}${orderIdLimpio}` (ms de
    // 13 dígitos al inicio). formatIzipayDateTime usa Date.now()*1000 (16 díg).
    const msPrefix = transactionId.slice(0, 13)
    if (/^\d{13}$/.test(msPrefix)) {
        return String(Number(msPrefix) * 1000)
    }
    // Formato alterno (algunos llegan ya en microsegundos de 16 dígitos).
    if (/^\d{16}$/.test(transactionId)) {
        return transactionId
    }
    return ""
}

async function main() {
    const hoursBack = Number(process.argv[2]) || 48
    const maxOrders = Number(process.argv[3]) || 200

    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"
    const connectionString = process.argv[4] || process.env.DATABASE_URL
    const mode = getIzipayMode()
    const resolvedMode = mode === "auto" ? "redirect" : mode

    if (!merchantCode) {
        console.error("Falta IZIPAY_MERCHANT_CODE en el entorno.")
        process.exit(1)
    }
    if (!connectionString) {
        console.error("Falta DATABASE_URL (env o como 3er argumento).")
        process.exit(1)
    }

    const client = new Client({ connectionString })
    await client.connect()

    type OrderRow = {
        id: string
        userId: string
        currency: string
        totalAmount: string
        status: string
        createdAt: Date
        providerOrderNumber: string | null
        providerTransactionId: string | null
        providerResponse: unknown
        buyerDocType: string | null
        buyerDocNumber: string | null
        buyerAddress: string | null
        buyerEmail: string | null
        buyerPhone: string | null
        buyerUbigeo: string | null
        buyerFirstName: string | null
        buyerSecondName: string | null
        buyerLastNamePaternal: string | null
        buyerLastNameMaternal: string | null
        buyerName: string | null
        userName: string
        userEmail: string
        userPhone: string | null
    }

    const result = await client.query<OrderRow>(
        `SELECT
            o.id, o."userId", o.currency, o."totalAmount", o.status, o."createdAt",
            o."providerOrderNumber", o."providerTransactionId", o."providerResponse",
            o."buyerDocType", o."buyerDocNumber", o."buyerAddress", o."buyerEmail",
            o."buyerPhone", o."buyerUbigeo", o."buyerFirstName", o."buyerSecondName",
            o."buyerLastNamePaternal", o."buyerLastNameMaternal", o."buyerName",
            u.name AS "userName", u.email AS "userEmail", u.phone AS "userPhone"
        FROM orders o
        JOIN users u ON u.id = o."userId"
        WHERE o.provider = 'IZIPAY'
            AND o.status <> 'PAID'
            AND o."createdAt" >= $1
            AND o."providerTransactionId" IS NOT NULL
        ORDER BY o."createdAt" DESC
        LIMIT $2`,
        [new Date(Date.now() - hoursBack * 60 * 60 * 1000), maxOrders]
    )
    await client.end()

    const orders = result.rows.map((row) => ({
        ...row,
        user: { name: row.userName, email: row.userEmail, phone: row.userPhone },
    }))

    const records = orders.map((order) => {
        const transactionId = order.providerTransactionId || ""
        const request = buildCheckoutConfig({
            order,
            merchantCode,
            transactionId,
            appUrl,
            mode: resolvedMode,
        })

        // Alinear los campos persistidos (lo realmente enviado) con la reconstrucción.
        request.transactionId = transactionId
        if (order.providerOrderNumber) {
            request.order.orderNumber = order.providerOrderNumber
        }
        const reconstructedDate = reconstructDateTimeTransaction(transactionId)
        if (reconstructedDate) {
            request.order.dateTimeTransaction = reconstructedDate
        }

        const violations = findIzipayConfigViolations(request)

        return {
            orderId: order.id,
            status: order.status,
            createdAt: order.createdAt.toISOString(),
            orderNumber: order.providerOrderNumber,
            transactionId,
            hadIzipayResponse: order.providerResponse !== null,
            configViolations: violations,
            request,
            response: order.providerResponse ?? null,
        }
    })

    const withResponse = records.filter((r) => r.hadIzipayResponse).length
    const withoutResponse = records.length - withResponse
    const withViolations = records.filter((r) => r.configViolations.length > 0).length

    const outDir = path.resolve(process.cwd(), "scripts/out")
    fs.mkdirSync(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outFile = path.join(outDir, `izipay-pending-${stamp}.json`)
    fs.writeFileSync(
        outFile,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                merchantCode,
                appUrl,
                mode: resolvedMode,
                window: {
                    hoursBack,
                    since: new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString(),
                },
                totals: {
                    orders: records.length,
                    sinRespuestaIzipay: withoutResponse,
                    conRespuestaIzipay: withResponse,
                    conParametrosFueraDeRegla: withViolations,
                },
                records,
            },
            null,
            2
        ),
        "utf8"
    )

    console.log(`Órdenes exportadas: ${records.length}`)
    console.log(`  sin respuesta de Izipay (nunca respondió): ${withoutResponse}`)
    console.log(`  con respuesta de Izipay (denegado/etc.):    ${withResponse}`)
    console.log(`  con parámetros fuera de regla:              ${withViolations}`)
    console.log(`Archivo: ${outFile}`)

    if (withViolations > 0) {
        console.log("\nÓrdenes con parámetros fuera de regla (revisar):")
        for (const r of records.filter((x) => x.configViolations.length > 0).slice(0, 20)) {
            console.log(`  ${r.orderId} [${r.status}]: ${r.configViolations.join("; ")}`)
        }
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
