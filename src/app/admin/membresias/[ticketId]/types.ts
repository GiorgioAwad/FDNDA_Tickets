import type { MembershipScheduleSelection } from "@/lib/membership-schedule"

export interface DetailTicketType {
    id: string
    eventId: string
    sucursalCode: string | null
    name: string
    price: number
    capacity: number
    sold: number
    isActive: boolean
    isPackage: boolean
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
}

export interface DetailCandidateType extends DetailTicketType {
    eventTitle: string
    sameEvent: boolean
    // Perfil de horario del tipo DESTINO, no del actual: la cascada de un
    // cambio de sede tiene que ofrecer las horas que existen alla, que no son
    // las mismas que las del tipo de origen (Tarea 10, hallazgo 3). Null en
    // sedes sin catalogo (la franja ES el tipo, ej. VMT).
    scheduleProfile: ScheduleProfile | null
}

export interface DetailHistoryRow {
    id: string
    kind: "SCHEDULE" | "TRANSFER"
    reason: string
    before: { scheduleSummary: string; ticketTypeName: string; sucursalCode: string | null }
    after: { scheduleSummary: string; ticketTypeName: string; sucursalCode: string | null }
    createdAt: string
    actor: { name: string | null; email: string }
}

export interface MembershipDetail {
    ticket: {
        id: string
        ticketCode: string
        status: "ACTIVE" | "CANCELLED" | "EXPIRED"
        attendeeName: string | null
        attendeeDni: string | null
        matricula: string | null
        membershipStartDate: string | null
        user: { id: string; name: string | null; email: string }
    }
    event: { id: string; title: string; sucursalCode: string | null }
    ticketType: DetailTicketType
    order: {
        id: string
        status: string
        provider: string
        totalAmount: number
        buyerName: string | null
        // En venta presencial y cortesia NO se emite boleta: es un hecho
        // plano del origen del carnet, no una advertencia. Para el resto de
        // providers, invoiceNumber se cruza por matricula del asistente y
        // puede venir null legitimamente (matricula sin invoice emitido
        // todavia, o sin matricula que cruzar).
        invoicing:
            | { kind: "sin_boleta"; label: string }
            | { kind: "boleta"; invoiceNumber: string | null }
    }
    diagnosis: {
        today: string
        accessStatus: "OK" | "NOT_STARTED" | "EXPIRED" | "BLACKOUT" | "FROZEN" | "NOT_APPLICABLE"
        startStr: string
        expiryStr: string
        frozenMonth: string | null
        monthIndex: number | null
        periodStart: string | null
        periodEnd: string | null
        attendance: { total: number; used: number; remaining: number }
        // Selection cruda del horario efectivo del mes; la ficha usa el
        // resumen ya formateado (effectiveScheduleSummary) pero el endpoint
        // manda tambien el objeto crudo.
        effectiveSchedule: MembershipScheduleSelection | null
        effectiveScheduleSummary: string
        baseScheduleSummary: string
        monthlyScheduleCount: number
    }
    scheduleProfile: ScheduleProfile | null
    currentScheduleInput: { category: string | null; frequency: string | null; hours: Record<string, string> }
    candidateTypes: DetailCandidateType[]
    history: DetailHistoryRow[]
}

export interface ScheduleProfile {
    key: string
    label: string
    planMode: "CHOOSE_FREQUENCY" | "FIXED_FREQUENCY"
    categories: Array<{
        id: "ADULTOS" | "NINOS"
        label: string
        frequencies: Array<{
            id: string
            label: string
            dayGroups: Array<{
                id: string
                label: string
                weekdays: number[]
                hours: Array<{ start: string; end: string }>
            }>
        }>
    }>
}
