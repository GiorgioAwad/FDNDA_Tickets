/**
 * SOLO LECTURA: completa datos que soporte Izipay suele pedir para reclamos:
 * tarjeta (primeros 6 - ultimos 4) y numero de autorizacion.
 *
 * Fuentes, en orden:
 *   1) Hoja "cruce" del Excel original.
 *   2) providerResponse en DB.
 *   3) API de consulta Izipay Transaction/Search.
 *
 * No escribe en DB ni en Izipay. No exporta PAN completo ni respuestas crudas.
 */
import fs from "fs"
import path from "path"
import { Pool } from "pg"
import * as XLSX from "xlsx"
import {
    buildIzipayOrderNumber,
    getIzipayQueryLanguage,
    searchIzipayTransaction,
} from "@/lib/izipay"

const DEFAULT_INPUT =
    "G:\\GIORGIO\\Descargas\\Cruce Izipay pagian web.xlsx"
const TARGET_SHEETS = [
    "FALTA DE PISCINA LIBRE",
    "FALTA DE EVENTO CAMPEONATO",
] as const
const SETTLEMENT_SHEET = "cruce"

type JsonRecord = Record<string, unknown>
type SheetRow = Record<string, unknown>

type DbOrder = {
    id: string
    status: string
    providerRef: string | null
    providerOrderNumber: string | null
    providerTransactionId: string | null
    providerResponse: unknown
}

type SupportInfo = {
    cardFirst6?: string
    cardLast4?: string
    card64?: string
    authorization?: string
    cardBrand?: string
    paymentMethod?: string
    providerTransactionId?: string
    queryStatus?: string
    queryError?: string
    sources: string[]
    notes: string[]
}

type TargetOrder = {
    sheetName: string
    orderId: string
    operationNumber: string
    providerRef: string
    paymentMethod: string
    buyerEmail: string
    buyerName: string
    amount: string
    paidAt: string
}

function asRecord(value: unknown): JsonRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null
    }
    return value as JsonRecord
}

function asString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    const normalized = String(value).trim()
    return normalized ? normalized : null
}

function normalizeLookupValue(value: unknown): string {
    const normalized = asString(value)
        ?.replace(/\s+/g, "")
        .replace(/\.0+$/, "")
        .toLowerCase()
    if (!normalized) return ""

    const withoutLeadingZeroes = normalized.replace(/^0+/, "")
    return withoutLeadingZeroes || "0"
}

function parseJsonRecord(value: unknown): JsonRecord | null {
    if (typeof value !== "string" || !value.trim()) return null
    try {
        return asRecord(JSON.parse(value))
    } catch {
        return null
    }
}

function parseCardParts(value: unknown): { first6?: string; last4?: string } | null {
    const raw = asString(value)
    if (!raw) return null

    const digits = raw.replace(/\D/g, "")
    if (digits.length >= 10 && digits.length <= 19) {
        return {
            first6: digits.slice(0, 6),
            last4: digits.slice(-4),
        }
    }

    const masked = raw.match(/(\d{6})[\s*Xx.-]+(\d{4})/)
    if (masked) {
        return { first6: masked[1], last4: masked[2] }
    }

    return null
}

function normalizeAuthorization(value: unknown): string | null {
    const raw = asString(value)
    if (!raw) return null

    const normalized = raw.replace(/\s+/g, "")
    if (!normalized || normalized.length > 20) return null
    if (/bearer|token|session/i.test(normalized)) return null
    if (!/^[a-z0-9-]+$/i.test(normalized)) return null
    return normalized
}

function addSource(info: SupportInfo, source: string) {
    if (!info.sources.includes(source)) info.sources.push(source)
}

function mergeInfo(base: SupportInfo, next: Partial<SupportInfo>, source: string) {
    let changed = false
    const assign = <K extends keyof SupportInfo>(key: K) => {
        const value = next[key]
        if (
            (base[key] === undefined || base[key] === null || base[key] === "") &&
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            ;(base[key] as SupportInfo[K]) = value as SupportInfo[K]
            changed = true
        }
    }

    assign("cardFirst6")
    assign("cardLast4")
    assign("authorization")
    assign("cardBrand")
    assign("paymentMethod")
    assign("providerTransactionId")
    assign("queryStatus")
    assign("queryError")

    if (!base.card64 && (base.cardFirst6 || next.cardFirst6) && (base.cardLast4 || next.cardLast4)) {
        const first6 = base.cardFirst6 || next.cardFirst6
        const last4 = base.cardLast4 || next.cardLast4
        if (first6 && last4) {
            base.card64 = `${first6}-${last4}`
            changed = true
        }
    }

    for (const note of next.notes || []) {
        if (note && !base.notes.includes(note)) base.notes.push(note)
    }

    if (changed) addSource(base, source)
}

function emptyInfo(): SupportInfo {
    return { sources: [], notes: [] }
}

function extractSupportInfoFromValue(value: unknown): Partial<SupportInfo> {
    const info: Partial<SupportInfo> = { notes: [] }
    const seen = new Set<unknown>()

    function visit(current: unknown, pathParts: string[]) {
        if (current === null || current === undefined) return

        if (typeof current === "string") {
            const parsed = parseJsonRecord(current)
            if (parsed) visit(parsed, [...pathParts, "json"])
            return
        }

        if (typeof current !== "object") return
        if (seen.has(current)) return
        seen.add(current)

        if (Array.isArray(current)) {
            current.forEach((item, index) => visit(item, [...pathParts, String(index)]))
            return
        }

        for (const [key, rawValue] of Object.entries(current as JsonRecord)) {
            const keyPath = [...pathParts, key].join(".")
            const normalizedKey = key.toLowerCase()
            const normalizedPath = keyPath.toLowerCase()

            if (normalizedKey === "payloadhttp") {
                const parsed = parseJsonRecord(rawValue)
                if (parsed) visit(parsed, [...pathParts, key, "parsed"])
            }

            const isCardPath =
                /(^|\.)(pan|card|carddetails|tarjeta)(\.|$)/i.test(keyPath) ||
                /cardnumber|maskedcard|maskedpan|cardpan|tarjeta/i.test(key)
            const isBinPath = /(^|\.)(bin|firstsix|first6)(\.|$)/i.test(keyPath)
            const isLast4Path = /lastfour|last4|ultimos?4|ultim[oa]s?cuatro/i.test(key)
            const isAuthPath =
                /codeauth|authorizationcode|authorisationcode|authcode|authorizationnumber|numeroautorizacion|nroautorizacion|codautorizacion/i.test(
                    normalizedPath
                ) || normalizedKey === "authorization"

            if (isCardPath) {
                const parts = parseCardParts(rawValue)
                if (parts?.first6 && !info.cardFirst6) info.cardFirst6 = parts.first6
                if (parts?.last4 && !info.cardLast4) info.cardLast4 = parts.last4
            }

            if (isBinPath) {
                const digits = asString(rawValue)?.replace(/\D/g, "")
                if (digits && digits.length >= 6 && !info.cardFirst6) {
                    info.cardFirst6 = digits.slice(0, 6)
                }
            }

            if (isLast4Path) {
                const digits = asString(rawValue)?.replace(/\D/g, "")
                if (digits && digits.length >= 4 && !info.cardLast4) {
                    info.cardLast4 = digits.slice(-4)
                }
            }

            if (isAuthPath) {
                const authorization = normalizeAuthorization(rawValue)
                if (authorization && !info.authorization) info.authorization = authorization
            }

            if (
                !info.cardBrand &&
                /cardbrand|brand|marca/i.test(key) &&
                typeof rawValue !== "object"
            ) {
                info.cardBrand = asString(rawValue) || undefined
            }

            if (
                !info.paymentMethod &&
                /paymethod|paymentmethod|paymentmethodtype|metodopago/i.test(key) &&
                typeof rawValue !== "object"
            ) {
                info.paymentMethod = asString(rawValue) || undefined
            }

            if (
                !info.providerTransactionId &&
                /transactionid|referencenumber|uuid/i.test(key) &&
                typeof rawValue !== "object"
            ) {
                info.providerTransactionId = asString(rawValue) || undefined
            }

            visit(rawValue, [...pathParts, key])
        }
    }

    visit(value, [])

    if (info.cardFirst6 && info.cardLast4) {
        info.card64 = `${info.cardFirst6}-${info.cardLast4}`
    }

    return info
}

function extractIzipayOutcomeNotes(value: unknown): string[] {
    const notes: string[] = []
    const seen = new Set<unknown>()

    function add(note: string) {
        if (note && !notes.includes(note)) notes.push(note)
    }

    function visit(current: unknown) {
        if (current === null || current === undefined) return

        if (typeof current === "string") {
            const parsed = parseJsonRecord(current)
            if (parsed) visit(parsed)
            return
        }

        if (typeof current !== "object") return
        if (seen.has(current)) return
        seen.add(current)

        if (Array.isArray(current)) {
            current.forEach(visit)
            return
        }

        const record = current as JsonRecord
        const code = asString(record.code)
        const message =
            asString(record.messageUser) ||
            asString(record.message) ||
            asString(record.stateMessage)

        if (code && code !== "00") {
            add(`Respuesta Izipay ${code}${message ? `: ${message}` : ""}.`)
        }

        if (Object.prototype.hasOwnProperty.call(record, "codeAuth") && !asString(record.codeAuth)) {
            add("codeAuth vacio en respuesta Izipay.")
        }

        for (const rawValue of Object.values(record)) {
            visit(rawValue)
        }
    }

    visit(value)
    return notes
}

function extractSupportInfoFromSettlement(row: SheetRow): Partial<SupportInfo> {
    const info = extractSupportInfoFromValue({
        tarjeta: row.TARJETA,
        autorizacion: row.AUTORIZACION,
        tipoTarjeta: row["TIPO TARJETA"],
        idTransaccion: row["ID TRANSACCION"],
    })

    if (!info.authorization) {
        const authorization = normalizeAuthorization(row.AUTORIZACION)
        if (authorization) info.authorization = authorization
    }

    const card = parseCardParts(row.TARJETA)
    if (card?.first6) info.cardFirst6 = card.first6
    if (card?.last4) info.cardLast4 = card.last4
    if (info.cardFirst6 && info.cardLast4) {
        info.card64 = `${info.cardFirst6}-${info.cardLast4}`
    }

    return info
}

function getTargetOrders(workbook: XLSX.WorkBook): TargetOrder[] {
    const byOrderId = new Map<string, TargetOrder>()

    for (const sheetName of TARGET_SHEETS) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue

        const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
            defval: "",
            raw: false,
        })

        for (const row of rows) {
            const orderId = asString(row.order_id)
            if (!orderId || byOrderId.has(orderId)) continue

            byOrderId.set(orderId, {
                sheetName,
                orderId,
                operationNumber: asString(row.order_payment_operation_number) || "",
                providerRef: asString(row.order_provider_ref) || "",
                paymentMethod: asString(row.order_payment_method) || "",
                buyerEmail: asString(row.buyer_email) || "",
                buyerName: asString(row.buyer_name) || "",
                amount: asString(row.order_charged_total) || "",
                paidAt: asString(row.order_paid_at_local) || "",
            })
        }
    }

    return Array.from(byOrderId.values())
}

function buildSettlementIndex(workbook: XLSX.WorkBook): Map<string, SheetRow> {
    const index = new Map<string, SheetRow>()
    const sheet = workbook.Sheets[SETTLEMENT_SHEET]
    if (!sheet) return index

    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
        defval: "",
        raw: false,
    })

    const candidateColumns = [
        "order_payment_operation_number",
        "order_payment_operation_number DE PISCINA LIBRE",
        "REFERENCIA",
        "ID TRANSACCION",
        "ID OTROS",
    ]

    for (const row of rows) {
        for (const column of candidateColumns) {
            const key = normalizeLookupValue(row[column])
            if (key && !index.has(key)) index.set(key, row)
        }
    }

    return index
}

function getLocalDiagnosticKeys(record: JsonRecord): string[] {
    const request = asRecord(record.request)
    const requestOrder = asRecord(request?.order)
    const response = asRecord(record.response)
    const parsedPayload = parseJsonRecord(response?.payloadHttp)
    const parsedResponse = asRecord(parsedPayload?.response)
    const parsedOrders = Array.isArray(parsedResponse?.order)
        ? (parsedResponse.order as unknown[])
        : []
    const firstParsedOrder = asRecord(parsedOrders[0])

    return [
        record.orderId,
        record.orderNumber,
        record.transactionId,
        request?.transactionId,
        requestOrder?.orderNumber,
        response?.transactionId,
        firstParsedOrder?.orderNumber,
        firstParsedOrder?.referenceNumber,
    ]
        .map(normalizeLookupValue)
        .filter(Boolean)
}

function loadLocalDiagnostics(targetOrders: TargetOrder[]): Map<string, unknown[]> {
    const diagnosticsByOrder = new Map<string, unknown[]>()
    const outDir = path.resolve(process.cwd(), "scripts", "out")
    if (!fs.existsSync(outDir)) return diagnosticsByOrder

    const orderIdByKey = new Map<string, string>()
    for (const order of targetOrders) {
        for (const key of [
            order.orderId,
            order.operationNumber,
            order.providerRef,
            buildIzipayOrderNumber(order.orderId),
        ]) {
            const normalized = normalizeLookupValue(key)
            if (normalized) orderIdByKey.set(normalized, order.orderId)
        }
    }

    const files = fs
        .readdirSync(outDir)
        .filter((file) => /^izipay-.*\.json$/i.test(file))

    for (const file of files) {
        const fullPath = path.join(outDir, file)
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8")) as unknown
            const root = asRecord(parsed)
            const records = Array.isArray(root?.records) ? root.records : []

            for (const rawRecord of records) {
                const record = asRecord(rawRecord)
                if (!record) continue

                for (const key of getLocalDiagnosticKeys(record)) {
                    const orderId = orderIdByKey.get(key)
                    if (!orderId) continue

                    const existing = diagnosticsByOrder.get(orderId) || []
                    existing.push({ file, record })
                    diagnosticsByOrder.set(orderId, existing)
                    break
                }
            }
        } catch {
            // Ignorar diagnosticos corruptos o parciales.
        }
    }

    return diagnosticsByOrder
}

async function loadOrdersFromDb(orderIds: string[]): Promise<Map<string, DbOrder>> {
    const result = new Map<string, DbOrder>()
    if (!process.env.DATABASE_URL || orderIds.length === 0) return result

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 5_000,
        max: 2,
    })

    try {
        const response = await pool.query<DbOrder>(
            `
            SELECT
                id,
                status,
                "providerRef",
                "providerOrderNumber",
                "providerTransactionId",
                "providerResponse"
            FROM orders
            WHERE id = ANY($1::text[])
            `,
            [orderIds]
        )

        for (const row of response.rows) {
            result.set(row.id, row)
        }
    } finally {
        await pool.end().catch(() => undefined)
    }

    return result
}

function shouldCallApi(info: SupportInfo): boolean {
    return !info.authorization || !info.card64
}

async function enrichFromApi(order: TargetOrder, dbOrder: DbOrder | undefined) {
    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    if (!merchantCode) {
        return {
            queryError: "Falta IZIPAY_MERCHANT_CODE",
            notes: ["No se consulto API: falta IZIPAY_MERCHANT_CODE"],
        } satisfies Partial<SupportInfo>
    }

    const orderNumber =
        dbOrder?.providerOrderNumber ||
        buildIzipayOrderNumber(order.orderId)
    const transactionId =
        dbOrder?.providerTransactionId ||
        order.providerRef ||
        order.orderId

    const response = await searchIzipayTransaction({
        merchantCode,
        orderNumber,
        transactionId,
        language: getIzipayQueryLanguage(),
    })

    const info = extractSupportInfoFromValue(response.raw)
    info.notes = [
        ...(info.notes || []),
        ...extractIzipayOutcomeNotes(response.raw),
    ]
    info.queryStatus = response.status || (response.success ? "OK" : "ERROR")
    if (!response.success) {
        info.queryError = response.error || "Error desconocido en consulta Izipay"
        info.notes = [
            ...(info.notes || []),
            `API Izipay no devolvio datos completos: ${info.queryError}`,
        ]
    }

    return info
}

function appendSupportColumns(row: SheetRow, info: SupportInfo): SheetRow {
    const notes = [...info.notes]
    const method = asString(row.order_payment_method) || info.paymentMethod || ""
    if (!info.card64 && /qr|yape|plin/i.test(method)) {
        notes.push("Medio QR/Yape/Plin: puede no aplicar tarjeta 6-4.")
    }

    return {
        ...row,
        izipay_tarjeta_6_4: info.card64 || "",
        izipay_tarjeta_bin_6: info.cardFirst6 || "",
        izipay_tarjeta_ult_4: info.cardLast4 || "",
        izipay_numero_autorizacion: info.authorization || "",
        izipay_marca_tarjeta: info.cardBrand || "",
        izipay_fuente_dato: info.sources.join(" + "),
        izipay_estado_consulta: info.queryStatus || "",
        izipay_observacion: Array.from(new Set(notes)).join(" | "),
    }
}

function buildSummaryRows(targetOrders: TargetOrder[], infoByOrder: Map<string, SupportInfo>) {
    return targetOrders.map((order) => {
        const info = infoByOrder.get(order.orderId) || emptyInfo()
        const complete = Boolean(info.card64 && info.authorization)
        return {
            hoja: order.sheetName,
            order_id: order.orderId,
            buyer_name: order.buyerName,
            buyer_email: order.buyerEmail,
            paid_at_local: order.paidAt,
            amount: order.amount,
            payment_method: order.paymentMethod,
            order_payment_operation_number: order.operationNumber,
            order_provider_ref: order.providerRef,
            izipay_tarjeta_6_4: info.card64 || "",
            izipay_tarjeta_bin_6: info.cardFirst6 || "",
            izipay_tarjeta_ult_4: info.cardLast4 || "",
            izipay_numero_autorizacion: info.authorization || "",
            izipay_marca_tarjeta: info.cardBrand || "",
            fuente: info.sources.join(" + "),
            completo: complete ? "SI" : "NO",
            observacion: Array.from(new Set(info.notes)).join(" | "),
        }
    })
}

function writeOutputWorkbook(
    workbook: XLSX.WorkBook,
    targetOrders: TargetOrder[],
    infoByOrder: Map<string, SupportInfo>,
    outputPath: string
) {
    const out = XLSX.utils.book_new()

    for (const sheetName of workbook.SheetNames) {
        if ((TARGET_SHEETS as readonly string[]).includes(sheetName)) {
            const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName], {
                defval: "",
                raw: false,
            })
            const enrichedRows = rows.map((row) => {
                const orderId = asString(row.order_id)
                const info = orderId ? infoByOrder.get(orderId) || emptyInfo() : emptyInfo()
                return appendSupportColumns(row, info)
            })
            XLSX.utils.book_append_sheet(
                out,
                XLSX.utils.json_to_sheet(enrichedRows),
                sheetName
            )
            continue
        }

        XLSX.utils.book_append_sheet(out, workbook.Sheets[sheetName], sheetName)
    }

    const summaryRows = buildSummaryRows(targetOrders, infoByOrder)
    XLSX.utils.book_append_sheet(
        out,
        XLSX.utils.json_to_sheet(summaryRows),
        "soporte_izipay"
    )

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    XLSX.writeFile(out, outputPath)
}

async function main() {
    const inputPath = process.argv[2] || DEFAULT_INPUT
    const outputPath =
        process.argv[3] ||
        path.resolve(
            process.cwd(),
            "scripts",
            "out",
            `cruce-izipay-soporte-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`
        )

    const workbook = XLSX.readFile(inputPath, { cellDates: true })
    const targetOrders = getTargetOrders(workbook)
    const settlementIndex = buildSettlementIndex(workbook)
    const localDiagnostics = loadLocalDiagnostics(targetOrders)
    const infoByOrder = new Map<string, SupportInfo>()

    console.log(`Ordenes unicas objetivo: ${targetOrders.length}`)
    console.log(`Ordenes con diagnostico local: ${localDiagnostics.size}`)

    let dbOrders = new Map<string, DbOrder>()
    try {
        dbOrders = await loadOrdersFromDb(targetOrders.map((order) => order.orderId))
        console.log(`Ordenes encontradas en DB: ${dbOrders.size}`)
    } catch (error) {
        console.warn(
            `No se pudo leer DB; se continua con Excel/API: ${(error as Error).message}`
        )
    }

    for (const order of targetOrders) {
        const info = emptyInfo()
        const settlement =
            settlementIndex.get(normalizeLookupValue(order.operationNumber)) ||
            settlementIndex.get(normalizeLookupValue(order.providerRef))

        if (settlement) {
            mergeInfo(info, extractSupportInfoFromSettlement(settlement), "cruce")
        }

        const dbOrder = dbOrders.get(order.orderId)
        if (dbOrder) {
            mergeInfo(
                info,
                {
                    providerTransactionId:
                        dbOrder.providerTransactionId ||
                        dbOrder.providerRef ||
                        undefined,
                },
                "db"
            )
            mergeInfo(info, extractSupportInfoFromValue(dbOrder.providerResponse), "db")
        }

        for (const diagnostic of localDiagnostics.get(order.orderId) || []) {
            const diagnosticInfo = extractSupportInfoFromValue(diagnostic)
            diagnosticInfo.notes = [
                ...(diagnosticInfo.notes || []),
                ...extractIzipayOutcomeNotes(diagnostic),
            ]
            mergeInfo(
                info,
                diagnosticInfo,
                "diagnostico_local"
            )
        }

        if (shouldCallApi(info)) {
            try {
                const apiInfo = await enrichFromApi(order, dbOrder)
                mergeInfo(info, apiInfo, "api")
            } catch (error) {
                info.queryError = (error as Error).message
                info.notes.push(`API Izipay fallo: ${info.queryError}`)
            }
        }

        if (!info.card64 && !/qr|yape|plin/i.test(order.paymentMethod)) {
            info.notes.push("No se encontro tarjeta 6-4 en cruce, DB ni API.")
        }
        if (!info.authorization) {
            info.notes.push("No se encontro numero de autorizacion en cruce, DB ni API.")
        }

        infoByOrder.set(order.orderId, info)
    }

    writeOutputWorkbook(workbook, targetOrders, infoByOrder, outputPath)

    const summary = buildSummaryRows(targetOrders, infoByOrder)
    const complete = summary.filter((row) => row.completo === "SI").length
    const missingCard = summary.filter((row) => !row.izipay_tarjeta_6_4).length
    const missingAuthorization = summary.filter((row) => !row.izipay_numero_autorizacion).length

    console.log(`Completas tarjeta+autorizacion: ${complete}/${summary.length}`)
    console.log(`Sin tarjeta 6-4: ${missingCard}`)
    console.log(`Sin autorizacion: ${missingAuthorization}`)
    console.log(`Salida: ${outputPath}`)

    const incomplete = summary.filter((row) => row.completo !== "SI")
    if (incomplete.length > 0) {
        console.log("Ordenes incompletas:")
        for (const row of incomplete) {
            console.log(
                `- ${row.order_id} op=${row.order_payment_operation_number} method=${row.payment_method} obs=${row.observacion}`
            )
        }
    }
}

main().catch((error) => {
    console.error("Error fatal:", error)
    process.exitCode = 1
})
