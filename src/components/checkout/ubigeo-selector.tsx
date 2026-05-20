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
    "flex h-11 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200"

type Props = {
    /** Ubigeo de 6 dígitos actual (puede venir vacío o precargado). */
    value: string
    /** Se llama con el ubigeo de 6 dígitos cuando se elige un distrito (o "" si se limpia). */
    onChange: (ubigeo: string) => void
}

/**
 * Selector encadenado Departamento → Provincia → Distrito.
 * Al elegir el distrito, su `id` (6 dígitos) ES el ubigeo INEI requerido por SUNAT.
 */
export function UbigeoSelector({ value, onChange }: Props) {
    // Deriva la selección inicial desde un ubigeo ya cargado (ej. usuario logueado).
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
                <label className="text-xs text-gray-500 mb-1 block">Departamento</label>
                <select
                    className={selectClass}
                    value={departmentId}
                    onChange={(e) => {
                        setDepartmentId(e.target.value)
                        setProvinceId("")
                        onChange("")
                    }}
                >
                    <option value="">Selecciona...</option>
                    {DEPARTAMENTOS.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="text-xs text-gray-500 mb-1 block">Provincia</label>
                <select
                    className={cn(selectClass)}
                    value={provinceId}
                    disabled={!departmentId}
                    onChange={(e) => {
                        setProvinceId(e.target.value)
                        onChange("")
                    }}
                >
                    <option value="">Selecciona...</option>
                    {provincias.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="text-xs text-gray-500 mb-1 block">Distrito</label>
                <select
                    className={cn(selectClass)}
                    value={value}
                    disabled={!provinceId}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value="">Selecciona...</option>
                    {distritos.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.name}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    )
}
