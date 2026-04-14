"use client"

import { useEffect, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"

type CatalogStatus = {
    counts: {
        services: number
        disciplines: number
        schedules: number
        bindings: number
    }
    lastRuns: Array<{
        id: string
        resource: string
        status: string
        startedAt: string
        importedCount: number
        deactivatedCount: number
        errorMessage: string | null
    }>
}

interface AbioCatalogControlsProps {
    onCatalogChanged?: () => void
}

export function AbioCatalogControls({ onCatalogChanged }: AbioCatalogControlsProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [status, setStatus] = useState<CatalogStatus | null>(null)
    const [loading, setLoading] = useState(false)
    const [replaceBindings, setReplaceBindings] = useState(true)

    const loadStatus = async () => {
        try {
            const response = await fetch("/api/admin/abio-catalog/status", { cache: "no-store" })
            const payload = await response.json()
            if (response.ok) {
                setStatus(payload.data || null)
            }
        } catch (error) {
            console.error("Error loading ABIO catalog status", error)
        }
    }

    useEffect(() => {
        void loadStatus()
    }, [])

    const handleSync = async () => {
        setLoading(true)
        try {
            const response = await fetch("/api/admin/abio-catalog/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resource: "all" }),
            })
            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "No se pudo sincronizar el catálogo ABIO")
            }
            await loadStatus()
            onCatalogChanged?.()
            alert("Catálogo ABIO sincronizado correctamente")
        } catch (error) {
            console.error(error)
            alert(error instanceof Error ? error.message : "No se pudo sincronizar el catálogo ABIO")
        } finally {
            setLoading(false)
        }
    }

    const handleImportBindings = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setLoading(true)
        try {
            const buffer = await file.arrayBuffer()
            const workbook = XLSX.read(buffer, { type: "array" })
            const firstSheetName = workbook.SheetNames[0]
            const sheet = workbook.Sheets[firstSheetName]
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
                defval: "",
                raw: false,
            })

            if (rows.length === 0) {
                throw new Error("El archivo no contiene filas válidas")
            }

            const response = await fetch("/api/admin/abio-catalog/bindings/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rows,
                    replaceAll: replaceBindings,
                }),
            })
            const payload = await response.json()
            if (!response.ok) {
                throw new Error(payload.error || "No se pudo importar la tabla de amarre")
            }

            await loadStatus()
            onCatalogChanged?.()
            alert(
                `Tabla de amarre importada. Filas activas: ${payload.data.imported}. Desactivadas: ${payload.data.deactivated}.`
            )
        } catch (error) {
            console.error(error)
            alert(error instanceof Error ? error.message : "No se pudo importar la tabla de amarre")
        } finally {
            setLoading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ""
            }
        }
    }

    return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-blue-900">Catálogo ABIO y tabla de amarre</h4>
                    <p className="text-xs text-blue-800">
                        Sincroniza servicios, disciplinas y horarios desde ABIO. Importa la tabla de amarre para validar combinaciones y sembrar cupos.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={handleSync} loading={loading}>
                        Sincronizar catálogo ABIO
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Importar tabla de amarre
                    </Button>
                </div>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleImportBindings}
            />

            <label className="flex items-center gap-2 text-xs text-blue-900">
                <input
                    type="checkbox"
                    checked={replaceBindings}
                    onChange={(e) => setReplaceBindings(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                />
                Reemplazar bindings activos de las sucursales incluidas en el archivo
            </label>

            {status && (
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <div className="rounded-md bg-white px-3 py-2 border">
                        <div className="text-gray-500">Servicios</div>
                        <div className="font-semibold">{status.counts.services}</div>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2 border">
                        <div className="text-gray-500">Disciplinas</div>
                        <div className="font-semibold">{status.counts.disciplines}</div>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2 border">
                        <div className="text-gray-500">Horarios</div>
                        <div className="font-semibold">{status.counts.schedules}</div>
                    </div>
                    <div className="rounded-md bg-white px-3 py-2 border">
                        <div className="text-gray-500">Bindings</div>
                        <div className="font-semibold">{status.counts.bindings}</div>
                    </div>
                </div>
            )}
        </div>
    )
}
