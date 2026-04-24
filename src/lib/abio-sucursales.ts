export const ABIO_EVENT_SUCURSALES = [
    { code: "01", name: "Campo de Marte" },
    { code: "02", name: "Trujillo - Mansiche" },
    { code: "03", name: "Videna" },
    { code: "04", name: "VMT" },
    { code: "05", name: "HUANCHACO" },
    { code: "06", name: "VIDENITA - PIURA" },
    { code: "07", name: "TINGO MARIA" },
    { code: "08", name: "PISCINA OLIMPICA - PIURA" },
] as const

export type AbioEventSucursalCode = (typeof ABIO_EVENT_SUCURSALES)[number]["code"]

export const DEFAULT_ABIO_EVENT_SUCURSAL_CODE: AbioEventSucursalCode = "01"

export function getAbioEventSucursalByCode(code: unknown) {
    if (typeof code !== "string") return null
    const normalized = code.trim()
    return ABIO_EVENT_SUCURSALES.find((sucursal) => sucursal.code === normalized) || null
}

export function getDefaultAbioEventSucursal() {
    return ABIO_EVENT_SUCURSALES[0]
}
