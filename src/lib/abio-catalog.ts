const DEFAULT_ABIO_VERSION = "1.2"
const DEFAULT_SERVICES_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/servicio"
const DEFAULT_DISCIPLINES_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/disciplina"
const DEFAULT_SCHEDULES_ENDPOINT = "https://abio-pse.ue.r.appspot.com/fpdn/horario"

export interface AbioCatalogConfig {
    token: string
    empresa: string
    codigoEmp: string
    terminal: string
    servicesEndpoint: string
    disciplinesEndpoint: string
    schedulesEndpoint: string
    defaultSucursales: string[]
}

interface AbioCatalogMeta {
    version: string
    timestamp: string
    terminal: string
}

interface AbioCatalogRequest<TPayload> {
    meta: AbioCatalogMeta
    payload: TPayload
}

interface AbioCatalogResponseMeta {
    status?: "success" | "error"
    timestamp?: string
}

interface AbioCatalogErrorBody {
    codigo?: string
    mensaje?: string
}

interface AbioCatalogResponse<TRow> {
    meta?: AbioCatalogResponseMeta
    data?: TRow[]
    error?: AbioCatalogErrorBody
}

type AbioRawService = {
    ServicioCodigo?: string
    ServicioDescripcion?: string
}

type AbioRawDiscipline = {
    DisciplinaCodigo?: string
    DisciplinaNombre?: string
}

type AbioRawSchedule = {
    horario?: string
    dia?: string
    lunes?: string
    martes?: string
    miercoles?: string
    jueves?: string
    viernes?: string
    sabado?: string
    domingo?: string
}

export interface AbioCatalogServiceRow {
    servicioCodigo: string
    servicioDescripcion: string
    raw: AbioRawService
}

export interface AbioCatalogDisciplineRow {
    disciplinaCodigo: string
    disciplinaNombre: string
    raw: AbioRawDiscipline
}

export interface AbioCatalogScheduleRow {
    horarioCodigo: string
    diaDescripcion: string
    lunes: string
    martes: string
    miercoles: string
    jueves: string
    viernes: string
    sabado: string
    domingo: string
    horaInicio: string | null
    horaFin: string | null
    duracionHoras: number | null
    raw: AbioRawSchedule
}

export interface AbioCatalogRequestResult<TPayload, TRow> {
    ok: boolean
    status: number
    requestBody: AbioCatalogRequest<TPayload>
    rawResponse: unknown
    parsed?: AbioCatalogResponse<TRow>
    errorCode?: string
    errorMessage?: string
}

const normalizeString = (value: unknown): string => {
    if (typeof value !== "string") return ""
    return value.trim().replace(/\s+/g, " ")
}

const normalizeCode = (value: unknown): string => normalizeString(value).toUpperCase()

const nowIsoUtc = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")

const parseCsvCodes = (value: string | undefined, fallback: string): string[] => {
    const raw = typeof value === "string" ? value : fallback
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
}

export function getAbioCatalogConfig(): AbioCatalogConfig {
    return {
        token: process.env.SERVILEX_TOKEN || "",
        empresa: process.env.SERVILEX_EMPRESA || "FPDN",
        codigoEmp: process.env.SERVILEX_CODIGO_EMP || "001",
        terminal: process.env.SERVILEX_TERMINAL || "cajaweb",
        servicesEndpoint:
            process.env.ABIO_CATALOG_SERVICES_ENDPOINT || DEFAULT_SERVICES_ENDPOINT,
        disciplinesEndpoint:
            process.env.ABIO_CATALOG_DISCIPLINES_ENDPOINT || DEFAULT_DISCIPLINES_ENDPOINT,
        schedulesEndpoint:
            process.env.ABIO_CATALOG_SCHEDULES_ENDPOINT || DEFAULT_SCHEDULES_ENDPOINT,
        defaultSucursales: parseCsvCodes(
            process.env.ABIO_CATALOG_SUCURSALES,
            process.env.SERVILEX_SUCURSAL || "01"
        ),
    }
}

function buildRequestBody<TPayload>(payload: TPayload, terminal: string): AbioCatalogRequest<TPayload> {
    return {
        meta: {
            version: DEFAULT_ABIO_VERSION,
            timestamp: nowIsoUtc(),
            terminal: normalizeString(terminal) || "cajaweb",
        },
        payload,
    }
}

async function postCatalog<TPayload, TRow>(
    endpoint: string,
    payload: TPayload,
    config: AbioCatalogConfig
): Promise<AbioCatalogRequestResult<TPayload, TRow>> {
    const requestBody = buildRequestBody(payload, config.terminal)
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-ABIO-Token": config.token,
            "X-ABIO-Empresa": config.empresa,
        },
        body: JSON.stringify(requestBody),
        cache: "no-store",
    })

    const rawResponse = await response
        .json()
        .catch(async () => ({ raw: await response.text().catch(() => "") }))

    const parsed = rawResponse && typeof rawResponse === "object"
        ? (rawResponse as AbioCatalogResponse<TRow>)
        : undefined

    return {
        ok: response.ok && parsed?.meta?.status !== "error",
        status: response.status,
        requestBody,
        rawResponse,
        parsed,
        errorCode: parsed?.error?.codigo,
        errorMessage: parsed?.error?.mensaje,
    }
}

const parseDurationHours = (horaInicio: string | null, horaFin: string | null): number | null => {
    if (!horaInicio || !horaFin) return null
    const startMatch = horaInicio.match(/^(\d{2}):(\d{2})$/)
    const endMatch = horaFin.match(/^(\d{2}):(\d{2})$/)
    if (!startMatch || !endMatch) return null

    const startMinutes = Number(startMatch[1]) * 60 + Number(startMatch[2])
    const endMinutes = Number(endMatch[1]) * 60 + Number(endMatch[2])
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
        return null
    }

    return Number(((endMinutes - startMinutes) / 60).toFixed(2))
}

export function parseScheduleTimeWindow(diaDescripcion: string): {
    horaInicio: string | null
    horaFin: string | null
    duracionHoras: number | null
} {
    const normalized = normalizeString(diaDescripcion)
    const match = normalized.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/)
    const horaInicio = match?.[1] || null
    const horaFin = match?.[2] || null
    return {
        horaInicio,
        horaFin,
        duracionHoras: parseDurationHours(horaInicio, horaFin),
    }
}

function normalizeServiceRows(rows: AbioRawService[] | undefined): AbioCatalogServiceRow[] {
    return (rows || [])
        .map((row) => ({
            servicioCodigo: normalizeCode(row.ServicioCodigo),
            servicioDescripcion: normalizeString(row.ServicioDescripcion),
            raw: row,
        }))
        .filter((row) => row.servicioCodigo && row.servicioDescripcion)
}

function normalizeDisciplineRows(rows: AbioRawDiscipline[] | undefined): AbioCatalogDisciplineRow[] {
    return (rows || [])
        .map((row) => ({
            disciplinaCodigo: normalizeCode(row.DisciplinaCodigo),
            disciplinaNombre: normalizeString(row.DisciplinaNombre),
            raw: row,
        }))
        .filter((row) => row.disciplinaCodigo && row.disciplinaNombre)
}

function normalizeScheduleRows(rows: AbioRawSchedule[] | undefined): AbioCatalogScheduleRow[] {
    return (rows || [])
        .map((row) => {
            const diaDescripcion = normalizeString(row.dia)
            const timeWindow = parseScheduleTimeWindow(diaDescripcion)
            return {
                horarioCodigo: normalizeCode(row.horario),
                diaDescripcion,
                lunes: normalizeCode(row.lunes),
                martes: normalizeCode(row.martes),
                miercoles: normalizeCode(row.miercoles),
                jueves: normalizeCode(row.jueves),
                viernes: normalizeCode(row.viernes),
                sabado: normalizeCode(row.sabado),
                domingo: normalizeCode(row.domingo),
                horaInicio: timeWindow.horaInicio,
                horaFin: timeWindow.horaFin,
                duracionHoras: timeWindow.duracionHoras,
                raw: row,
            }
        })
        .filter((row) => row.horarioCodigo)
}

export async function fetchAbioServices(input: {
    config?: AbioCatalogConfig
    codigoEmp?: string
    sucursal: string
}) {
    const config = input.config || getAbioCatalogConfig()
    const result = await postCatalog<{ codigoEmp: string; sucursal: string }, AbioRawService>(
        config.servicesEndpoint,
        {
            codigoEmp: normalizeCode(input.codigoEmp || config.codigoEmp),
            sucursal: normalizeCode(input.sucursal),
        },
        config
    )

    return {
        ...result,
        rows: normalizeServiceRows(result.parsed?.data),
    }
}

export async function fetchAbioDisciplines(input?: {
    config?: AbioCatalogConfig
    codigoEmp?: string
}) {
    const config = input?.config || getAbioCatalogConfig()
    const result = await postCatalog<{ codigoEmp: string }, AbioRawDiscipline>(
        config.disciplinesEndpoint,
        {
            codigoEmp: normalizeCode(input?.codigoEmp || config.codigoEmp),
        },
        config
    )

    return {
        ...result,
        rows: normalizeDisciplineRows(result.parsed?.data),
    }
}

export async function fetchAbioSchedules(input: {
    config?: AbioCatalogConfig
    codigoEmp?: string
    disciplina: string
}) {
    const config = input.config || getAbioCatalogConfig()
    const result = await postCatalog<{ codigoEmp: string; disciplina: string }, AbioRawSchedule>(
        config.schedulesEndpoint,
        {
            codigoEmp: normalizeCode(input.codigoEmp || config.codigoEmp),
            disciplina: normalizeCode(input.disciplina),
        },
        config
    )

    return {
        ...result,
        rows: normalizeScheduleRows(result.parsed?.data),
    }
}
