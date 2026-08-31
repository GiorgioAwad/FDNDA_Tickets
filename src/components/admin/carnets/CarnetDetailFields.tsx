"use client"

import { X } from "lucide-react"

import { MembershipScheduleSelector } from "@/components/membership/MembershipScheduleSelector"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
    MembershipScheduleInput,
    MembershipScheduleProfile,
} from "@/lib/membership-schedule"

export type CarnetTicketTypeOption = {
    id: string
    name: string
    price: number
    capacity: number
    sold: number
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    isPackage: boolean
    packageDaysCount: number | null
    capacityByDate: boolean
    /**
     * Calculado por el servidor (usesTicketDateCapacity): true para piscina
     * libre O para un EVENTO con capacityByDate=true. Es el UNICO predicado
     * que decide si este tipo de entrada necesita elegir fecha aca -- nunca
     * la categoria del evento a secas.
     */
    usesDateCapacity: boolean
    scheduleProfile: MembershipScheduleProfile | null
}

/** Fila de cupo por fecha de un ticketType con usesDateCapacity=true (piscina libre o EVENTO+capacityByDate). */
export type DateCapacityRow = { date: string; capacity: number; sold: number; isEnabled: boolean }

interface Props {
    ticketType: CarnetTicketTypeOption
    /** category === "PISCINA_LIBRE" del evento seleccionado. Solo se usa para
     * el carve-out de la bolsa de piscina libre (ver isBag abajo), nunca para
     * decidir si se muestra el selector de fecha. */
    isPoolFreeEvent: boolean
    membershipStartFixed: string | null
    startDate: string
    setStartDate: (value: string) => void
    schedule: MembershipScheduleInput
    setSchedule: (value: MembershipScheduleInput) => void
    dateInventory: DateCapacityRow[]
    selectedDates: string[]
    setSelectedDates: (value: string[]) => void
}

const selectClassName =
    "w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

export function CarnetDetailFields({
    ticketType,
    isPoolFreeEvent,
    membershipStartFixed,
    startDate,
    setStartDate,
    schedule,
    setSchedule,
    dateInventory,
    selectedDates,
    setSelectedDates,
}: Props) {
    const isMembership = (ticketType.monthlyClassLimit ?? 0) > 0

    // Ver carnet-issuance-rules.ts: la bolsa de piscina libre (paquete +
    // evento piscina libre) no elige fecha al emitirse -- las visitas se
    // reservan despues (draw-down). Este carve-out es exclusivo de piscina
    // libre; un paquete de un EVENTO con cupo por fecha si elige sus fechas.
    const isBag = ticketType.isPackage && isPoolFreeEvent

    // Selector de UNA fecha: cualquier tipo con cupo por fecha que no sea un
    // paquete. Corregido: antes se disparaba con "es piscina libre", pero el
    // cupo por fecha tambien aplica a EVENTO+capacityByDate.
    const showSingleDate = ticketType.usesDateCapacity && !ticketType.isPackage

    const needsPackageDates = ticketType.isPackage && !!ticketType.packageDaysCount && !isBag

    const toggleDate = (date: string) => {
        setSelectedDates(
            selectedDates.includes(date)
                ? selectedDates.filter((d) => d !== date)
                : [...selectedDates, date]
        )
    }

    return (
        <div className="space-y-4">
            {isMembership && (
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">Fecha de inicio</label>
                    {membershipStartFixed ? (
                        <p className="text-sm text-muted-foreground">
                            Fija por el evento: {membershipStartFixed.slice(0, 10)}
                        </p>
                    ) : (
                        <Input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="max-w-xs"
                        />
                    )}
                    <p className="text-xs text-muted-foreground">Enero y febrero estan bloqueados.</p>
                </div>
            )}

            {ticketType.scheduleProfile && (
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">Horario semanal</label>
                    <MembershipScheduleSelector
                        profile={ticketType.scheduleProfile}
                        value={schedule}
                        onChange={setSchedule}
                    />
                </div>
            )}

            {showSingleDate && (
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">Fecha</label>
                    <p className="text-xs text-muted-foreground">
                        Este tipo de entrada controla el cupo por fecha.
                    </p>
                    <select
                        value={selectedDates[0] ?? ""}
                        onChange={(event) =>
                            setSelectedDates(event.target.value ? [event.target.value] : [])
                        }
                        className={selectClassName}
                    >
                        <option value="">Elige una fecha</option>
                        {dateInventory.map((row) => (
                            <option key={row.date} value={row.date} disabled={!row.isEnabled}>
                                {row.date} — {row.isEnabled ? `${row.sold}/${row.capacity || "∞"}` : "cerrado"}
                            </option>
                        ))}
                    </select>
                    {dateInventory.length === 0 && (
                        <p className="text-xs text-amber-700">
                            No hay fechas configuradas para este tipo de entrada.
                        </p>
                    )}
                </div>
            )}

            {isBag && (
                <p className="rounded-md border border-dashed border-input bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Este paquete se emite sin elegir fecha: las visitas se reservan despues, una por una.
                </p>
            )}

            {needsPackageDates && (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                        Fechas del paquete ({selectedDates.length}/{ticketType.packageDaysCount})
                    </label>
                    <Input
                        type="date"
                        onChange={(event) => {
                            if (event.target.value) toggleDate(event.target.value)
                            event.target.value = ""
                        }}
                        className="max-w-xs"
                    />
                    {selectedDates.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                            {selectedDates.map((date) => (
                                <li key={date}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleDate(date)}
                                        className="h-7 gap-1 rounded-full px-3 text-xs"
                                    >
                                        {date}
                                        <X className="h-3 w-3" />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    )
}
