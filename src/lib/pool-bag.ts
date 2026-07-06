import { normalizeShiftLabel } from "@/lib/ticket-schedule"
import { shiftsMatch } from "@/lib/ticket-shift"

// ==================== BOLSA DE PISCINA LIBRE ("10 visitas") ====================
//
// Una "bolsa" es un TicketType paquete dentro de un evento PISCINA_LIBRE: se compra
// una vez (N créditos = packageDaysCount) y luego el titular reserva cada visita
// eligiendo fecha + horario. Cada reserva consume el cupo del horario elegido en
// ticket_type_date_inventories y se guarda en PoolVisitReservation. Los "horarios"
// son los TicketTypes NO-paquete del mismo evento (los slots vendibles sueltos).

export function isPoolBagTicketType(input: {
    eventCategory?: string | null
    isPackage?: boolean | null
    packageDaysCount?: number | null
}): boolean {
    return (
        input.eventCategory === "PISCINA_LIBRE" &&
        input.isPackage === true &&
        typeof input.packageDaysCount === "number" &&
        input.packageDaysCount > 0
    )
}

// Slot de horario: TicketType de piscina libre vendible suelto (no-paquete).
export function isPoolSlotTicketType(input: {
    eventCategory?: string | null
    isPackage?: boolean | null
}): boolean {
    return input.eventCategory === "PISCINA_LIBRE" && input.isPackage !== true
}

export type PoolReservationStatusLike = "RESERVED" | "USED" | "CANCELLED"

export interface PoolBagCredits {
    total: number
    used: number
    reserved: number
    available: number
}

// Créditos de la bolsa a partir de sus reservas. `available` = lo que aún puede
// reservar; `reserved` = tomadas sin asistir; `used` = ya escaneadas.
export function getPoolBagCredits(
    reservations: Array<{ status: PoolReservationStatusLike }>,
    packageDaysCount: number | null | undefined
): PoolBagCredits {
    const total = typeof packageDaysCount === "number" && packageDaysCount > 0 ? packageDaysCount : 0
    const used = reservations.filter((r) => r.status === "USED").length
    const reserved = reservations.filter((r) => r.status === "RESERVED").length
    return { total, used, reserved, available: Math.max(total - used - reserved, 0) }
}

// Etiqueta canónica del horario ("07:00-08:00") a partir del servilexExtraConfig del
// slot. Es la que se guarda en PoolVisitReservation.shift y viaja en el QR; el
// escáner la compara con shiftsMatch. Si no hay horas configuradas, cae al nombre.
export function getPoolSlotShiftLabel(input: {
    name: string
    servilexExtraConfig?: unknown
}): string {
    const cfg = input.servilexExtraConfig
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        const record = cfg as Record<string, unknown>
        const horaInicio = typeof record.horaInicio === "string" ? record.horaInicio.trim() : ""
        const horaFin = typeof record.horaFin === "string" ? record.horaFin.trim() : ""
        if (horaInicio && horaFin) return `${horaInicio}-${horaFin}`
    }
    return input.name.trim()
}

// Minutos desde medianoche de la hora de inicio del horario (para ordenar y filtrar
// slots ya pasados hoy). null si no hay horaInicio configurada.
export function getPoolSlotStartMinutes(input: { servilexExtraConfig?: unknown }): number | null {
    const cfg = input.servilexExtraConfig
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null
    const raw = (cfg as Record<string, unknown>).horaInicio
    if (typeof raw !== "string") return null
    const match = /^(\d{2}):(\d{2})$/.exec(raw.trim())
    if (!match) return null
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
    return hours * 60 + minutes
}

// Elige la reserva objetivo entre las de un mismo día. Prioriza la que coincide con
// el turno pedido (del QR o del escáner); si no hay match, cae a la primera RESERVED
// por horario (orden alfabético del label = orden horario en "HH:MM-HH:MM").
export function pickReservationForShift<
    T extends { shift: string; status: PoolReservationStatusLike }
>(reservations: T[], requestedShift: string | null | undefined): T | null {
    if (reservations.length === 0) return null

    const wanted = normalizeShiftLabel(requestedShift)
    if (wanted) {
        const exact = reservations.find((r) => shiftsMatch(r.shift, wanted))
        if (exact) return exact
    }

    const reserved = reservations
        .filter((r) => r.status === "RESERVED")
        .sort((a, b) => a.shift.localeCompare(b.shift))
    if (reserved.length > 0) return reserved[0]

    // Todas USED: devuelve la que casa el turno pedido, o la primera, para responder
    // "ya registrada" con datos correctos.
    return reservations.slice().sort((a, b) => a.shift.localeCompare(b.shift))[0] ?? null
}
