/**
 * Exporta solo los REQUEST (iziConfig) reconstruidos para ordenes afectadas
 * por el loop de Web Core. No modifica la base ni llama a Izipay.
 *
 * Uso:
 *   tsx scripts/izipay-export-loop-requests.ts screenshot
 *   tsx scripts/izipay-export-loop-requests.ts related
 *   tsx scripts/izipay-export-loop-requests.ts all
 */
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"
import { buildCheckoutConfig, findIzipayConfigViolations } from "@/lib/izipay-config"
import { getIzipayMode } from "@/lib/izipay"

const SCREENSHOT_CODES = [
    "1P7KEALE",
    "1E2TQMBV",
    "K305A5KQ",
    "JG3YYPXO",
    "NRQOJDBJ",
    "8HK2Y6LN",
    "E9OF9DI1",
    "3TBJI9FA",
    "19WCT74O",
]

type Scope = "screenshot" | "related" | "all"

type OrderRow = {
    id: string
    userId: string
    currency: string
    totalAmount: string
    status: string
    createdAt: Date
    providerOrderNumber: string | null
    providerTransactionId: string | null
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

function reconstructDateTimeTransaction(transactionId: string): string {
    const msPrefix = transactionId.slice(0, 13)
    if (/^\d{13}$/.test(msPrefix)) {
        return String(Number(msPrefix) * 1000)
    }
    if (/^\d{16}$/.test(transactionId)) {
        return transactionId
    }
    return ""
}

function parseScope(value: string | undefined): Scope {
    if (value === "screenshot" || value === "related" || value === "all") {
        return value
    }
    throw new Error("Uso: tsx scripts/izipay-export-loop-requests.ts <screenshot|related|all>")
}

async function getOrderIds(client: Client, scope: Scope): Promise<string[]> {
    if (scope === "screenshot") {
        const result = await client.query<{ id: string }>(
            `SELECT id
             FROM orders
             WHERE UPPER(RIGHT(id, 8)) = ANY($1::text[])
             ORDER BY "createdAt"`,
            [SCREENSHOT_CODES]
        )
        return result.rows.map((row) => row.id)
    }

    if (scope === "related") {
        const result = await client.query<{ id: string }>(
            `SELECT DISTINCT o.id
             FROM orders o
             JOIN users u ON u.id = o."userId"
             JOIN order_items oi ON oi."orderId" = o.id
             JOIN ticket_types tt ON tt.id = oi."ticketTypeId"
             WHERE o.provider = 'IZIPAY'
               AND o.status = 'CANCELLED'
               AND o."paymentNeedsReview" = true
               AND o."providerResponse" IS NULL
               AND tt."eventId" = $1
               AND u.email = ANY($2::text[])
               AND o."createdAt" >= TIMESTAMP '2026-06-11 13:38:00'
               AND o."createdAt" < TIMESTAMP '2026-06-11 13:56:00'
             ORDER BY o.id`,
            [
                "cmq5kzbr7000i01o7mt9y0w2i",
                [
                    "akarihc@gmail.com",
                    "mgvizquerra@icloud.com",
                    "shirleyarmijo.1977@gmail.com",
                ],
            ]
        )
        return result.rows.map((row) => row.id)
    }

    const result = await client.query<{ id: string }>(`
        WITH order_events AS (
            SELECT DISTINCT o.id, o."userId", tt."eventId", o."createdAt"
            FROM orders o
            JOIN order_items oi ON oi."orderId" = o.id
            JOIN ticket_types tt ON tt.id = oi."ticketTypeId"
            WHERE o.provider = 'IZIPAY'
              AND o.status = 'CANCELLED'
              AND o."paymentNeedsReview" = true
              AND o."providerResponse" IS NULL
              AND o."createdAt" >= TIMESTAMP '2026-06-11 00:00:00'
              AND o."createdAt" < TIMESTAMP '2026-06-12 00:00:00'
        ),
        sequenced AS (
            SELECT *,
                   LAG("createdAt") OVER (
                       PARTITION BY "userId", "eventId"
                       ORDER BY "createdAt"
                   ) AS previous_at
            FROM order_events
        ),
        marked AS (
            SELECT *,
                   CASE
                       WHEN previous_at IS NULL
                         OR "createdAt" - previous_at > INTERVAL '3 minutes'
                       THEN 1 ELSE 0
                   END AS new_group
            FROM sequenced
        ),
        grouped AS (
            SELECT *,
                   SUM(new_group) OVER (
                       PARTITION BY "userId", "eventId"
                       ORDER BY "createdAt"
                   ) AS group_id
            FROM marked
        ),
        candidate_groups AS (
            SELECT "userId", "eventId", group_id
            FROM grouped
            GROUP BY "userId", "eventId", group_id
            HAVING COUNT(*) >= 2
        )
        SELECT g.id
        FROM grouped g
        JOIN candidate_groups c
          ON c."userId" = g."userId"
         AND c."eventId" = g."eventId"
         AND c.group_id = g.group_id
        ORDER BY g."createdAt"
    `)
    return result.rows.map((row) => row.id)
}

async function main() {
    const scope = parseScope(process.argv[2])
    const connectionString = process.env.DATABASE_URL
    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ticketingfdnda.pe"
    const configuredMode = getIzipayMode()
    const mode = configuredMode === "auto" ? "redirect" : configuredMode

    if (!connectionString) throw new Error("Falta DATABASE_URL")
    if (!merchantCode) throw new Error("Falta IZIPAY_MERCHANT_CODE")

    const client = new Client({ connectionString })
    await client.connect()

    const orderIds = await getOrderIds(client, scope)
    const result = await client.query<OrderRow>(
        `SELECT
            o.id, o."userId", o.currency, o."totalAmount", o.status, o."createdAt",
            o."providerOrderNumber", o."providerTransactionId",
            o."buyerDocType", o."buyerDocNumber", o."buyerAddress", o."buyerEmail",
            o."buyerPhone", o."buyerUbigeo", o."buyerFirstName", o."buyerSecondName",
            o."buyerLastNamePaternal", o."buyerLastNameMaternal", o."buyerName",
            u.name AS "userName", u.email AS "userEmail", u.phone AS "userPhone"
         FROM orders o
         JOIN users u ON u.id = o."userId"
         WHERE o.id = ANY($1::text[])
         ORDER BY o."createdAt"`,
        [orderIds]
    )
    await client.end()

    const requests = result.rows.map((row) => {
        const transactionId = row.providerTransactionId || ""
        const order = {
            ...row,
            user: {
                name: row.userName,
                email: row.userEmail,
                phone: row.userPhone,
            },
        }
        const iziConfig = buildCheckoutConfig({
            order,
            merchantCode,
            transactionId,
            appUrl,
            mode,
        })

        iziConfig.transactionId = transactionId
        if (row.providerOrderNumber) {
            iziConfig.order.orderNumber = row.providerOrderNumber
        }
        const dateTimeTransaction = reconstructDateTimeTransaction(transactionId)
        if (dateTimeTransaction) {
            iziConfig.order.dateTimeTransaction = dateTimeTransaction
        }

        return {
            orderId: row.id,
            shortCode: row.id.slice(-8).toUpperCase(),
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            iziConfig,
            configViolations: findIzipayConfigViolations(iziConfig),
        }
    })

    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outDir = path.resolve(process.cwd(), "scripts/out")
    const outFile = path.join(outDir, `izipay-loop-requests-${scope}-${stamp}.json`)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
        outFile,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                scope,
                reconstruction: {
                    builder: "buildCheckoutConfig",
                    persistedFields: ["providerOrderNumber", "providerTransactionId"],
                    merchantCode,
                    appUrl,
                    mode,
                },
                totals: {
                    requests: requests.length,
                    withConfigViolations: requests.filter(
                        (request) => request.configViolations.length > 0
                    ).length,
                },
                requests,
            },
            null,
            2
        ),
        "utf8"
    )

    console.log(`scope=${scope}`)
    console.log(`requests=${requests.length}`)
    console.log(`violations=${requests.filter((request) => request.configViolations.length > 0).length}`)
    console.log(`file=${outFile}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
