"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { CalendarDays, Lock, Unlock, Save, Loader2 } from "lucide-react"

interface PoolTicketType {
    id: string
    name: string
    isActive?: boolean
    capacity: number
    dateInventories?: Array<{
        date: string | Date
        capacity: number
        sold: number
        isEnabled: boolean
    }>
}

interface PoolDayCuposProps {
    eventId: string
    startDate: string | Date
    endDate: string | Date
    ticketTypes: PoolTicketType[]
}

type Effective = { capacity: number; sold: number; isEnabled: boolean; hasRow: boolean }
type DraftCell = { capacity: string; isEnabled: boolean }

const toDateKey = (value: string | Date): string | null => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const year = parsed.getUTCFullYear()
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0")
    const day = String(parsed.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const invKey = (ticketTypeId: string, dateKey: string) => `${ticketTypeId}::${dateKey}`

export function PoolDayCupos({ eventId, startDate, endDate, ticketTypes }: PoolDayCuposProps) {
    const router = useRouter()

    const activeTicketTypes = useMemo(
        () =>
            ticketTypes
                .filter((t) => t.isActive !== false)
                .sort((a, b) => a.name.localeCompare(b.name)),
        [ticketTypes]
    )

    const dateOptions = useMemo(() => {
        const startKey = toDateKey(startDate)
        const endKey = toDateKey(endDate)
        if (!startKey || !endKey) return []
        const options: string[] = []
        const current = new Date(`${startKey}T00:00:00Z`)
        const end = new Date(`${endKey}T00:00:00Z`)
        while (current <= end) {
            options.push(current.toISOString().slice(0, 10))
            current.setUTCDate(current.getUTCDate() + 1)
        }
        return options
    }, [startDate, endDate])

    // Inventario real (filas existentes) indexado por (horario, fecha).
    const [invMap, setInvMap] = useState<Map<string, Effective>>(() => {
        const map = new Map<string, Effective>()
        for (const ticket of ticketTypes) {
            for (const inv of ticket.dateInventories ?? []) {
                const dateKey = toDateKey(inv.date)
                if (!dateKey) continue
                map.set(invKey(ticket.id, dateKey), {
                    capacity: inv.capacity,
                    sold: inv.sold,
                    isEnabled: inv.isEnabled,
                    hasRow: true,
                })
            }
        }
        return map
    })

    const [selectedDate, setSelectedDate] = useState<string>(() => {
        if (dateOptions.length === 0) return ""
        const todayKey = toDateKey(new Date()) ?? ""
        const upcoming = dateOptions.find((d) => d >= todayKey)
        return upcoming ?? dateOptions[0]
    })

    const [draft, setDraft] = useState<Record<string, DraftCell>>({})
    const [seedToken, setSeedToken] = useState(0)
    const [bulkValue, setBulkValue] = useState("")
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null)

    // Estado efectivo de un horario en la fecha elegida. Si no hay fila, el
    // horario activo es vendible a su capacidad base (lazy-create) -> lo
    // mostramos como abierto a la capacidad base.
    const getEffective = (ticket: PoolTicketType, dateKey: string): Effective => {
        const row = invMap.get(invKey(ticket.id, dateKey))
        if (row) return row
        return { capacity: ticket.capacity, sold: 0, isEnabled: true, hasRow: false }
    }

    // Re-siembra el borrador cuando cambia el dia o tras guardar.
    useEffect(() => {
        if (!selectedDate) return
        const next: Record<string, DraftCell> = {}
        for (const ticket of activeTicketTypes) {
            const eff = getEffective(ticket, selectedDate)
            next[ticket.id] = { capacity: String(eff.capacity), isEnabled: eff.isEnabled }
        }
        setDraft(next)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, seedToken, activeTicketTypes])

    const rows = useMemo(() => {
        return activeTicketTypes.map((ticket) => {
            const eff = getEffective(ticket, selectedDate)
            const cell = draft[ticket.id] ?? { capacity: String(eff.capacity), isEnabled: eff.isEnabled }
            const draftCapacity = cell.capacity.trim() === "" ? 0 : Number(cell.capacity)
            const dirty =
                Number.isFinite(draftCapacity) &&
                (draftCapacity !== eff.capacity || cell.isEnabled !== eff.isEnabled)
            const belowSold = cell.isEnabled && draftCapacity > 0 && draftCapacity < eff.sold
            return { ticket, eff, cell, draftCapacity, dirty, belowSold }
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTicketTypes, draft, selectedDate, invMap])

    const dirtyRows = rows.filter((r) => r.dirty)
    const hasBelowSold = rows.some((r) => r.belowSold)
    const totalSold = rows.reduce((acc, r) => acc + r.eff.sold, 0)
    const hasUnlimited = rows.some((r) => r.cell.isEnabled && r.draftCapacity === 0)
    const totalCapacity = rows.reduce(
        (acc, r) => acc + (r.cell.isEnabled ? r.draftCapacity : 0),
        0
    )

    const updateCell = (ticketTypeId: string, patch: Partial<DraftCell>) => {
        setDraft((prev) => ({
            ...prev,
            [ticketTypeId]: { ...prev[ticketTypeId], ...patch },
        }))
    }

    const applyToAll = (patch: (current: DraftCell) => DraftCell) => {
        setDraft((prev) => {
            const next: Record<string, DraftCell> = {}
            for (const ticket of activeTicketTypes) {
                next[ticket.id] = patch(prev[ticket.id] ?? { capacity: "0", isEnabled: true })
            }
            return next
        })
    }

    const closeDay = () => applyToAll((c) => ({ ...c, isEnabled: false }))
    const openDay = () => applyToAll((c) => ({ ...c, isEnabled: true }))
    const setAllCapacity = () => {
        const n = Number(bulkValue)
        if (!Number.isFinite(n) || n < 0) {
            setMessage({ kind: "error", text: "Ingresa un número de cupos válido." })
            return
        }
        applyToAll(() => ({ capacity: String(Math.floor(n)), isEnabled: true }))
    }

    const handleSave = async () => {
        if (dirtyRows.length === 0) return
        setSaving(true)
        setMessage(null)
        try {
            const response = await fetch("/api/admin/pool-inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eventId,
                    date: selectedDate,
                    cells: dirtyRows.map((r) => ({
                        ticketTypeId: r.ticket.id,
                        capacity: r.draftCapacity,
                        isEnabled: r.cell.isEnabled,
                    })),
                }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || payload.success === false) {
                throw new Error(payload.error || "Error al guardar")
            }

            setInvMap((prev) => {
                const next = new Map(prev)
                for (const row of payload.data ?? []) {
                    next.set(invKey(row.ticketTypeId, selectedDate), {
                        capacity: row.capacity,
                        sold: row.sold,
                        isEnabled: row.isEnabled,
                        hasRow: true,
                    })
                }
                return next
            })
            setSeedToken((t) => t + 1)

            const adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : []
            if (adjustments.length > 0) {
                setMessage({
                    kind: "warn",
                    text: `Guardado. ${adjustments.length} horario(s) se ajustaron al mínimo ya vendido para no generar sobreventa.`,
                })
            } else {
                setMessage({ kind: "ok", text: "Cupos guardados correctamente." })
            }
            router.refresh()
        } catch (error) {
            setMessage({ kind: "error", text: (error as Error).message || "Error al guardar" })
        } finally {
            setSaving(false)
        }
    }

    if (dateOptions.length === 0 || activeTicketTypes.length === 0) {
        return null
    }

    return (
        <Card className="mb-6 border-blue-200">
            <CardHeader className="space-y-3">
                <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-blue-600" />
                    Cupos por día
                </CardTitle>
                <p className="text-sm text-gray-500">
                    Ajusta los cupos de cada horario para un día concreto, o cierra el día completo.
                    Los cambios solo afectan a la fecha seleccionada.
                </p>
                <div className="flex flex-col gap-3 rounded-lg border bg-gray-50 p-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <label className="text-xs font-medium text-gray-700">Día</label>
                        <select
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm sm:w-64"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            disabled={saving}
                        >
                            {dateOptions.map((date) => (
                                <option key={date} value={date}>
                                    {formatDate(date, { weekday: "long", day: "2-digit", month: "long" })}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={closeDay} disabled={saving}>
                            <Lock className="mr-1 h-4 w-4" />
                            Cerrar día
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={openDay} disabled={saving}>
                            <Unlock className="mr-1 h-4 w-4" />
                            Abrir día
                        </Button>
                        <div className="flex items-end gap-1">
                            <div>
                                <label className="text-[11px] text-gray-500">Poner todos en</label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={bulkValue}
                                    onChange={(e) => setBulkValue(e.target.value)}
                                    placeholder="80"
                                    className="h-9 w-20"
                                    disabled={saving}
                                />
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={setAllCapacity} disabled={saving}>
                                Aplicar
                            </Button>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-gray-500">
                                <th className="py-2 pr-4 font-medium">Horario</th>
                                <th className="py-2 pr-4 font-medium">Vendidos</th>
                                <th className="py-2 pr-4 font-medium">Cupo</th>
                                <th className="py-2 pr-4 font-medium">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ ticket, eff, cell, draftCapacity, dirty, belowSold }) => (
                                <tr
                                    key={ticket.id}
                                    className={`border-b last:border-0 ${dirty ? "bg-amber-50" : ""}`}
                                >
                                    <td className="py-2 pr-4 font-medium text-gray-900">
                                        {ticket.name}
                                        {!eff.hasRow && (
                                            <span className="ml-2 text-[11px] font-normal text-gray-400">
                                                (sin configurar)
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-4 text-gray-600">{eff.sold}</td>
                                    <td className="py-2 pr-4">
                                        <Input
                                            type="number"
                                            min="0"
                                            value={cell.capacity}
                                            onChange={(e) => updateCell(ticket.id, { capacity: e.target.value })}
                                            disabled={saving || !cell.isEnabled}
                                            className={`h-9 w-24 ${belowSold ? "border-red-400" : ""}`}
                                        />
                                        {cell.isEnabled && draftCapacity === 0 && (
                                            <span className="ml-2 text-[11px] text-gray-400">ilimitado</span>
                                        )}
                                        {belowSold && (
                                            <span className="ml-2 text-[11px] text-red-500">
                                                &lt; vendidos ({eff.sold}); se ajustará
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-4">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={cell.isEnabled ? "default" : "outline"}
                                            className={cell.isEnabled ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                                            onClick={() => updateCell(ticket.id, { isEnabled: !cell.isEnabled })}
                                            disabled={saving}
                                        >
                                            {cell.isEnabled ? "Abierto" : "Cerrado"}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-gray-500">
                        <Badge variant="secondary" className="mr-2">
                            {totalSold} vendidos
                        </Badge>
                        <Badge variant="secondary">
                            {hasUnlimited ? "cupo con ilimitados" : `${totalCapacity} cupos`}
                        </Badge>
                        {dirtyRows.length > 0 && (
                            <span className="ml-2 text-amber-600">{dirtyRows.length} cambio(s) sin guardar</span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {message && (
                            <span
                                className={
                                    message.kind === "error"
                                        ? "text-xs text-red-600"
                                        : message.kind === "warn"
                                          ? "text-xs text-amber-600"
                                          : "text-xs text-emerald-600"
                                }
                            >
                                {message.text}
                            </span>
                        )}
                        <Button type="button" onClick={handleSave} disabled={saving || dirtyRows.length === 0}>
                            {saving ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            Guardar cambios
                        </Button>
                    </div>
                </div>
                {hasBelowSold && (
                    <p className="text-[11px] text-red-500">
                        Hay cupos por debajo de lo ya vendido. Al guardar se ajustarán automáticamente
                        al mínimo vendido para evitar sobreventa.
                    </p>
                )}
            </CardContent>
        </Card>
    )
}
