import { getUbigeoNames } from "@/lib/ubigeo-peru"

export type RegistrationLocation = {
    ubigeo: string
    departamento: string
    provincia: string
    distrito: string
}

export function parseRegistrationLocation(value: unknown): RegistrationLocation | null {
    const ubigeo = typeof value === "string" ? value.trim() : ""
    if (!/^\d{6}$/.test(ubigeo)) return null

    const names = getUbigeoNames(ubigeo)
    if (!names?.departamento || !names.provincia || !names.distrito) return null

    return { ubigeo, ...names }
}
