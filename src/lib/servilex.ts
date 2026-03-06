import crypto from "crypto"

export interface ServilexConfig {
    enabled: boolean
    endpoint: string
    token: string
    empresa: string
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

export interface ServilexPayload {
    meta: ServilexMeta
    cabecera: Record<string, unknown>
    detalle: Array<Record<string, unknown>>
    cobranza: Record<string, unknown>
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

const DEFAULT_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/invoice"

export function getServilexConfig(): ServilexConfig {
    const maxRetriesRaw = Number(process.env.SERVILEX_MAX_RETRIES || "3")
    return {
        enabled: process.env.SERVILEX_ENABLED === "true",
        endpoint: process.env.SERVILEX_ENDPOINT || DEFAULT_ENDPOINT,
        token: process.env.SERVILEX_TOKEN || "",
        empresa: process.env.SERVILEX_EMPRESA || "FPDN",
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
