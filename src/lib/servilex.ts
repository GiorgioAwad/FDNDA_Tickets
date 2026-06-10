import crypto from "crypto"
import { buildNaturalPersonFullName, splitNaturalPersonName } from "@/lib/billing"
import {
    extractIzipayOperationNumber,
    IZIPAY_OPERATION_NUMBER_MAX_LENGTH,
} from "@/lib/payment-details"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"

export type ServilexIndicator = "AC" | "OS" | "PN" | "PA"
export type ServilexInvoiceGroupType = "ALUMNO" | "INDICATOR"
export type ServilexEventCategory = "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"

const SUPPORTED_INDICATORS = new Set<ServilexIndicator>(["AC", "OS", "PN", "PA"])
const SUPPORTED_EVENT_CATEGORIES = new Set<ServilexEventCategory>([
    "EVENTO",
    "PISCINA_LIBRE",
    "ACADEMIA",
])
const DEFAULT_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/invoice"
const DEFAULT_ABIO_VERSION = "1.2"
const SERVILEX_REFERENCE_MAX_LENGTH = 6
const SERVILEX_DECIMAL_FIELDS = new Set(["assignedTotal", "descuento", "precio", "total", "totalPago"])
const SERVILEX_DECIMAL_TOKEN_PREFIX = "__SERVILEX_DECIMAL__"

const CARD_BRAND_MAP: Record<string, string> = {
    ae: "AMEX",
    mc: "MASTERCARD",
    vs: "VISA",
    visa: "VISA",
    mastercard: "MASTERCARD",
    master_card: "MASTERCARD",
    amex: "AMEX",
    american_express: "AMEX",
    dn: "DINERS",
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
    yape: "997",
    plin: "998",
    pago_push: "008",
    qr: "008",
}

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
}

export interface ServilexComprobante {
    tipo: "BOL" | "FAC"
    serie: string
}

export interface ServilexEntidad {
    tipoDocumento: string
    numeroDocumento: string
    razonSocial: string
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

export interface ServilexAlumno {
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
    indicador: ServilexIndicator
    comprobante: ServilexComprobante
    entidad: ServilexEntidad
    alumno?: ServilexAlumno
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

export interface ServilexDetalleAcademiaItem {
    matricula: string
    servicio: string
    disciplina: string
    horario: string
    piscina: string
    periodo: string
    mes: string
    precio: number
}

export interface ServilexDetalleOtrosServiciosItem {
    servicio: string
    cantidad: number
    descuento: number
    precio: number
}

export interface ServilexDetallePiscinaItem {
    servicio: string
    cantidad: number
    horaInicio: string
    horaFin: string
    duracion: number
    piscina: string
    precio: number
}

export type ServilexDetalleItem =
    | ServilexDetalleAcademiaItem
    | ServilexDetalleOtrosServiciosItem
    | ServilexDetallePiscinaItem

export interface ServilexCobranza {
    nroOperacion: string
    formaPago: string
    tarjetaTipo: string
    tarjetaProcedencia: string
    totalPago: number
}

export interface ServilexPayload {
    meta: ServilexMeta
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
    category?: string | null
    servilexSucursalCode?: string | null
}

export interface ServilexSourceTicketType {
    name: string
    servilexEnabled: boolean
    servilexIndicator: string | null
    servilexSucursalCode: string | null
    servilexServiceCode: string | null
    servilexDisciplineCode: string | null
    servilexScheduleCode: string | null
    servilexPoolCode: string | null
    servilexExtraConfig: unknown
    event: ServilexSourceEvent
}

export interface ServilexSourceMerchProduct {
    id: string
    name: string
    servilexServiceCode: string | null
    servilexSucursalCode: string | null
}

export interface ServilexSourceMerchVariant {
    id: string
    size: string | null
    product: ServilexSourceMerchProduct
}

export interface ServilexSourceOrderItem {
    id?: string | null
    quantity: number
    unitPrice: unknown
    attendeeData: unknown
    ticketType: ServilexSourceTicketType | null
    merchVariant?: ServilexSourceMerchVariant | null
}

export interface ServilexSourceOrder {
    id?: string
    provider?: string | null
    providerRef?: string | null
    providerOrderNumber?: string | null
    providerTransactionId?: string | null
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

export interface ServilexSnapshotAlumno {
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

export interface ServilexInvoiceSnapshot {
    indicator: ServilexIndicator
    sucursal: string
    eventCategory: ServilexEventCategory | null
    groupType: ServilexInvoiceGroupType
    groupKey: string
    legacyGroupKey?: string
    groupLabel: string
    assignedTotal: number
    alumno: ServilexSnapshotAlumno | null
    detalle:
        | ServilexDetalleAcademiaItem[]
        | ServilexDetalleOtrosServiciosItem[]
        | ServilexDetallePiscinaItem[]
}

export interface ServilexPayloadSource {
    id: string
    orderId: string
    traceId: string | null
    invoiceNumber: string | null
    servilexIndicator: string | null
    servilexGroupKey: string
    servilexGroupLabel: string | null
    servilexAssignedTotal: unknown
    servilexSucursalCode: string | null
    alumnoSnapshot: unknown
    servilexPayloadSnapshot: unknown
    order: ServilexSourceOrder
}

type ServilexAttendeeRecord = {
    name: string
    firstName: string
    secondName: string
    lastNamePaternal: string
    lastNameMaternal: string
    dni: string
    matricula: string
    scheduleSelections: Array<{ date: string; shift: string | null }>
}

type ServilexUnitBase = {
    indicator: ServilexIndicator
    sucursal: string
    eventCategory: ServilexEventCategory | null
    baseAmount: number
    sourceItemKey: string
    sourceUnitIndex: number
}

type ServilexAcademiaUnit = ServilexUnitBase & {
    indicator: "AC"
    attendee: ServilexAttendeeRecord
    detalle: Omit<ServilexDetalleAcademiaItem, "precio">
    alumno: ServilexSnapshotAlumno
}

type ServilexOtrosServiciosUnit = ServilexUnitBase & {
    indicator: "OS"
    detalle: Omit<ServilexDetalleOtrosServiciosItem, "precio">
}

type ServilexPiscinaLibreUnit = ServilexUnitBase & {
    indicator: "PN" | "PA"
    detalle: Omit<ServilexDetallePiscinaItem, "precio">
}

type ServilexInvoiceUnit =
    | ServilexAcademiaUnit
    | ServilexOtrosServiciosUnit
    | ServilexPiscinaLibreUnit

function getServilexTipoTributo(indicator: ServilexIndicator, config: ServilexConfig): string {
    const perIndicatorOverride =
        process.env[`SERVILEX_TIPO_TRIBUTO_${indicator}` as keyof NodeJS.ProcessEnv]

    if (perIndicatorOverride && perIndicatorOverride.trim()) {
        return perIndicatorOverride.trim()
    }

    if (indicator === "OS") {
        return "1000"
    }

    if (indicator === "AC" || indicator === "PN" || indicator === "PA") {
        return "9998"
    }

    return config.tipoTributo
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
        ejecutivo: process.env.SERVILEX_EJECUTIVO || "0020",
        maxRetries: Number.isFinite(maxRetriesRaw) && maxRetriesRaw > 0 ? Math.floor(maxRetriesRaw) : 3,
    }
}

export function formatServilexTimestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

function roundCurrency(value: number): number {
    return Number(value.toFixed(2))
}

function formatServilexDecimal(value: number): string {
    return roundCurrency(value).toFixed(2)
}

function sanitizeUtf8Text(value: string): string {
    let cleaned = value.replace(/^\uFEFF/, "")

    const mojibakeMap: [string, string][] = [
        ["Ã¡", "á"], ["Ã©", "é"], ["Ã­", "í"], ["Ã³", "ó"], ["Ãº", "ú"],
        ["Ã±", "ñ"], ["Ã¼", "ü"],
        ["Ã\x81", "Á"], ["Ã\x89", "É"], ["Ã\x8D", "Í"], ["Ã\x93", "Ó"], ["Ã\x9A", "Ú"],
        ["Ã\x91", "Ñ"], ["Ã\x9C", "Ü"],
    ]
    for (const [broken, fixed] of mojibakeMap) {
        cleaned = cleaned.replaceAll(broken, fixed)
    }

    cleaned = cleaned.normalize("NFC")
    cleaned = cleaned.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "")

    return cleaned
}

function toDateOnly(value: Date): string {
    // Fecha calendario en hora de Perú (UTC-5), no UTC. El servidor corre en UTC,
    // así que un slice de toISOString() corría las ventas nocturnas Lima al día
    // siguiente (y cruzaba periodo tributario a fin de mes). Ver fechaEmision.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(value)
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

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "string" || !value.trim()) {
        return null
    }

    try {
        return asRecord(JSON.parse(value))
    } catch {
        return null
    }
}

function asString(value: unknown): string | null {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

function normalizeGroupKeySegment(value: string): string {
    const normalized = value
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "")

    return normalized || "item"
}

function buildSourceItemKey(item: ServilexSourceOrderItem, itemIndex: number): string {
    const itemId = asString(item.id)
    if (itemId) {
        return normalizeGroupKeySegment(itemId)
    }

    const fallbackParts = [
        item.ticketType?.event.id,
        item.ticketType?.name,
        String(itemIndex + 1),
    ].filter((part): part is string => typeof part === "string" && part.trim().length > 0)

    return normalizeGroupKeySegment(fallbackParts.join("-"))
}

function asPositiveNumber(value: unknown): number | null {
    const parsed = toAmountNumber(value)
    return parsed > 0 ? parsed : null
}

function asNonNegativeNumber(value: unknown): number | null {
    const parsed = toAmountNumber(value)
    return parsed >= 0 ? parsed : null
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

function normalizeReferenceCode(raw: unknown, fallbackSeed: string): string {
    const source =
        (typeof raw === "string" && raw.trim()) ||
        (typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "") ||
        fallbackSeed

    const normalized = sanitizeUtf8Text(source)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")

    if (normalized) {
        return normalized.slice(-SERVILEX_REFERENCE_MAX_LENGTH)
    }

    return buildFallbackDocumentNumber(fallbackSeed).slice(-SERVILEX_REFERENCE_MAX_LENGTH)
}

type ServilexQuoteEscapeMode = "backslash" | "strip" | "double" | "off"

function getServilexQuoteEscapeMode(): ServilexQuoteEscapeMode {
    const raw = (process.env.SERVILEX_QUOTE_ESCAPE_MODE || "backslash").trim().toLowerCase()
    if (raw === "strip" || raw === "double" || raw === "off") {
        return raw
    }
    return "backslash"
}

// ABIO no tolera el apostrofo crudo en los textos del payload: rompe su
// procesamiento del JSON (reportado 2026-06-10 con "Dall' Orso") y pidieron
// enviar ese caracter escapado. Por defecto se envia \' (y \ como \\).
// SERVILEX_QUOTE_ESCAPE_MODE permite cambiar a "strip" (eliminarlo),
// "double" ('' estilo SQL) u "off" sin redeploy si ABIO espera otra cosa.
function escapeServilexQuotes(value: string): string {
    const normalized = value.replace(/[‘’ʼ´`]/g, "'")

    if (!normalized.includes("'") && !normalized.includes("\\")) {
        return normalized
    }

    const mode = getServilexQuoteEscapeMode()

    if (mode === "off") {
        return normalized
    }

    if (mode === "strip") {
        return normalized.replace(/'/g, "")
    }

    if (mode === "double") {
        return normalized.replace(/'/g, "''")
    }

    return normalized.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function normalizeServilexJsonValue(value: unknown): unknown {
    if (value instanceof Date) {
        return value.toJSON()
    }

    if (typeof value === "string") {
        return escapeServilexQuotes(sanitizeUtf8Text(value))
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeServilexJsonValue(entry))
    }

    if (!value || typeof value !== "object") {
        return value
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            normalizeServilexJsonValue(entry),
        ])
    )
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

function normalizeIndicator(raw: unknown, fallback: ServilexIndicator = "AC"): ServilexIndicator {
    const value = asString(raw)?.toUpperCase()
    if (value && SUPPORTED_INDICATORS.has(value as ServilexIndicator)) {
        return value as ServilexIndicator
    }
    return fallback
}

function normalizeEventCategory(raw: unknown): ServilexEventCategory | null {
    const value = asString(raw)?.toUpperCase()
    if (value && SUPPORTED_EVENT_CATEGORIES.has(value as ServilexEventCategory)) {
        return value as ServilexEventCategory
    }
    return null
}

function normalizeCode(raw: unknown, fieldName: string): string {
    const value = asString(raw)
    if (!value) {
        throw new Error(`Falta ${fieldName} Servilex obligatorio`)
    }
    return value
}

function normalizeHora(raw: unknown, fieldName: string): string {
    const value = asString(raw)
    if (!value || !/^\d{2}:\d{2}$/.test(value)) {
        throw new Error(`Falta ${fieldName} Servilex válido`)
    }
    return value
}

function getJsonObject(raw: unknown): Record<string, unknown> {
    return asRecord(raw) || {}
}

function getAcAttendeeData(raw: unknown): ServilexAttendeeRecord {
    const attendeeRecord = asRecord(raw)
    const explicitFirstName = asString(attendeeRecord?.firstName)
    const explicitSecondName = asString(attendeeRecord?.secondName)
    const explicitLastNamePaternal = asString(attendeeRecord?.lastNamePaternal)
    const explicitLastNameMaternal = asString(attendeeRecord?.lastNameMaternal)
    const legacyName = asString(attendeeRecord?.name)
    const fallbackNames = splitNaturalPersonName(legacyName || "")
    const firstName = explicitFirstName || fallbackNames.firstName
    const secondName = explicitSecondName || fallbackNames.secondName
    const lastNamePaternal = explicitLastNamePaternal || fallbackNames.lastNamePaternal
    const lastNameMaternal = explicitLastNameMaternal || fallbackNames.lastNameMaternal
    const name =
        buildNaturalPersonFullName({
            firstName,
            secondName,
            lastNamePaternal,
            lastNameMaternal,
        }) || legacyName
    const dni = extractDigits(asString(attendeeRecord?.dni) || "")
    const matricula = asString(attendeeRecord?.matricula)

    if (!name) {
        throw new Error("Falta nombre del alumno para comprobante AC")
    }

    if (!dni) {
        throw new Error("Falta DNI del alumno para comprobante AC")
    }

    if (!matricula) {
        throw new Error("Falta matricula Servilex para comprobante AC")
    }

    return {
        name,
        firstName,
        secondName,
        lastNamePaternal,
        lastNameMaternal,
        dni,
        matricula,
        scheduleSelections: normalizeScheduleSelections(attendeeRecord?.scheduleSelections),
    }
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

    let remaining = finalTotalCents - provisional.reduce((sum, item) => sum + item.cents, 0)

    provisional
        .sort((a, b) => b.remainder - a.remainder)
        .forEach((item) => {
            if (remaining <= 0) return
            item.cents += 1
            remaining -= 1
        })

    return provisional
        .sort((a, b) => a.index - b.index)
        .map((item) => roundCurrency(item.cents / 100))
}

function getBuyerNames(order: ServilexSourceOrder) {
    const razonSocial =
        asString(order.buyerName) ||
        buildNaturalPersonFullName({
            firstName: order.buyerFirstName,
            secondName: order.buyerSecondName,
            lastNamePaternal: order.buyerLastNamePaternal,
            lastNameMaternal: order.buyerLastNameMaternal,
        })

    if (order.documentType === "FACTURA") {
        return {
            razonSocial,
            apellidoPaterno: "",
            apellidoMaterno: "",
            primerNombre: razonSocial,
            segundoNombre: "",
        }
    }

    const normalized = splitNaturalPersonName(razonSocial)
    return {
        razonSocial,
        apellidoPaterno: asString(order.buyerLastNamePaternal) || normalized.lastNamePaternal,
        apellidoMaterno: asString(order.buyerLastNameMaternal) || normalized.lastNameMaternal,
        primerNombre: asString(order.buyerFirstName) || normalized.firstName,
        segundoNombre: asString(order.buyerSecondName) || normalized.secondName,
    }
}

function getPaymentMetadata(order: ServilexSourceOrder, config: ServilexConfig) {
    const providerEnvelope = asRecord(order.providerResponse)
    const providerResponse = asRecord(providerEnvelope?.data) || providerEnvelope
    const payloadHttp = parseJsonRecord(providerResponse?.payloadHttp)
    const response = asRecord(providerResponse?.response) || asRecord(payloadHttp?.response)
    const responseCard = asRecord(response?.card)
    const transactionDetails =
        asRecord(providerResponse?.transactionDetails) || asRecord(payloadHttp?.transactionDetails)
    const transactions = Array.isArray(providerResponse?.transactions)
        ? (providerResponse?.transactions as unknown[])
        : Array.isArray(payloadHttp?.transactions)
            ? (payloadHttp?.transactions as unknown[])
        : []
    const firstTransaction = asRecord(transactions[0])
    const paymentMethodDetails = asRecord(firstTransaction?.paymentMethodDetails)
    const paymentMethodCard = asRecord(paymentMethodDetails?.card)

    const rawMethod =
        asString(firstTransaction?.paymentMethodType) ||
        asString(firstTransaction?.paymentMethod) ||
        asString(transactionDetails?.paymentMethod) ||
        asString(response?.payMethod) ||
        asString(paymentMethodDetails?.paymentMethodType) ||
        asString(paymentMethodDetails?.paymentMethod) ||
        asString(providerResponse?.payMethod) ||
        asString(providerResponse?.paymentMethod)

    const cardBrand =
        normalizeCardBrand(firstTransaction?.brand) ||
        normalizeCardBrand(transactionDetails?.cardBrand) ||
        normalizeCardBrand(responseCard?.brand) ||
        normalizeCardBrand(paymentMethodDetails?.brand) ||
        normalizeCardBrand(paymentMethodCard?.brand) ||
        normalizeCardBrand(providerResponse?.cardBrand) ||
        normalizeCardBrand(providerResponse?.brand) ||
        config.tarjetaTipo

    const tarjetaProcedencia =
        (asString(firstTransaction?.cardProcedencia) ||
            asString(transactionDetails?.cardProcedencia) ||
            asString(paymentMethodDetails?.cardProcedencia) ||
            asString(providerResponse?.cardProcedencia) ||
            config.tarjetaProcedencia)
            .toUpperCase()

    const nroOperacion = extractIzipayOperationNumber(order)

    if (!nroOperacion) {
        throw new Error(
            `Falta nroOperacion ABIO valido para cobranza (maximo ${IZIPAY_OPERATION_NUMBER_MAX_LENGTH} caracteres)`
        )
    }

    return {
        nroOperacion,
        formaPago: normalizeFormaPago(rawMethod) || config.formaPago,
        tarjetaTipo: cardBrand,
        tarjetaProcedencia: tarjetaProcedencia === "I" ? "I" : "N",
    }
}

function getCurrencyCode(order: ServilexSourceOrder): string {
    return order.currency === "USD" ? "02" : "01"
}

function buildAttendeeAlumnoSnapshot(
    attendee: ServilexAttendeeRecord,
    order: ServilexSourceOrder
): ServilexSnapshotAlumno {
    const numeroDocumento = extractDigits(attendee.dni) || buildFallbackDocumentNumber(attendee.matricula)

    return {
        tipoDocumento: "1",
        numeroDocumento: numeroDocumento.slice(0, 8),
        apellidoPaterno: attendee.lastNamePaternal,
        apellidoMaterno: attendee.lastNameMaternal,
        primerNombre: attendee.firstName || attendee.name,
        segundoNombre: attendee.secondName,
        direccion: asString(order.buyerAddress) || "",
        ubigeo: asString(order.buyerUbigeo) || "",
        email: asString(order.buyerEmail) || order.user.email,
        celular: asString(order.buyerPhone) || "",
        codigoReferencia: normalizeReferenceCode(attendee.matricula, `${attendee.dni}:${attendee.matricula}`),
    }
}

function getServilexItemSucursal(item: ServilexSourceOrderItem): string {
    if (!item.ticketType) return getServilexConfig().sucursal
    return (
        asString(item.ticketType.event.servilexSucursalCode) ||
        asString(item.ticketType.servilexSucursalCode) ||
        getServilexConfig().sucursal
    )
}

function getServilexItemEventCategory(item: ServilexSourceOrderItem): ServilexEventCategory | null {
    if (!item.ticketType) return null
    return normalizeEventCategory(item.ticketType.event.category)
}

function normalizeSerieSucursal(sucursal: string, fallback: string): string {
    const digits = extractDigits(asString(sucursal) || asString(fallback) || "01")
    if (!digits) return "01"
    return digits.slice(-2).padStart(2, "0")
}

function buildSucursalSerie(prefix: "BA" | "FA" | "BW" | "FW", sucursal: string, config: ServilexConfig): string {
    return `${prefix}${normalizeSerieSucursal(sucursal, config.sucursal)}`
}

function inferSnapshotEventCategory(
    snapshot: ServilexInvoiceSnapshot,
    order: ServilexSourceOrder
): ServilexEventCategory | null {
    if (snapshot.eventCategory) return snapshot.eventCategory

    const matchingItem = order.orderItems.find((item) => {
        if (!item.ticketType) return false
        if (!item.ticketType.servilexEnabled) return false
        if (normalizeIndicator(item.ticketType.servilexIndicator) !== snapshot.indicator) return false
        return getServilexItemSucursal(item) === snapshot.sucursal
    })

    return matchingItem ? getServilexItemEventCategory(matchingItem) : null
}

function isMerchOrder(order: ServilexSourceOrder): boolean {
    return order.orderItems.some((item) => item.merchVariant != null)
}

function resolveServilexSerie(input: {
    buyerIsFactura: boolean
    snapshot: ServilexInvoiceSnapshot
    order: ServilexSourceOrder
    config: ServilexConfig
}): string {
    const { buyerIsFactura, snapshot, order, config } = input
    const eventCategory = inferSnapshotEventCategory(snapshot, order)

    if (
        snapshot.indicator === "AC" ||
        snapshot.indicator === "PN" ||
        snapshot.indicator === "PA" ||
        eventCategory === "ACADEMIA" ||
        eventCategory === "PISCINA_LIBRE"
    ) {
        return buildSucursalSerie(buyerIsFactura ? "FW" : "BW", snapshot.sucursal, config)
    }

    if (eventCategory === "EVENTO" || isMerchOrder(order)) {
        return buildSucursalSerie(buyerIsFactura ? "FA" : "BA", snapshot.sucursal, config)
    }

    return buyerIsFactura ? config.serieFactura : config.serieBoleta
}

function buildAcademiaUnit(
    item: ServilexSourceOrderItem,
    attendee: ServilexAttendeeRecord,
    order: ServilexSourceOrder,
    unitPrice: number,
    sourceItemKey: string,
    sourceUnitIndex: number
): ServilexAcademiaUnit {
    if (!item.ticketType) {
        throw new Error("buildAcademiaUnit: item.ticketType es null")
    }
    const ticketType = item.ticketType
    const servicio = normalizeCode(ticketType.servilexServiceCode, "servicio")
    const disciplina = normalizeCode(ticketType.servilexDisciplineCode, "disciplina")
    const horario = normalizeCode(ticketType.servilexScheduleCode, "horario")
    const piscina = normalizeCode(ticketType.servilexPoolCode, "piscina")
    const sucursal = getServilexItemSucursal(item)
    const selectedDate = attendee.scheduleSelections[0]?.date
    const serviceDate = selectedDate
        ? new Date(`${selectedDate}T12:00:00Z`)
        : ticketType.event.startDate

    return {
        indicator: "AC",
        sucursal,
        eventCategory: getServilexItemEventCategory(item),
        baseAmount: unitPrice,
        sourceItemKey,
        sourceUnitIndex,
        attendee,
        alumno: buildAttendeeAlumnoSnapshot(attendee, order),
        detalle: {
            matricula: attendee.matricula,
            servicio,
            disciplina,
            horario,
            piscina,
            periodo: String(serviceDate.getUTCFullYear()),
            mes: String(serviceDate.getUTCMonth() + 1).padStart(2, "0"),
        },
    }
}

function buildOtrosServiciosUnit(
    item: ServilexSourceOrderItem,
    unitPrice: number,
    sourceItemKey: string,
    sourceUnitIndex: number
): ServilexOtrosServiciosUnit {
    if (!item.ticketType) {
        throw new Error("buildOtrosServiciosUnit: item.ticketType es null")
    }
    const ticketType = item.ticketType
    const extraConfig = getJsonObject(ticketType.servilexExtraConfig)

    return {
        indicator: "OS",
        sucursal: getServilexItemSucursal(item),
        eventCategory: getServilexItemEventCategory(item),
        baseAmount: unitPrice,
        sourceItemKey,
        sourceUnitIndex,
        detalle: {
            servicio: normalizeCode(ticketType.servilexServiceCode, "servicio"),
            cantidad: asPositiveNumber(extraConfig.cantidad) || 1,
            descuento: roundCurrency(asNonNegativeNumber(extraConfig.descuento) || 0),
        },
    }
}

function buildPiscinaLibreUnit(
    item: ServilexSourceOrderItem,
    indicator: "PN" | "PA",
    unitPrice: number,
    sourceItemKey: string,
    sourceUnitIndex: number
): ServilexPiscinaLibreUnit {
    if (!item.ticketType) {
        throw new Error("buildPiscinaLibreUnit: item.ticketType es null")
    }
    const ticketType = item.ticketType
    const extraConfig = getJsonObject(ticketType.servilexExtraConfig)

    return {
        indicator,
        sucursal: getServilexItemSucursal(item),
        eventCategory: getServilexItemEventCategory(item),
        baseAmount: unitPrice,
        sourceItemKey,
        sourceUnitIndex,
        detalle: {
            servicio: normalizeCode(ticketType.servilexServiceCode, "servicio"),
            cantidad: asPositiveNumber(extraConfig.cantidad) || 1,
            horaInicio: normalizeHora(extraConfig.horaInicio, "horaInicio"),
            horaFin: normalizeHora(extraConfig.horaFin, "horaFin"),
            duracion: asPositiveNumber(extraConfig.duracion) || 1,
            piscina: normalizeCode(ticketType.servilexPoolCode, "piscina"),
        },
    }
}

function buildMerchOtrosServiciosUnit(
    item: ServilexSourceOrderItem,
    unitPrice: number,
    sourceItemKey: string,
    sourceUnitIndex: number,
    config: ServilexConfig
): ServilexOtrosServiciosUnit {
    if (!item.merchVariant) {
        throw new Error("buildMerchOtrosServiciosUnit: item.merchVariant es null")
    }
    const product = item.merchVariant.product
    const code = asString(product.servilexServiceCode)
    if (!code) {
        throw new Error(
            `Merch ${product.name}: falta servilexServiceCode (codigo del catalogo ABIO)`
        )
    }
    const sucursal = asString(product.servilexSucursalCode) || config.sucursal

    return {
        indicator: "OS",
        sucursal,
        eventCategory: null,
        baseAmount: unitPrice,
        sourceItemKey,
        sourceUnitIndex,
        detalle: {
            servicio: code,
            cantidad: 1,
            descuento: 0,
        },
    }
}

interface ServilexInvoiceUnitsResult {
    units: ServilexInvoiceUnit[]
    apportionmentTotal: number
}

function buildInvoiceUnits(order: ServilexSourceOrder): ServilexInvoiceUnitsResult {
    const ticketServilexItems = order.orderItems
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter((
            entry
        ): entry is {
            item: ServilexSourceOrderItem & { ticketType: ServilexSourceTicketType }
            itemIndex: number
        } => entry.item.ticketType !== null && entry.item.ticketType.servilexEnabled)
        .sort((a, b) => {
            const aId = asString(a.item.id)
            const bId = asString(b.item.id)
            if (aId && bId) return aId.localeCompare(bId)
            return a.itemIndex - b.itemIndex
        })

    const merchServilexItems = order.orderItems
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter((
            entry
        ): entry is {
            item: ServilexSourceOrderItem & { merchVariant: ServilexSourceMerchVariant }
            itemIndex: number
        } =>
            entry.item.merchVariant != null &&
            asString(entry.item.merchVariant.product.servilexServiceCode) != null
        )
        .sort((a, b) => {
            const aId = asString(a.item.id)
            const bId = asString(b.item.id)
            if (aId && bId) return aId.localeCompare(bId)
            return a.itemIndex - b.itemIndex
        })

    if (ticketServilexItems.length === 0 && merchServilexItems.length === 0) {
        return { units: [], apportionmentTotal: 0 }
    }

    if (ticketServilexItems.length > 0 && merchServilexItems.length > 0) {
        throw new Error("La orden Servilex mezcla tickets y merch")
    }

    if (ticketServilexItems.length > 0) {
        const ticketOnlyItems = order.orderItems.filter((item) => item.ticketType !== null)
        if (ticketServilexItems.length !== ticketOnlyItems.length) {
            throw new Error("La orden mezcla items con y sin Servilex")
        }

        const units: ServilexInvoiceUnit[] = []

        for (const { item, itemIndex } of ticketServilexItems) {
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
                throw new Error(`Cantidad Servilex inválida en ${item.ticketType.name}`)
            }

            const indicator = normalizeIndicator(item.ticketType.servilexIndicator)
            const attendeeData = Array.isArray(item.attendeeData)
                ? (item.attendeeData as unknown[])
                : []
            const unitPrice = roundCurrency(toAmountNumber(item.unitPrice))
            const sourceItemKey = buildSourceItemKey(item, itemIndex)

            for (let index = 0; index < item.quantity; index++) {
                if (indicator === "AC") {
                    const attendee = getAcAttendeeData(attendeeData[index])
                    units.push(buildAcademiaUnit(item, attendee, order, unitPrice, sourceItemKey, index))
                    continue
                }

                if (indicator === "OS") {
                    units.push(buildOtrosServiciosUnit(item, unitPrice, sourceItemKey, index))
                    continue
                }

                units.push(buildPiscinaLibreUnit(item, indicator, unitPrice, sourceItemKey, index))
            }
        }

        return {
            units,
            apportionmentTotal: roundCurrency(toAmountNumber(order.totalAmount)),
        }
    }

    // Merch path: solo items merch con servilexService vinculado se facturan; el envío se omite
    const merchOnlyItems = order.orderItems.filter((item) => item.merchVariant != null)
    if (merchServilexItems.length !== merchOnlyItems.length) {
        throw new Error("La orden merch mezcla productos con y sin Servilex")
    }

    const config = getServilexConfig()
    const units: ServilexInvoiceUnit[] = []
    let merchSubtotal = 0

    for (const { item, itemIndex } of merchServilexItems) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new Error(
                `Cantidad Servilex inválida en ${item.merchVariant.product.name}`
            )
        }

        const unitPrice = roundCurrency(toAmountNumber(item.unitPrice))
        const sourceItemKey = buildSourceItemKey(item, itemIndex)
        merchSubtotal += unitPrice * item.quantity

        for (let index = 0; index < item.quantity; index++) {
            units.push(
                buildMerchOtrosServiciosUnit(item, unitPrice, sourceItemKey, index, config)
            )
        }
    }

    return {
        units,
        apportionmentTotal: roundCurrency(merchSubtotal),
    }
}

function buildAcademiaGroupKey(unit: ServilexAcademiaUnit): string {
    return `${unit.indicator}:${unit.sucursal}:matricula:${unit.attendee.matricula}`
}

function buildIndicatorGroupKey(unit: ServilexOtrosServiciosUnit | ServilexPiscinaLibreUnit): string {
    return `${unit.indicator}:${unit.sucursal}`
}

function buildLegacyGroupKey(unit: ServilexInvoiceUnit): string {
    return unit.indicator === "AC"
        ? buildAcademiaGroupKey(unit)
        : buildIndicatorGroupKey(unit)
}

function buildUnitGroupKey(unit: ServilexInvoiceUnit, legacyGroupKey: string, shouldSplit: boolean): string {
    if (!shouldSplit) return legacyGroupKey

    return `${legacyGroupKey}:item:${unit.sourceItemKey}:${unit.sourceUnitIndex + 1}`
}

function buildUnitGroupLabel(unit: ServilexInvoiceUnit): string {
    if (unit.indicator === "AC") {
        return unit.attendee.name
    }

    return `${unit.indicator}-${unit.sucursal}`
}

function buildUnitSnapshot(
    unit: ServilexInvoiceUnit,
    groupKey: string,
    legacyGroupKey: string,
    assignedTotal: number
): ServilexInvoiceSnapshot {
    if (unit.indicator === "AC") {
        const detalle = [{
            ...unit.detalle,
            precio: assignedTotal,
        }]

        return {
            indicator: unit.indicator,
            sucursal: unit.sucursal,
            eventCategory: unit.eventCategory,
            groupType: "ALUMNO",
            groupKey,
            legacyGroupKey,
            groupLabel: buildUnitGroupLabel(unit),
            assignedTotal,
            alumno: unit.alumno,
            detalle,
        }
    }

    if (unit.indicator === "OS") {
        const detalle = [{
            ...unit.detalle,
            cantidad: 1,
            precio: assignedTotal,
        }]

        return {
            indicator: unit.indicator,
            sucursal: unit.sucursal,
            eventCategory: unit.eventCategory,
            groupType: "INDICATOR",
            groupKey,
            legacyGroupKey,
            groupLabel: buildUnitGroupLabel(unit),
            assignedTotal,
            alumno: null,
            detalle,
        }
    }

    const detalle = [{
        ...unit.detalle,
        precio: assignedTotal,
    }]

    return {
        indicator: unit.indicator,
        sucursal: unit.sucursal,
        eventCategory: unit.eventCategory,
        groupType: "INDICATOR",
        groupKey,
        legacyGroupKey,
        groupLabel: buildUnitGroupLabel(unit),
        assignedTotal,
        alumno: null,
        detalle,
    }
}

export function buildServilexInvoiceSnapshots(order: ServilexSourceOrder): ServilexInvoiceSnapshot[] {
    const { units, apportionmentTotal } = buildInvoiceUnits(order)
    if (units.length === 0) return []

    const legacyGroupKeys = units.map((unit) => buildLegacyGroupKey(unit))
    const legacyGroupCounts = new Map<string, number>()
    for (const key of legacyGroupKeys) {
        legacyGroupCounts.set(key, (legacyGroupCounts.get(key) || 0) + 1)
    }

    const lineAmounts = allocateLineAmounts(
        units.map((unit) => unit.baseAmount),
        roundCurrency(apportionmentTotal)
    )

    return units.map((unit, index) => {
        const legacyGroupKey = legacyGroupKeys[index]
        const groupKey = buildUnitGroupKey(
            unit,
            legacyGroupKey,
            (legacyGroupCounts.get(legacyGroupKey) || 0) > 1
        )

        return buildUnitSnapshot(
            unit,
            groupKey,
            legacyGroupKey,
            roundCurrency(lineAmounts[index] ?? 0)
        )
    })
}

function parseSnapshotAlumno(raw: unknown): ServilexSnapshotAlumno | null {
    const alumno = asRecord(raw)
    if (!alumno) return null

    return {
        tipoDocumento: asString(alumno.tipoDocumento) || "1",
        numeroDocumento: asString(alumno.numeroDocumento) || "",
        apellidoPaterno: asString(alumno.apellidoPaterno) || "",
        apellidoMaterno: asString(alumno.apellidoMaterno) || "",
        primerNombre: asString(alumno.primerNombre) || "",
        segundoNombre: asString(alumno.segundoNombre) || "",
        direccion: asString(alumno.direccion) || "",
        ubigeo: asString(alumno.ubigeo) || "",
        email: asString(alumno.email) || "",
        celular: asString(alumno.celular) || "",
        codigoReferencia: asString(alumno.codigoReferencia) || "",
    }
}

function parseAcademiaDetalle(raw: unknown): ServilexDetalleAcademiaItem[] {
    if (!Array.isArray(raw)) {
        throw new Error("Snapshot Servilex AC inválido")
    }

    return raw.map((entry) => {
        const record = asRecord(entry)
        if (!record) {
            throw new Error("Detalle Servilex AC inválido")
        }

        return {
            matricula: normalizeCode(record.matricula, "matricula"),
            servicio: normalizeCode(record.servicio, "servicio"),
            disciplina: normalizeCode(record.disciplina, "disciplina"),
            horario: normalizeCode(record.horario, "horario"),
            piscina: normalizeCode(record.piscina, "piscina"),
            periodo: normalizeCode(record.periodo, "periodo"),
            mes: normalizeCode(record.mes, "mes"),
            precio: roundCurrency(toAmountNumber(record.precio)),
        }
    })
}

function parseOtrosServiciosDetalle(raw: unknown): ServilexDetalleOtrosServiciosItem[] {
    if (!Array.isArray(raw)) {
        throw new Error("Snapshot Servilex OS inválido")
    }

    return raw.map((entry) => {
        const record = asRecord(entry)
        if (!record) {
            throw new Error("Detalle Servilex OS inválido")
        }

        return {
            servicio: normalizeCode(record.servicio, "servicio"),
            cantidad: asPositiveNumber(record.cantidad) || 1,
            descuento: roundCurrency(asNonNegativeNumber(record.descuento) || 0),
            precio: roundCurrency(toAmountNumber(record.precio)),
        }
    })
}

function parsePiscinaDetalle(raw: unknown): ServilexDetallePiscinaItem[] {
    if (!Array.isArray(raw)) {
        throw new Error("Snapshot Servilex PN/PA inválido")
    }

    return raw.map((entry) => {
        const record = asRecord(entry)
        if (!record) {
            throw new Error("Detalle Servilex PN/PA inválido")
        }

        return {
            servicio: normalizeCode(record.servicio, "servicio"),
            cantidad: asPositiveNumber(record.cantidad) || 1,
            horaInicio: normalizeHora(record.horaInicio, "horaInicio"),
            horaFin: normalizeHora(record.horaFin, "horaFin"),
            duracion: asPositiveNumber(record.duracion) || 1,
            piscina: normalizeCode(record.piscina, "piscina"),
            precio: roundCurrency(toAmountNumber(record.precio)),
        }
    })
}

function parseInvoiceSnapshot(
    source: Pick<
        ServilexPayloadSource,
        | "servilexIndicator"
        | "servilexGroupKey"
        | "servilexGroupLabel"
        | "servilexAssignedTotal"
        | "servilexSucursalCode"
        | "alumnoSnapshot"
        | "servilexPayloadSnapshot"
    >
): ServilexInvoiceSnapshot {
    const snapshotRecord = asRecord(source.servilexPayloadSnapshot)

    if (snapshotRecord) {
        const indicator = normalizeIndicator(snapshotRecord.indicator || source.servilexIndicator)
        const detalleRaw = snapshotRecord.detalle
        const detalle =
            indicator === "AC"
                ? parseAcademiaDetalle(detalleRaw)
                : indicator === "OS"
                  ? parseOtrosServiciosDetalle(detalleRaw)
                  : parsePiscinaDetalle(detalleRaw)
        const assignedTotal = roundCurrency(
            detalle.reduce((sum, item) => sum + toAmountNumber(item.precio), 0)
        )

        return {
            indicator,
            sucursal:
                asString(snapshotRecord.sucursal) ||
                asString(source.servilexSucursalCode) ||
                getServilexConfig().sucursal,
            eventCategory: normalizeEventCategory(snapshotRecord.eventCategory),
            groupType:
                asString(snapshotRecord.groupType) === "ALUMNO" ? "ALUMNO" : "INDICATOR",
            groupKey: asString(snapshotRecord.groupKey) || source.servilexGroupKey,
            legacyGroupKey:
                asString(snapshotRecord.legacyGroupKey) ||
                asString(snapshotRecord.groupKey) ||
                source.servilexGroupKey,
            groupLabel:
                asString(snapshotRecord.groupLabel) ||
                asString(source.servilexGroupLabel) ||
                source.servilexGroupKey,
            assignedTotal,
            alumno: indicator === "AC"
                ? parseSnapshotAlumno(snapshotRecord.alumno || source.alumnoSnapshot)
                : null,
            detalle,
        }
    }

    return {
        indicator: normalizeIndicator(source.servilexIndicator),
        sucursal: asString(source.servilexSucursalCode) || getServilexConfig().sucursal,
        eventCategory: null,
        groupType: "INDICATOR",
        groupKey: source.servilexGroupKey,
        legacyGroupKey: source.servilexGroupKey,
        groupLabel: asString(source.servilexGroupLabel) || source.servilexGroupKey,
        assignedTotal: roundCurrency(toAmountNumber(source.servilexAssignedTotal)),
        alumno: parseSnapshotAlumno(source.alumnoSnapshot),
        detalle: [],
    }
}

export function buildServilexPreviewSources(
    order: ServilexSourceOrder,
    seedPrefix: string
): ServilexPayloadSource[] {
    return buildServilexInvoiceSnapshots(order).map((snapshot, index) => ({
        id: `${seedPrefix}-${index + 1}`,
        orderId: order.id || `${seedPrefix}-${index + 1}`,
        traceId: null,
        invoiceNumber: null,
        servilexIndicator: snapshot.indicator,
        servilexGroupKey: snapshot.groupKey,
        servilexGroupLabel: snapshot.groupLabel,
        servilexAssignedTotal: snapshot.assignedTotal,
        servilexSucursalCode: snapshot.sucursal,
        alumnoSnapshot: snapshot.alumno,
        servilexPayloadSnapshot: snapshot,
        order,
    }))
}

export function buildStableTraceId(source: { traceId: string | null; id: string }): string {
    return source.traceId || `req-${source.id}`
}

export function getServilexMissingConfig(config: ServilexConfig): string[] {
    const missing: string[] = []

    if (!config.token.trim()) missing.push("SERVILEX_TOKEN")

    return missing
}

export function buildServilexPayload(
    source: ServilexPayloadSource,
    config: ServilexConfig = getServilexConfig()
): ServilexPayload {
    const order = source.order
    const buyerIsFactura = order.documentType === "FACTURA"
    const buyerNames = getBuyerNames(order)
    const payment = getPaymentMetadata(order, config)
    const snapshot = parseInvoiceSnapshot(source)
    const total = roundCurrency(
        snapshot.detalle.reduce((sum, item) => sum + roundCurrency(toAmountNumber(item.precio)), 0)
    )
    const issueDate = toDateOnly(order.paidAt || order.createdAt)

    if (snapshot.detalle.length === 0) {
        throw new Error(`Invoice Servilex ${source.servilexGroupKey} no tiene detalle`)
    }

    if (snapshot.detalle.length > 1) {
        throw new Error(
            `Invoice Servilex ${source.servilexGroupKey} tiene ${snapshot.detalle.length} detalles; ABIO requiere un comprobante por item`
        )
    }

    const alumnoPayload =
        snapshot.indicator === "AC" && snapshot.alumno
            ? {
                ...snapshot.alumno,
                codigoReferencia: normalizeReferenceCode(
                    snapshot.alumno.codigoReferencia,
                    `${snapshot.groupKey}:${snapshot.alumno.numeroDocumento}`
                ),
            }
            : undefined

    const cabecera: ServilexCabecera = {
        codigoEmp: config.codigoEmp,
        sucursal: snapshot.sucursal,
        indicador: snapshot.indicator,
        comprobante: {
            tipo: buyerIsFactura ? "FAC" : "BOL",
            serie: resolveServilexSerie({ buyerIsFactura, snapshot, order, config }),
        },
        entidad: {
            tipoDocumento: order.buyerDocType || (buyerIsFactura ? "6" : "1"),
            numeroDocumento: order.buyerDocNumber || "",
            razonSocial: buyerNames.razonSocial,
            apellidoPaterno: buyerNames.apellidoPaterno,
            apellidoMaterno: buyerNames.apellidoMaterno,
            primerNombre: buyerNames.primerNombre,
            segundoNombre: buyerNames.segundoNombre,
            direccion: order.buyerAddress || "",
            ubigeo: order.buyerUbigeo || "",
            email: order.buyerEmail || order.user.email,
            celular: order.buyerPhone || "",
            codigoReferencia: normalizeReferenceCode(
                order.providerRef || order.id || source.orderId,
                source.orderId
            ),
        },
        ...(alumnoPayload ? { alumno: alumnoPayload } : {}),
        fechaEmision: issueDate,
        fechaVencimiento: issueDate,
        moneda: getCurrencyCode(order),
        total,
        ejecutivo: config.ejecutivo,
        condicionPago: config.condicionPago,
        tipoTributo: getServilexTipoTributo(snapshot.indicator, config),
        referencia: config.referencia,
        tipoRegistro: config.tipoRegistro,
    }

    return {
        meta: {
            version: DEFAULT_ABIO_VERSION,
            traceId: buildStableTraceId(source),
            timestamp: formatServilexTimestamp(new Date()),
            terminal: config.terminal,
        },
        cabecera,
        detalle: snapshot.detalle,
        cobranza: {
            nroOperacion: payment.nroOperacion,
            formaPago: payment.formaPago,
            tarjetaTipo: payment.tarjetaTipo,
            tarjetaProcedencia: payment.tarjetaProcedencia,
            totalPago: total,
        },
    }
}

export function stringifyServilexJson(value: unknown): string {
    const normalizedValue = normalizeServilexJsonValue(value)
    const json = JSON.stringify(normalizedValue, (key, currentValue) => {
        if (
            typeof currentValue === "number" &&
            Number.isFinite(currentValue) &&
            SERVILEX_DECIMAL_FIELDS.has(key)
        ) {
            return `${SERVILEX_DECIMAL_TOKEN_PREFIX}${formatServilexDecimal(currentValue)}`
        }

        return currentValue
    })

    return json.replace(
        new RegExp(`"${SERVILEX_DECIMAL_TOKEN_PREFIX}(-?\\d+\\.\\d{2})"`, "g"),
        "$1"
    )
}

export function formatServilexJsonForDisplay(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => formatServilexJsonForDisplay(item))
    }

    if (!value || typeof value !== "object") {
        return value
    }

    const record = value as Record<string, unknown>
    const formatted: Record<string, unknown> = {}

    for (const [key, currentValue] of Object.entries(record)) {
        if (
            typeof currentValue === "number" &&
            Number.isFinite(currentValue) &&
            SERVILEX_DECIMAL_FIELDS.has(key)
        ) {
            formatted[key] = formatServilexDecimal(currentValue)
            continue
        }

        formatted[key] = formatServilexJsonForDisplay(currentValue)
    }

    return formatted
}

export function buildServilexSignature(rawBody: string, token: string): string {
    return crypto.createHmac("sha256", token).update(rawBody).digest("hex")
}

export async function sendServilexInvoice(
    payload: ServilexPayload,
    config: ServilexConfig = getServilexConfig()
): Promise<ServilexRequestResult> {
    const rawPayload = stringifyServilexJson(payload)
    const rawPayloadBuffer = Buffer.from(rawPayload, "utf8")
    const signature = buildServilexSignature(rawPayloadBuffer.toString("utf8"), config.token)

    const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-ABIO-Token": config.token,
            "X-ABIO-Signature": signature,
            "X-ABIO-Empresa": config.empresa,
        },
        body: rawPayloadBuffer,
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
