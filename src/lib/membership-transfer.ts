/**
 * Planificador de correcciones administrativas de membresias: cambio de horario
 * semanal y movimiento de carnet entre TicketTypes (horario VMT / cambio de
 * sede).
 *
 * Modulo PURO (sin Prisma ni env): recibe un snapshot de datos planos y la
 * intencion, y devuelve un plan con bloqueos y escrituras. La ruta de API lee
 * el snapshot, planifica, y —al confirmar— vuelve a leer y replanificar DENTRO
 * de la transaccion antes de escribir. Ahi reviven los `assertEqual` de los
 * scripts que este modulo reemplaza: dejan de ser "esperado X, recibido Y" y
 * pasan a ser "este carnet cambio desde que abriste la pantalla".
 *
 * Reemplaza la logica de decision de:
 *   · scripts/set-membership-schedule.ts   (SCHEDULE)
 *   · scripts/change-academia-schedule.ts  (TRANSFER, mismo evento)
 *   · scripts/reassign-membership-sites.ts (TRANSFER, otro evento)
 */
import {
    formatScheduleSummary,
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    validateMembershipScheduleSelection,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface MembershipTicketTypeSnapshot {
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

export interface MembershipInvoiceSnapshot {
    id: string
    status: string
    servilexGroupKey: string
    invoiceNumber: string | null
}

export interface MembershipChangeSnapshot {
    ticket: {
        id: string
        status: string
        eventId: string
        ticketTypeId: string
        membershipSchedule: unknown
        /** Filas de MembershipMonthlySchedule. > 0 bloquea: mover la base dejaria
         *  esos meses apuntando a un catalogo que ya no aplica. */
        monthlyScheduleCount: number
    }
    order: {
        id: string
        status: string
        provider: string
        invoices: MembershipInvoiceSnapshot[]
    }
    orderItem: {
        id: string
        ticketTypeId: string
        attendeeData: unknown
    }
    sourceType: MembershipTicketTypeSnapshot
}

export type MembershipChangeIntent =
    | { kind: "SCHEDULE"; scheduleInput: MembershipScheduleInput }
    | {
          kind: "TRANSFER"
          targetType: MembershipTicketTypeSnapshot
          /** Requerido cuando el destino tiene catalogo y el horario actual no
           *  existe alla. Si se omite y el actual si existe, se conserva. */
          scheduleInput?: MembershipScheduleInput | null
      }

// ── Resultado ─────────────────────────────────────────────────────────────────

export type MembershipChangeBlockerCode =
    | "TICKET_NOT_ACTIVE"
    | "ORDER_NOT_PAID"
    | "ATTENDEE_DATA_INVALID"
    | "HAS_MONTHLY_SCHEDULES"
    | "NO_SCHEDULE_PROFILE"
    | "SCHEDULE_INVALID"
    | "SCHEDULE_REQUIRED"
    | "TARGET_SAME_AS_SOURCE"
    | "TARGET_INACTIVE"
    | "TARGET_FULL"
    | "SOURCE_SOLD_EMPTY"
    | "TARGET_NOT_EQUIVALENT"
    | "INVOICE_MISSING"
    | "ORDER_PROVIDER_MOCK"

export interface MembershipChangeBlocker {
    code: MembershipChangeBlockerCode
    /** Texto en espanol que la UI muestra tal cual. */
    message: string
}

export interface MembershipChangeState {
    eventId: string
    ticketTypeId: string
    ticketTypeName: string
    sucursalCode: string | null
    /** "1:15:00-16:00" por sesion, ordenado — forma comparable de un horario. */
    sessions: string[]
    scheduleSummary: string
    sourceSold: number
    targetSold: number | null
}

export interface MembershipChangeWrites {
    ticket: {
        eventId?: string
        ticketTypeId?: string
        membershipSchedule?: MembershipScheduleSelection
    }
    orderItem: {
        ticketTypeId?: string
        attendeeData?: unknown[]
    }
    soldDecrementTypeId?: string
    soldIncrementTypeId?: string
}

export type MembershipChangePlan =
    | { ok: false; blockers: MembershipChangeBlocker[] }
    | {
          ok: true
          kind: "SCHEDULE" | "TRANSFER"
          /** Etiqueta para la UI y el historial. */
          label: string
          before: MembershipChangeState
          after: MembershipChangeState
          writes: MembershipChangeWrites
          fingerprint: string
      }

// ── Helpers ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/**
 * Matricula del unico asistente del item. Es lo que liga el carnet con su
 * comprobante ABIO. Devuelve null si el item no trae exactamente una persona
 * con matricula — en los scripts esto va hardcodeado por caso.
 */
export function getAttendeeMatricula(attendeeData: unknown): string | null {
    if (!Array.isArray(attendeeData) || attendeeData.length !== 1) return null
    const matricula = asRecord(attendeeData[0]).matricula
    if (typeof matricula !== "string" && typeof matricula !== "number") return null
    const text = String(matricula).trim()
    return text.length > 0 ? text : null
}

function normalizeSessions(value: unknown): string[] {
    const sessions = parseMembershipScheduleSelection(value)?.sessions ?? []
    return sessions.map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

function sessionKeys(selection: MembershipScheduleSelection | null): string[] {
    return (selection?.sessions ?? []).map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

/**
 * Huella del estado que el plan da por cierto. La ruta compara la huella de la
 * vista previa con la recalculada dentro de la transaccion: si difieren, el
 * carnet cambio entremedio y se aborta en vez de escribir.
 */
export function buildMembershipChangeFingerprint(snapshot: MembershipChangeSnapshot): string {
    return JSON.stringify({
        t: snapshot.ticket.status,
        e: snapshot.ticket.eventId,
        tt: snapshot.ticket.ticketTypeId,
        s: normalizeSessions(snapshot.ticket.membershipSchedule),
        m: snapshot.ticket.monthlyScheduleCount,
        o: snapshot.order.status,
        p: snapshot.order.provider,
        oi: snapshot.orderItem.ticketTypeId,
        sold: snapshot.sourceType.sold,
    })
}

function commonBlockers(snapshot: MembershipChangeSnapshot): MembershipChangeBlocker[] {
    const blockers: MembershipChangeBlocker[] = []
    if (snapshot.ticket.status !== "ACTIVE") {
        blockers.push({
            code: "TICKET_NOT_ACTIVE",
            message: `El carnet esta ${snapshot.ticket.status}, no ACTIVE.`,
        })
    }
    if (snapshot.order.status !== "PAID") {
        blockers.push({
            code: "ORDER_NOT_PAID",
            message: `La orden esta ${snapshot.order.status}, no PAID.`,
        })
    }
    if (snapshot.ticket.monthlyScheduleCount > 0) {
        blockers.push({
            code: "HAS_MONTHLY_SCHEDULES",
            message:
                "El carnet tiene horarios definidos por mes. Cambiar el horario base dejaria esos meses apuntando a un catalogo que ya no aplica: requiere revision manual por script.",
        })
    }
    if (getAttendeeMatricula(snapshot.orderItem.attendeeData) === null) {
        blockers.push({
            code: "ATTENDEE_DATA_INVALID",
            message:
                "El item de la orden no trae exactamente una persona con matricula. Sin matricula no se puede ligar el carnet con su comprobante.",
        })
    }
    return blockers
}

function buildState(
    type: MembershipTicketTypeSnapshot,
    selection: MembershipScheduleSelection | null,
    sessions: string[],
    sourceSold: number,
    targetSold: number | null
): MembershipChangeState {
    return {
        eventId: type.eventId,
        ticketTypeId: type.id,
        ticketTypeName: type.name,
        sucursalCode: type.sucursalCode,
        sessions,
        scheduleSummary: formatScheduleSummary(selection),
        sourceSold,
        targetSold,
    }
}

// ── Planificador ──────────────────────────────────────────────────────────────

export function planMembershipChange(
    snapshot: MembershipChangeSnapshot,
    intent: MembershipChangeIntent
): MembershipChangePlan {
    if (intent.kind === "SCHEDULE") return planScheduleChange(snapshot, intent.scheduleInput)
    return planTransfer(snapshot, intent.targetType, intent.scheduleInput ?? null)
}

function planScheduleChange(
    snapshot: MembershipChangeSnapshot,
    scheduleInput: MembershipScheduleInput
): MembershipChangePlan {
    const blockers = commonBlockers(snapshot)
    const { sourceType } = snapshot

    const profile = getMembershipScheduleProfile(
        sourceType.sucursalCode,
        sourceType.membershipScheduleKey
    )
    if (!profile) {
        blockers.push({
            code: "NO_SCHEDULE_PROFILE",
            message:
                "Esta sede no tiene catalogo de horarios semanales. Si el horario es el tipo de entrada (VMT), usa el cambio de tipo.",
        })
        return { ok: false, blockers }
    }

    const result = validateMembershipScheduleSelection(
        profile,
        scheduleInput,
        sourceType.sucursalCode ?? ""
    )
    if (!result.ok) {
        blockers.push({ code: "SCHEDULE_INVALID", message: result.error })
        return { ok: false, blockers }
    }
    if (blockers.length > 0) return { ok: false, blockers }

    const beforeSelection = parseMembershipScheduleSelection(snapshot.ticket.membershipSchedule)
    const attendee = asRecord((snapshot.orderItem.attendeeData as unknown[])[0])

    return {
        ok: true,
        kind: "SCHEDULE",
        label: "Cambio de horario semanal",
        before: buildState(
            sourceType,
            beforeSelection,
            normalizeSessions(snapshot.ticket.membershipSchedule),
            sourceType.sold,
            null
        ),
        after: buildState(sourceType, result.selection, sessionKeys(result.selection), sourceType.sold, null),
        writes: {
            ticket: { membershipSchedule: result.selection },
            // Las dos escrituras van juntas: Ticket.membershipSchedule es lo que
            // valida el escaner, OrderItem.attendeeData es el snapshot del
            // checkout. Editar solo el segundo no cambia nada en la puerta.
            orderItem: {
                attendeeData: [{ ...attendee, membershipSchedule: result.selection }],
            },
        },
        fingerprint: buildMembershipChangeFingerprint(snapshot),
    }
}

// Andamio: la Task 3 lo reemplaza por la implementacion real. Lanza a
// proposito en vez de devolver un plan vacio — un `{ ok: false, blockers: [] }`
// se veria en la UI como "no se puede, sin motivo" y podria pasar inadvertido
// si la Task 3 nunca aterriza.
function planTransfer(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot,
    scheduleInput: MembershipScheduleInput | null
): MembershipChangePlan {
    void snapshot
    void targetType
    void scheduleInput
    throw new Error("planTransfer aun no esta implementado")
}
