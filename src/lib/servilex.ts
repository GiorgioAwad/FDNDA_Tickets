import crypto from "crypto"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"

export interface ServilexConfig {
    enabled: boolean
    endpoint: string
    token: string
    empresa: string
    usuario: string
    password: string
    terminal: string
    codigoEmp: string
    sucursal: string
    serieBoleta: string
    serieFactura: string
    formaPago: string
    tarjetaTipo: string
    tarjetaProcedencia: string
    condicionPago: string
    tipoTributo: string
    referencia: string
    tipoRegistro: string
    ejecutivo: string
    maxRetries: number
}

export interface ServilexMeta {
    version: string
    traceId: string
    timestamp: string
    terminal: string
    hash: string
}

export interface ServilexSeguridad {
    empresa: string
    usuario: string
    password: string
    token: string
}

export interface ServilexComprobante {
    tipo: "BOL" | "FAC"
    serie: string
    numero: string
}

export interface ServilexEntidad {
    tipoDocumento: string
    numeroDocumento: string
    apellidoPaterno: string
    apellidoMaterno: string
    primerNombre: string
    segundoNombre: string
    direccion: string
    ubigeo: string
    email: string
    celular: string
    codigoReferencia: string
}

export interface ServilexCabecera {
    codigoEmp: string
    sucursal: string
    indicador: string
    comprobante: ServilexComprobante
    entidad: ServilexEntidad
    fechaEmision: string
    fechaVencimiento: string
    moneda: string
    total: number
    ejecutivo: string
    condicionPago: string
    tipoTributo: string
    referencia: string
    tipoRegistro: string
}

export interface ServilexDetalleItem {
    matricula: string
    servicio: string
    disciplina: string
    horario: string
    piscina: string
    periodo: string
    mes: string
    precio: number
}

export interface ServilexCobranza {
    formaPago: string
    mensajeUsuario: string
    codigo: string
    numeroTarjeta: string
    importe: number
    fecha: string
}

export interface ServilexPayload {
    meta: ServilexMeta
    seguridad: ServilexSeguridad
    cabecera: ServilexCabecera
    detalle: ServilexDetalleItem[]
    cobranza: ServilexCobranza
}

export interface ServilexResponseMeta {
    traceId?: string
    status?: "success" | "error"
    timestamp?: string
}

export interface ServilexApiResponse {
    meta?: ServilexResponseMeta
    data?: {
        mensaje?: string
        reciboHash?: string
        pdfUrl?: string
        invoiceNumber?: string
    }
    error?: {
        codigo?: string
        mensaje?: string
    }
}

export interface ServilexRequestResult {
    ok: boolean
    status: number
    rawPayload: string
    signature: string
    responseBody: unknown
    parsed?: ServilexApiResponse
    errorCode?: string
    errorMessage?: string
    reciboHash?: string
    pdfUrl?: string
    invoiceNumber?: string
}

export interface ServilexSourceUser {
    email: string
}

export interface ServilexSourceEvent {
    id: string
    startDate: Date
}

export interface ServilexSourceTicketType {
    name: string
    servilexEnabled: boolean
    servilexIndicator: string | null
    servilexServiceCode: string | null
    servilexDisciplineCode: string | null
    servilexScheduleCode: string | null
    servilexPoolCode: string | null
    event: ServilexSourceEvent
}

export interface ServilexSourceOrderItem {
    quantity: number
    unitPrice: unknown
    attendeeData: unknown
    ticketType: ServilexSourceTicketType
}

export interface ServilexSourceOrder {
    id?: string
    provider?: string | null
    providerRef?: string | null
    providerResponse?: unknown
    documentType: string | null
    buyerDocType: string | null
    buyerDocNumber: string | null
    buyerName: string | null
    buyerFirstName: string | null
    buyerSecondName: string | null
    buyerLastNamePaternal: string | null
    buyerLastNameMaternal: string | null
    buyerAddress: string | null
    buyerUbigeo: string | null
    buyerEmail: string | null
    buyerPhone: string | null
    currency: string
    totalAmount: unknown
    paidAt: Date | null
    createdAt: Date
    user: ServilexSourceUser
    orderItems: ServilexSourceOrderItem[]
}

export interface ServilexPayloadSource {
    id: string
    orderId: string
    traceId: string | null
    invoiceNumber: string | null
    order: ServilexSourceOrder
}

const DEFAULT_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/invoice"
const DEFAULT_SUCCESS_MESSAGE = "Su compra ha sido exitosa."

const CARD_BRAND_MAP: Record<string, string> = {
    visa: "VISA",
    mastercard: "MASTERCARD",
    master_card: "MASTERCARD",
    amex: "AMEX",
    american_express: "AMEX",
    diners: "DINERS",
    diners_club: "DINERS",
}

const PAYMENT_METHOD_MAP: Record<string, string> = {
    card: "006",
    credit_card: "006",
    credit: "006",
    debit_card: "005",
    debit: "005",
    transfer: "007",
    bank_transfer: "007",
    cash: "008",
    yape: "008",
    plin: "008",
    pago_push: "008",
    qr: "008",
}

export function getServilexConfig(): ServilexConfig {
    const maxRetriesRaw = Number(process.env.SERVILEX_MAX_RETRIES || "3")
    return {
        enabled: process.env.SERVILEX_ENABLED === "true",
        endpoint: process.env.SERVILEX_ENDPOINT || DEFAULT_ENDPOINT,
        token: process.env.SERVILEX_TOKEN || "",
        empresa: process.env.SERVILEX_EMPRESA || "FPDN",
        usuario: process.env.SERVILEX_USUARIO || "",
        password: process.env.SERVILEX_PASSWORD || "",
        terminal: process.env.SERVILEX_TERMINAL || "cajaweb",
        codigoEmp: process.env.SERVILEX_CODIGO_EMP || "001",
        sucursal: process.env.SERVILEX_SUCURSAL || "01",
        serieBoleta: process.env.SERVILEX_SERIE_BOLETA || "B001",
        serieFactura: process.env.SERVILEX_SERIE_FACTURA || "F001",
        formaPago: process.env.SERVILEX_FORMA_PAGO || "006",
        tarjetaTipo: process.env.SERVILEX_TARJETA_TIPO || "VISA",
        tarjetaProcedencia: process.env.SERVILEX_TARJETA_PROCEDENCIA || "N",
        condicionPago: process.env.SERVILEX_CONDICION_PAGO || "01",
        tipoTributo: process.env.SERVILEX_TIPO_TRIBUTO || "9998",
        referencia: process.env.SERVILEX_REFERENCIA || "-",
        tipoRegistro: process.env.SERVILEX_TIPO_REGISTRO || "2",
        ejecutivo: process.env.SERVILEX_EJECUTIVO || "",
        maxRetries: Number.isFinite(maxRetriesRaw) && maxRetriesRaw > 0 ? Math.floor(maxRetriesRaw) : 3,
    }
}

export function formatServilexTimestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

function roundCurrency(value: number): number {
    return Number(value.toFixed(2))
}

function toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10)
}

function toAmountNumber(value: unknown): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0
    if (typeof value === "string") {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
    }
    if (value && typeof value === "object" && "toString" in value) {
        const parsed = Number(String(value))
        return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null
    }

    return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

function normalizeCardBrand(raw: unknown): string | null {
    const brand = asString(raw)
    if (!brand) return null
    const key = brand.toLowerCase().replace(/[\s-]+/g, "_")
    return CARD_BRAND_MAP[key] || brand.toUpperCase()
}

function normalizeFormaPago(raw: unknown): string | null {
    const paymentMethod = asString(raw)
    if (!paymentMethod) return null
    const key = paymentMethod.toLowerCase().replace(/[\s-]+/g, "_")
    return PAYMENT_METHOD_MAP[key] || null
}

function extractDigits(value: string): string {
    return value.replace(/\D/g, "")
}

function buildFallbackDocumentNumber(seed: string): string {
    let accumulator = 0
    for (const char of seed) {
        accumulator = (accumulator * 31 + char.charCodeAt(0)) % 100000000
    }
    return String(accumulator).padStart(8, "0")
}

function getComprobanteNumero(invoiceNumber: string | null, fallbackSeed: string): string {
    const fromInvoice = asString(invoiceNumber)
    if (fromInvoice) {
        const digits = extractDigits(fromInvoice)
        if (digits) {
            return digits.slice(-8).padStart(8, "0")
        }
    }

    return buildFallbackDocumentNumber(fallbackSeed)
}

function getMaskedCardNumber(
    providerResponse: Record<string, unknown> | null,
    fallbackBrand: string | null
): string {
    const response = asRecord(providerResponse?.response)
    const responseCard = asRecord(response?.card)
    const transactionDetails = asRecord(providerResponse?.transactionDetails)
    const transactions = Array.isArray(providerResponse?.transactions)
        ? (providerResponse?.transactions as unknown[])
        : []
    const firstTransaction = asRecord(transactions[0])
    const paymentMethodDetails = asRecord(firstTransaction?.paymentMethodDetails)

    const directMasked =
        asString(responseCard?.pan) ||
        asString(responseCard?.maskedPan) ||
        asString(responseCard?.maskedCardNumber) ||
        asString(transactionDetails?.maskedCardNumber) ||
        asString(transactionDetails?.cardMask) ||
        asString(paymentMethodDetails?.maskedCardNumber) ||
        asString(providerResponse?.maskedCardNumber)

    if (directMasked) return directMasked

    const firstSix =
        asString(transactionDetails?.firstSixDigits) ||
        asString(paymentMethodDetails?.firstSixDigits) ||
        asString(providerResponse?.firstSixDigits)
    const lastFour =
        asString(transactionDetails?.lastFourDigits) ||
        asString(responseCard?.lastFourDigits) ||
        asString(paymentMethodDetails?.lastFourDigits) ||
        asString(providerResponse?.lastFourDigits)

    if (firstSix && lastFour) return `${firstSix}******${lastFour}`
    if (lastFour) return `${fallbackBrand ? `${fallbackBrand} ` : ""}******${lastFour}`

    return ""
}

function allocateLineAmounts(baseAmounts: number[], finalTotal: number): number[] {
    const finalTotalCents = Math.round(finalTotal * 100)
    const baseCents = baseAmounts.map((amount) => Math.round(amount * 100))
    const totalBaseCents = baseCents.reduce((sum, amount) => sum + amount, 0)

    if (baseCents.length === 0) return []
    if (totalBaseCents <= 0) {
        return baseCents.map(() => 0)
    }

    const provisional = baseCents.map((amount, index) => {
        const ratio = (amount / totalBaseCents) * finalTotalCents
        return {
            index,
            cents: Math.floor(ratio),
            remainder: ratio - Math.floor(ratio),
        }
    })

    let assigned = provisional.reduce((sum, item) => sum + item.cents, 0)
    let remaining = finalTotalCents - assigned

    provisional
        .sort((a, b) => b.remainder - a.remainder)
        .forEach((item) => {
            if (remaining <= 0) return
            item.cents += 1
            assigned += 1
            remaining -= 1
        })

    return provisional
        .sort((a, b) => a.index - b.index)
        .map((item) => roundCurrency(item.cents / 100))
}

function getBuyerNames(order: ServilexSourceOrder, buyerIsFactura: boolean) {
    if (buyerIsFactura) {
        return {
            apellidoPaterno: "",
            apellidoMaterno: "",
            primerNombre: order.buyerName || "",
            segundoNombre: "",
        }
    }

    return {
        apellidoPaterno: order.buyerLastNamePaternal || "",
        apellidoMaterno: order.buyerLastNameMaternal || "",
        primerNombre: order.buyerFirstName || order.buyerName || "",
        segundoNombre: order.buyerSecondName || "",
    }
}

function getPaymentMetadata(order: ServilexSourceOrder, config: ServilexConfig) {
    const providerResponse = asRecord(order.providerResponse)
    const response = asRecord(providerResponse?.response)
    const responseCard = asRecord(response?.card)
    const transactionDetails = asRecord(providerResponse?.transactionDetails)
    const transactions = Array.isArray(providerResponse?.transactions)
        ? (providerResponse?.transactions as unknown[])
        : []
    const firstTransaction = asRecord(transactions[0])
    const paymentMethodDetails = asRecord(firstTransaction?.paymentMethodDetails)

    const rawMethod =
        asString(firstTransaction?.paymentMethodType) ||
        asString(firstTransaction?.paymentMethod) ||
        asString(transactionDetails?.paymentMethod) ||
        asString(response?.payMethod) ||
        asString(paymentMethodDetails?.paymentMethodType) ||
        asString(paymentMethodDetails?.paymentMethod)

    const cardBrand =
        normalizeCardBrand(firstTransaction?.brand) ||
        normalizeCardBrand(transactionDetails?.cardBrand) ||
        normalizeCardBrand(responseCard?.brand) ||
        normalizeCardBrand(paymentMethodDetails?.brand)

    const formaPago = normalizeFormaPago(rawMethod) || config.formaPago

    const codigo =
        asString(transactionDetails?.authorizationCode) ||
        asString(firstTransaction?.authorizationCode) ||
        asString(response?.authorizationCode) ||
        asString(providerResponse?.authorizationCode) ||
        asString(order.providerRef) ||
        asString(transactionDetails?.transactionId) ||
        asString(providerResponse?.transactionId) ||
        asString(firstTransaction?.uuid) ||
        asString(firstTransaction?.transactionId) ||
        ""

    const mensajeUsuario =
        asString(providerResponse?.messageUser) ||
        asString(response?.messageUser) ||
        asString(providerResponse?.message) ||
        asString(response?.message) ||
        DEFAULT_SUCCESS_MESSAGE

    return {
        formaPago,
        mensajeUsuario,
        codigo,
        numeroTarjeta: getMaskedCardNumber(providerResponse, cardBrand),
        fecha: String((order.paidAt || order.createdAt).getTime()),
    }
}

export function buildStableTraceId(source: { traceId: string | null; id: string }): string {
    return source.traceId || `req-${source.id}`
}

export function buildServilexMetaHash(payload: Omit<ServilexPayload, "meta">): string {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex")
}

export function getServilexMissingConfig(config: ServilexConfig): string[] {
    const missing: string[] = []

    if (!config.token.trim()) missing.push("SERVILEX_TOKEN")
    if (!config.usuario.trim()) missing.push("SERVILEX_USUARIO")
    if (!config.password.trim()) missing.push("SERVILEX_PASSWORD")

    return missing
}

export function buildServilexPayload(
    source: ServilexPayloadSource,
    config: ServilexConfig = getServilexConfig()
): ServilexPayload {
    const order = source.order
    const servilexItems = order.orderItems.filter((item) => item.ticketType.servilexEnabled)

    if (servilexItems.length === 0) {
        throw new Error("La orden no tiene items Servilex habilitados")
    }

    if (servilexItems.length !== order.orderItems.length) {
        throw new Error("La orden mezcla items con y sin Servilex")
    }

    const indicators = Array.from(
        new Set(servilexItems.map((item) => (item.ticketType.servilexIndicator || "AC").trim()))
    )

    if (indicators.length !== 1) {
        throw new Error("La orden tiene indicadores Servilex inconsistentes")
    }

    const rawDetailLines = servilexItems.flatMap((item) => {
        const servicio = item.ticketType.servilexServiceCode?.trim()
        const disciplina = item.ticketType.servilexDisciplineCode?.trim()
        const horario = item.ticketType.servilexScheduleCode?.trim()
        const piscina = item.ticketType.servilexPoolCode?.trim()

        if (!servicio || !disciplina || !horario || !piscina) {
            throw new Error(`Faltan códigos Servilex obligatorios en ${item.ticketType.name}`)
        }

        const attendeeData = Array.isArray(item.attendeeData)
            ? (item.attendeeData as Array<Record<string, unknown>>)
            : []

        return Array.from({ length: item.quantity }, (_, index) => {
            const attendee = attendeeData[index] || {}
            const matricula = asString(attendee.matricula)

            if (!matricula) {
                throw new Error(`Falta matricula Servilex en ${item.ticketType.name}`)
            }

            const selections = normalizeScheduleSelections(attendee.scheduleSelections)
            const selectedDate = selections[0]?.date
            const serviceDate = selectedDate
                ? new Date(`${selectedDate}T12:00:00Z`)
                : item.ticketType.event.startDate

            return {
                matricula,
                servicio,
                disciplina,
                horario,
                piscina,
                periodo: String(serviceDate.getUTCFullYear()),
                mes: String(serviceDate.getUTCMonth() + 1).padStart(2, "0"),
                precioBase: toAmountNumber(item.unitPrice),
            }
        })
    })

    const totalFromOrder = toAmountNumber(order.totalAmount)
    const allocatedPrices = allocateLineAmounts(
        rawDetailLines.map((line) => line.precioBase),
        totalFromOrder
    )

    const detalle: ServilexDetalleItem[] = rawDetailLines.map((line, index) => ({
        matricula: line.matricula,
        servicio: line.servicio,
        disciplina: line.disciplina,
        horario: line.horario,
        piscina: line.piscina,
        periodo: line.periodo,
        mes: line.mes,
        precio: allocatedPrices[index] ?? 0,
    }))

    const total = roundCurrency(detalle.reduce((sum, item) => sum + item.precio, 0))
    const issueDate = toDateOnly(order.paidAt || order.createdAt)
    const buyerIsFactura = order.documentType === "FACTURA"
    const buyerNames = getBuyerNames(order, buyerIsFactura)
    const payment = getPaymentMetadata(order, config)

    const cabecera: ServilexCabecera = {
        codigoEmp: config.codigoEmp,
        sucursal: config.sucursal,
        indicador: indicators[0],
        comprobante: {
            tipo: buyerIsFactura ? "FAC" : "BOL",
            serie: buyerIsFactura ? config.serieFactura : config.serieBoleta,
            numero: getComprobanteNumero(source.invoiceNumber, source.orderId || source.id),
        },
        entidad: {
            tipoDocumento: order.buyerDocType || (buyerIsFactura ? "6" : "1"),
            numeroDocumento: order.buyerDocNumber || "",
            apellidoPaterno: buyerNames.apellidoPaterno,
            apellidoMaterno: buyerNames.apellidoMaterno,
            primerNombre: buyerNames.primerNombre,
            segundoNombre: buyerNames.segundoNombre,
            direccion: order.buyerAddress || "",
            ubigeo: order.buyerUbigeo || "",
            email: order.buyerEmail || order.user.email,
            celular: order.buyerPhone || "",
            codigoReferencia: order.providerRef || order.id || source.orderId,
        },
        fechaEmision: issueDate,
        fechaVencimiento: issueDate,
        moneda: order.currency === "USD" ? "02" : "01",
        total,
        ejecutivo: config.ejecutivo,
        condicionPago: config.condicionPago,
        tipoTributo: config.tipoTributo,
        referencia: config.referencia,
        tipoRegistro: config.tipoRegistro,
    }

    const seguridad: ServilexSeguridad = {
        empresa: config.empresa,
        usuario: config.usuario,
        password: config.password,
        token: config.token,
    }

    const cobranza: ServilexCobranza = {
        formaPago: payment.formaPago,
        mensajeUsuario: payment.mensajeUsuario,
        codigo: payment.codigo,
        numeroTarjeta: payment.numeroTarjeta,
        importe: total,
        fecha: payment.fecha,
    }

    const unsignedPayload = {
        seguridad,
        cabecera,
        detalle,
        cobranza,
    } satisfies Omit<ServilexPayload, "meta">

    return {
        meta: {
            version: "1.0",
            traceId: buildStableTraceId(source),
            timestamp: formatServilexTimestamp(new Date()),
            terminal: config.terminal,
            hash: buildServilexMetaHash(unsignedPayload),
        },
        ...unsignedPayload,
    }
}

export function buildServilexSignature(rawBody: string, token: string): string {
    return crypto.createHmac("sha256", token).update(rawBody).digest("hex")
}

export async function sendServilexInvoice(
    payload: ServilexPayload,
    config: ServilexConfig = getServilexConfig()
): Promise<ServilexRequestResult> {
    const rawPayload = JSON.stringify(payload)
    const signature = buildServilexSignature(rawPayload, config.token)

    const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-ABIO-Token": config.token,
            "X-ABIO-Signature": signature,
            "X-ABIO-Empresa": config.empresa,
        },
        body: rawPayload,
    })

    const responseText = await response.text()
    let responseBody: unknown = responseText
    let parsed: ServilexApiResponse | undefined

    try {
        responseBody = responseText ? JSON.parse(responseText) : null
        parsed = responseBody as ServilexApiResponse
    } catch {
        parsed = undefined
    }

    const success = response.ok && parsed?.meta?.status === "success"
    const errorCode = parsed?.error?.codigo
    const errorMessage =
        parsed?.error?.mensaje ||
        (typeof responseBody === "string" && responseBody.trim().length > 0
            ? responseBody
            : `HTTP ${response.status}`)

    return {
        ok: success || errorCode === "DUPLICATE_TRACE",
        status: response.status,
        rawPayload,
        signature,
        responseBody,
        parsed,
        errorCode,
        errorMessage,
        reciboHash: parsed?.data?.reciboHash,
        pdfUrl: parsed?.data?.pdfUrl,
        invoiceNumber: parsed?.data?.invoiceNumber,
    }
}
