"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Input } from "@/components/ui/input"

interface ServilexServiceOption {
    id: string
    codigo: string
    indicador: string
    disciplina: string
    sede: string
    clases: number | null
    descripcion: string
}

interface ServilexServiceComboboxProps {
    value: string | null // servilexServiceId
    onChange: (service: ServilexServiceOption | null) => void
    legacyIndicator?: string | null
    legacyServiceCode?: string | null
}

const SEDE_ORDER: Record<string, number> = { LIMA: 0, VMT: 1, TRUJILLO: 2, HUANCHACO: 3 }

export default function ServilexServiceCombobox({
    value,
    onChange,
    legacyIndicator,
    legacyServiceCode,
}: ServilexServiceComboboxProps) {
    const [services, setServices] = useState<ServilexServiceOption[]>([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState("")
    const [isOpen, setIsOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        fetch("/api/admin/servilex-services")
            .then((res) => res.json())
            .then((data) => {
                setServices(data.data || [])
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const selected = useMemo(
        () => services.find((s) => s.id === value) || null,
        [services, value]
    )

    const filtered = useMemo(() => {
        if (query.length < 2) return []
        const q = query.toLowerCase()
        return services.filter(
            (s) =>
                s.descripcion.toLowerCase().includes(q) ||
                s.codigo.toLowerCase().includes(q) ||
                s.disciplina.toLowerCase().includes(q) ||
                s.sede.toLowerCase().includes(q)
        )
    }, [services, query])

    // Group by discipline + sede
    const grouped = useMemo(() => {
        const groups: Record<string, ServilexServiceOption[]> = {}
        const items = filtered.length > 0 ? filtered : (query.length < 2 ? services : [])
        for (const s of items) {
            const key = `${s.disciplina} - ${s.sede}`
            if (!groups[key]) groups[key] = []
            groups[key].push(s)
        }
        return Object.entries(groups).sort((a, b) => {
            const [dA, sA] = a[0].split(" - ")
            const [dB, sB] = b[0].split(" - ")
            if (dA !== dB) return dA.localeCompare(dB)
            return (SEDE_ORDER[sA] ?? 99) - (SEDE_ORDER[sB] ?? 99)
        })
    }, [filtered, services, query])

    const displayValue = selected
        ? `[${selected.codigo}] ${selected.descripcion}`
        : ""

    const showLegacyWarning =
        !value && legacyIndicator && legacyServiceCode

    return (
        <div ref={wrapperRef} className="relative space-y-1">
            <label className="text-xs font-medium">
                Servicio Servilex
            </label>
            {showLegacyWarning && (
                <p className="text-xs text-amber-600">
                    Servicio actual: {legacyIndicator}-{legacyServiceCode} (sin vincular al catalogo)
                </p>
            )}
            <Input
                value={isOpen ? query : displayValue}
                onChange={(e) => {
                    setQuery(e.target.value)
                    setIsOpen(true)
                }}
                onFocus={() => {
                    setIsOpen(true)
                    if (selected) setQuery("")
                }}
                placeholder={loading ? "Cargando catalogo..." : "Buscar servicio (min 2 caracteres)..."}
                disabled={loading}
            />
            {isOpen && (query.length >= 2 || !selected) && grouped.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border bg-white shadow-lg">
                    {grouped.map(([group, items]) => (
                        <div key={group}>
                            <div className="sticky top-0 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                                {group.replace(/_/g, " ")}
                            </div>
                            {items.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${
                                        s.id === value ? "bg-blue-100 font-medium" : ""
                                    }`}
                                    onClick={() => {
                                        onChange(s)
                                        setQuery("")
                                        setIsOpen(false)
                                    }}
                                >
                                    <span className="font-mono text-xs text-gray-500">[{s.codigo}]</span>{" "}
                                    {s.descripcion}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            {selected && (
                <button
                    type="button"
                    className="text-xs text-red-500 hover:underline"
                    onClick={() => {
                        onChange(null)
                        setQuery("")
                    }}
                >
                    Quitar seleccion
                </button>
            )}
        </div>
    )
}
