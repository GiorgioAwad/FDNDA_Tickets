import { DEPARTAMENTOS, PROVINCIAS, getDistritos, getUbigeoNames } from "@/lib/ubigeo-peru"

export type RegistrationLocation = {
    ubigeo: string
    departamento: string
    provincia: string
    distrito: string
}

export type AccountLocation = {
    departamento?: string | null
    provincia?: string | null
    distrito?: string | null
}

const normalizeLocationName = (value: string | null | undefined) =>
    (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase()

/** Recupera el ubigeo a partir de los tres nombres guardados en el registro. */
export function resolveRegistrationLocation(account: AccountLocation | null | undefined): RegistrationLocation | null {
    if (!account?.departamento || !account.provincia || !account.distrito) return null
    const department = DEPARTAMENTOS.find((entry) =>
        normalizeLocationName(entry.name) === normalizeLocationName(account.departamento))
    if (!department) return null
    const province = PROVINCIAS.find((entry) => entry.departmentId === department.id &&
        normalizeLocationName(entry.name) === normalizeLocationName(account.provincia))
    if (!province) return null
    const district = getDistritos(province.id).find((entry) =>
        normalizeLocationName(entry.name) === normalizeLocationName(account.distrito))
    return district ? parseRegistrationLocation(district.id) : null
}

export function parseRegistrationLocation(value: unknown): RegistrationLocation | null {
    const ubigeo = typeof value === "string" ? value.trim() : ""
    if (!/^\d{6}$/.test(ubigeo)) return null

    const names = getUbigeoNames(ubigeo)
    if (!names?.departamento || !names.provincia || !names.distrito) return null

    return { ubigeo, ...names }
}
