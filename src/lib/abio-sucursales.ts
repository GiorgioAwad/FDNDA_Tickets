export interface AbioEventSucursal {
    code: string
    name: string
}

// Registro de nombres conocidos. Si ABIO crea una sucursal con codigo nuevo,
// el sync la descubre automaticamente y aqui se le mapea un nombre amigable.
// Sin nombre mapeado, se muestra "Sucursal {codigo}".
const ABIO_SUCURSAL_NAME_REGISTRY: Record<string, string> = {
    "01": "Campo de Marte",
    "02": "Trujillo - Mansiche",
    "03": "Videna",
    "04": "VMT",
    "05": "HUANCHACO",
    "06": "VIDENITA - PIURA",
    "07": "TINGO MARIA",
    "08": "PISCINA OLIMPICA - PIURA",
    "09": "TARAPOTO",
}

export const ABIO_EVENT_SUCURSALES: readonly AbioEventSucursal[] = Object.entries(
    ABIO_SUCURSAL_NAME_REGISTRY
).map(([code, name]) => ({ code, name }))

export type AbioEventSucursalCode = string

export const DEFAULT_ABIO_EVENT_SUCURSAL_CODE: AbioEventSucursalCode = "01"

function normalizeSucursalCode(code: unknown): string | null {
    if (typeof code !== "string") return null
    const trimmed = code.trim()
    if (!trimmed) return null
    return /^\d+$/.test(trimmed) ? trimmed.padStart(2, "0") : trimmed.toUpperCase()
}

export function resolveAbioSucursalName(code: unknown): string {
    const normalized = normalizeSucursalCode(code)
    if (!normalized) return "Sucursal desconocida"
    return ABIO_SUCURSAL_NAME_REGISTRY[normalized] ?? `Sucursal ${normalized}`
}

export function getAbioEventSucursalByCode(code: unknown): AbioEventSucursal | null {
    const normalized = normalizeSucursalCode(code)
    if (!normalized) return null
    return {
        code: normalized,
        name: resolveAbioSucursalName(normalized),
    }
}

export function getDefaultAbioEventSucursal(): AbioEventSucursal {
    return {
        code: DEFAULT_ABIO_EVENT_SUCURSAL_CODE,
        name: resolveAbioSucursalName(DEFAULT_ABIO_EVENT_SUCURSAL_CODE),
    }
}
