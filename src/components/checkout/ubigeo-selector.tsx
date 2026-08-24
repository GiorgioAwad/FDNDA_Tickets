"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
    DEPARTAMENTOS,
    getProvincias,
    getDistritos,
    resolveUbigeo,
} from "@/lib/ubigeo-peru"

const selectClass =
    "flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200"

type Props = {
    /** Ubigeo de 6 dígitos actual (puede venir vacío o precargado). */
    value: string
    /** Se llama con el ubigeo de 6 dígitos cuando se elige un distrito (o "" si se limpia). */
    onChange: (ubigeo: string) => void
    /** Prefijo único para asociar cada etiqueta con su selector. */
    idPrefix?: string
    /** Mantiene los tres niveles en una sola columna para formularios estrechos. */
    stacked?: boolean
    required?: boolean
}

/**
 * Selector encadenado Departamento → Provincia → Distrito.
 * Al elegir el distrito, su `id` (6 dígitos) ES el ubigeo INEI requerido por SUNAT.
 */
export function UbigeoSelector({
    value,
    onChange,
    idPrefix = "ubigeo",
    stacked = false,
    required = false,
}: Props) {
    const initial = useMemo(() => resolveUbigeo(value) ?? null, [value])
    const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "")
    const [provinceId, setProvinceId] = useState(initial?.provinceId ?? "")

    const provincias = useMemo(
        () => (departmentId ? getProvincias(departmentId) : []),
        [departmentId]
    )
    const distritos = useMemo(
        () => (provinceId ? getDistritos(provinceId) : []),
        [provinceId]
    )

    return (
        <div className={cn("grid grid-cols-1 gap-3", !stacked && "sm:grid-cols-3")}>
            <div>
                <label htmlFor={`${idPrefix}-department`} className="mb-1.5 block text-sm font-medium text-foreground">
                    Departamento
                </label>
                <select
                    id={`${idPrefix}-department`}
                    className={selectClass}
                    value={departmentId}
                    required={required}
                    onChange={(e) => {
                        setDepartmentId(e.target.value)
                        setProvinceId("")
                        onChange("")
                    }}
                >
                    <option value="">Selecciona...</option>
                    {DEPARTAMENTOS.map((department) => (
                        <option key={department.id} value={department.id}>
                            {department.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label htmlFor={`${idPrefix}-province`} className="mb-1.5 block text-sm font-medium text-foreground">
                    Provincia
                </label>
                <select
                    id={`${idPrefix}-province`}
                    className={selectClass}
                    value={provinceId}
                    disabled={!departmentId}
                    required={required}
                    onChange={(e) => {
                        setProvinceId(e.target.value)
                        onChange("")
                    }}
                >
                    <option value="">Selecciona...</option>
                    {provincias.map((province) => (
                        <option key={province.id} value={province.id}>
                            {province.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label htmlFor={`${idPrefix}-district`} className="mb-1.5 block text-sm font-medium text-foreground">
                    Distrito
                </label>
                <select
                    id={`${idPrefix}-district`}
                    className={selectClass}
                    value={value}
                    disabled={!provinceId}
                    required={required}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value="">Selecciona...</option>
                    {distritos.map((district) => (
                        <option key={district.id} value={district.id}>
                            {district.name}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    )
}
