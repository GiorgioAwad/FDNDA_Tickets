export interface ParsedAbioBindingRow {
    codigoEmp: string
    sucursalCodigo: string
    servicioCodigo: string
    disciplinaCodigo: string
    piscinaCodigo: string
    horarioCodigo: string
    numeroCupos: number
    raw: Record<string, unknown>
}

const HEADER_ALIASES: Record<string, string[]> = {
    sucursalCodigo: ["sucursal", "branch", "sede"],
    servicioCodigo: ["servicio", "service", "codigo servicio", "codigo_servicio"],
    disciplinaCodigo: ["disciplina", "codigo disciplina", "codigo_disciplina"],
    piscinaCodigo: ["piscina", "codigo piscina", "codigo_piscina", "pool"],
    horarioCodigo: ["horario", "schedule", "codigo horario", "codigo_horario"],
    numeroCupos: [
        "numero_cupos",
        "numero cupos",
        "numero de cupos",
        "cupos",
        "numeroCupos",
    ],
}

const normalizeHeader = (value: string): string =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[_\-]+/g, " ")
        .replace(/\s+/g, " ")

const normalizeString = (value: unknown): string => {
    if (value === undefined || value === null) return ""
    return String(value).trim()
}

const normalizeNumericCode = (value: unknown, length: number): string => {
    const raw = normalizeString(value)
    if (!raw) return ""
    return /^\d+$/.test(raw) ? raw.padStart(length, "0") : raw.toUpperCase()
}

const normalizeServiceCode = (value: unknown): string => {
    const raw = normalizeString(value)
    if (!raw) return ""
    return /^\d+$/.test(raw) ? raw.padStart(3, "0") : raw.toUpperCase()
}

const normalizeCapacity = (value: unknown): number => {
    const raw = normalizeString(value)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.floor(parsed)
}

const getRowValue = (row: Record<string, unknown>, aliases: string[]): unknown => {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value] as const)
    for (const alias of aliases) {
        const match = normalizedEntries.find(([key]) => key === normalizeHeader(alias))
        if (match) return match[1]
    }
    return undefined
}

export function parseAbioBindingRows(input: {
    rows: Array<Record<string, unknown>>
    codigoEmp: string
}): ParsedAbioBindingRow[] {
    const parsedRows: ParsedAbioBindingRow[] = []

    for (const row of input.rows) {
        const sucursalCodigo = normalizeNumericCode(
            getRowValue(row, HEADER_ALIASES.sucursalCodigo),
            2
        )
        const servicioCodigo = normalizeServiceCode(
            getRowValue(row, HEADER_ALIASES.servicioCodigo)
        )
        const disciplinaCodigo = normalizeNumericCode(
            getRowValue(row, HEADER_ALIASES.disciplinaCodigo),
            2
        )
        const piscinaCodigo = normalizeNumericCode(
            getRowValue(row, HEADER_ALIASES.piscinaCodigo),
            2
        )
        const horarioCodigo = normalizeNumericCode(
            getRowValue(row, HEADER_ALIASES.horarioCodigo),
            6
        )
        const numeroCupos = normalizeCapacity(getRowValue(row, HEADER_ALIASES.numeroCupos))

        if (
            !sucursalCodigo ||
            !servicioCodigo ||
            !disciplinaCodigo ||
            !piscinaCodigo ||
            !horarioCodigo
        ) {
            continue
        }

        parsedRows.push({
            codigoEmp: input.codigoEmp,
            sucursalCodigo,
            servicioCodigo,
            disciplinaCodigo,
            piscinaCodigo,
            horarioCodigo,
            numeroCupos,
            raw: row,
        })
    }

    return parsedRows
}

export const buildAbioBindingCompositeKey = (row: {
    codigoEmp: string
    sucursalCodigo: string
    servicioCodigo: string
    disciplinaCodigo: string
    piscinaCodigo: string
    horarioCodigo: string
}) =>
    [
        row.codigoEmp,
        row.sucursalCodigo,
        row.servicioCodigo,
        row.disciplinaCodigo,
        row.piscinaCodigo,
        row.horarioCodigo,
    ].join("|")
