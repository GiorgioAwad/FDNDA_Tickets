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
import { getAcMatriculaFromGroupKey } from "@/lib/servilex-invoice-guard"

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
          /** Excepcion administrativa: permite que el destino supere su cupo.
           *  Solo se registra como sobrecupo cuando el movimiento realmente
           *  deja sold por encima de capacity. */
          allowOverCapacity?: boolean
      }

// ── Resultado ─────────────────────────────────────────────────────────────────

export type MembershipChangeBlockerCode =
    | "TICKET_NOT_ACTIVE"
    | "ORDER_NOT_PAID"
    | "ATTENDEE_DATA_INVALID"
    | "HAS_MONTHLY_SCHEDULES"
    | "TICKET_EVENT_DRIFT"
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
    /** Queda persistido en el JSON de auditoria del estado destino. */
    capacityOverride?: boolean
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
          overCapacityOverride: boolean
      }

// ── Helpers ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/**
 * Un ticket es carnet de membresia cuando su tipo tiene cupo mensual de clases
 * Y duracion en meses.
 *
 * Vive aqui, en un solo sitio, porque las TRES rutas del panel (ficha, cambio
 * de horario, cambio de tipo/sede) tienen que rechazar exactamente lo mismo. Si
 * solo lo exigiera la ficha, un ADMIN podria mover de evento —con una request a
 * mano— una entrada que no es membresia y arrastrarle el `sold`.
 * `NO_SCHEDULE_PROFILE` no tapa ese hueco: el horario semanal es independiente
 * del cupo mensual (ver `hasWeeklySchedule` en scan-helpers.ts) y en TRANSFER no
 * hay ni siquiera requisito de perfil.
 */
export function isMembershipTicketType(type: {
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
}): boolean {
    return (type.monthlyClassLimit ?? 0) > 0 && (type.membershipDurationMonths ?? 0) > 0
}

/** Texto del 404 que devuelven las tres rutas cuando el ticket no es membresia. */
export const NOT_A_MEMBERSHIP_ERROR = "Este ticket no es un carnet de membresia"

/**
 * Providers cuyas ordenes NO generan comprobante: la venta se cobro fuera de la
 * web y no se emite boleta. Lista explicita a proposito — agregar una pasarela
 * nueva debe ser anadir una fila aqui, no descubrir el hueco en produccion.
 *
 * Se exporta porque es POLITICA de comprobantes, no un helper del planificador:
 * la ficha del admin la usa para etiquetar el origen de la venta. Duplicada,
 * la ficha y el planificador podrian decir cosas distintas del mismo carnet.
 */
export const PROVIDERS_SIN_BOLETA = new Set(["PRESENCIAL", "COURTESY"])

function readMatricula(entry: unknown): string | null {
    const matricula = asRecord(entry).matricula
    if (typeof matricula !== "string" && typeof matricula !== "number") return null
    const text = String(matricula).trim()
    return text.length > 0 ? text : null
}

function normalizeDoc(value: unknown): string {
    if (typeof value !== "string" && typeof value !== "number") return ""
    return String(value).trim().toUpperCase()
}

/**
 * Matricula del unico asistente del item. Es lo que liga el carnet con su
 * comprobante ABIO. Devuelve null si el item no trae exactamente una persona
 * con matricula — en los scripts esto va hardcodeado por caso.
 */
export function getAttendeeMatricula(attendeeData: unknown): string | null {
    if (!Array.isArray(attendeeData) || attendeeData.length !== 1) return null
    return readMatricula(attendeeData[0])
}

export interface AttendeeMatriculaResolution {
    /** Matricula del asistente de ESTE carnet, o null si no se pudo ubicar. */
    matricula: string | null
    /** Cuantas personas cubre el item de la orden. */
    attendeeCount: number
    /** El item cubre a mas de una persona: dos hermanos en una compra familiar. */
    isFamilyPurchase: boolean
}

/**
 * Ubica la matricula del asistente que corresponde a UN carnet concreto.
 *
 * Cuando dos hermanos compran el mismo plan eso es un solo OrderItem con
 * `quantity: 2` y dos asistentes: `getAttendeeMatricula` devuelve null y el
 * cambio se bloquea (mover el `ticketTypeId` del item arrastraria al hermano),
 * pero el DIAGNOSTICO igual tiene que decir la verdad sobre la boleta. Aqui se
 * desambigua por DNI contra `Ticket.attendeeDni`; si no alcanza, se informa que
 * es una compra familiar en vez de mentir con "boleta pendiente".
 */
export function resolveAttendeeMatricula(
    attendeeData: unknown,
    attendeeDni: string | null
): AttendeeMatriculaResolution {
    if (!Array.isArray(attendeeData) || attendeeData.length === 0) {
        return { matricula: null, attendeeCount: 0, isFamilyPurchase: false }
    }
    if (attendeeData.length === 1) {
        return {
            matricula: readMatricula(attendeeData[0]),
            attendeeCount: 1,
            isFamilyPurchase: false,
        }
    }
    const dni = normalizeDoc(attendeeDni)
    // Sin DNI en el carnet, o con dos asistentes que comparten el mismo, no hay
    // forma de decidir cual de las boletas es la de este alumno.
    const matches = dni
        ? attendeeData.filter((entry) => normalizeDoc(asRecord(entry).dni) === dni)
        : []
    return {
        matricula: matches.length === 1 ? readMatricula(matches[0]) : null,
        attendeeCount: attendeeData.length,
        isFamilyPurchase: true,
    }
}

function normalizeSessions(value: unknown): string[] {
    const sessions = parseMembershipScheduleSelection(value)?.sessions ?? []
    return sessions.map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

function sessionKeys(selection: MembershipScheduleSelection | null): string[] {
    return (selection?.sessions ?? []).map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

/**
 * Forma comparable de una seleccion de horario pedida por el admin. Las horas
 * van ordenadas por clave a proposito: la misma eleccion no puede producir dos
 * huellas distintas solo porque el JSON llego con las claves en otro orden.
 */
function normalizeScheduleIntent(input: MembershipScheduleInput | null | undefined) {
    if (!input) return null
    const hours = input.hours ?? {}
    return {
        c: input.category ?? null,
        f: input.frequency ?? null,
        h: Object.keys(hours)
            .sort()
            .map((key) => [key, hours[key]]),
    }
}

/**
 * Huella del estado que el plan da por cierto Y de la intencion que se
 * previsualizo. La ruta compara la huella de la vista previa con la recalculada
 * dentro de la transaccion: si difieren, se aborta en vez de escribir.
 *
 * La intencion (tipo destino + seleccion de horario) entra en la huella porque
 * la ruta compara y despues REPLANIFICA con la `selection` del body actual: sin
 * esto, lo unico que impide aplicar algo distinto de lo previsualizado es que
 * el cliente limpie la vista previa al tocar el formulario. Una pestana vieja o
 * un reintento programatico lo reintroduce.
 */
export function buildMembershipChangeFingerprint(
    snapshot: MembershipChangeSnapshot,
    intent?: MembershipChangeIntent
): string {
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
        i: intent
            ? {
                  k: intent.kind,
                  tt: intent.kind === "TRANSFER" ? intent.targetType.id : null,
                  s: normalizeScheduleIntent(intent.scheduleInput),
                  oc: intent.kind === "TRANSFER" ? intent.allowOverCapacity === true : false,
              }
            : null,
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
    if (intent.kind === "SCHEDULE") return planScheduleChange(snapshot, intent)
    return planTransfer(snapshot, intent)
}

function planScheduleChange(
    snapshot: MembershipChangeSnapshot,
    intent: Extract<MembershipChangeIntent, { kind: "SCHEDULE" }>
): MembershipChangePlan {
    const scheduleInput = intent.scheduleInput
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
        after: buildState(
            sourceType,
            result.selection,
            sessionKeys(result.selection),
            sourceType.sold,
            null
        ),
        writes: {
            ticket: { membershipSchedule: result.selection },
            // Las dos escrituras van juntas: Ticket.membershipSchedule es lo que
            // valida el escaner, OrderItem.attendeeData es el snapshot del
            // checkout. Editar solo el segundo no cambia nada en la puerta.
            orderItem: {
                attendeeData: [{ ...attendee, membershipSchedule: result.selection }],
            },
        },
        fingerprint: buildMembershipChangeFingerprint(snapshot, intent),
        overCapacityOverride: false,
    }
}

/** Providers que bloquean cualquier correccion. */
const PROVIDERS_BLOQUEADOS = new Set(["MOCK"])

function invoiceBlockers(snapshot: MembershipChangeSnapshot): MembershipChangeBlocker[] {
    const provider = snapshot.order.provider.trim().toUpperCase()

    if (PROVIDERS_BLOQUEADOS.has(provider)) {
        return [
            {
                code: "ORDER_PROVIDER_MOCK",
                message:
                    "La orden es de pagos simulados (MOCK) en produccion. Esa entrada se anula, no se le reasigna sede.",
            },
        ]
    }
    // Venta presencial o cortesia: no se emite boleta. No se consulta nada.
    if (PROVIDERS_SIN_BOLETA.has(provider)) return []

    const matricula = getAttendeeMatricula(snapshot.orderItem.attendeeData)
    if (matricula === null) return [] // ya lo reporta ATTENDEE_DATA_INVALID

    const issued = snapshot.order.invoices.some(
        (invoice) =>
            invoice.status === "ISSUED" &&
            getAcMatriculaFromGroupKey(invoice.servilexGroupKey) === matricula.toUpperCase()
    )
    if (issued) return []

    return [
        {
            code: "INVOICE_MISSING",
            message: `No se encontro boleta emitida para la matricula ${matricula}. Una orden pagada sin boleta significa que la emision ABIO fallo o la matricula no cuadra: eso se arregla antes de mover la sede.`,
        },
    ]
}

/** Campos en los que el tipo destino debe ser identico para no tocar la boleta. */
function equivalenceBlockers(
    source: MembershipTicketTypeSnapshot,
    target: MembershipTicketTypeSnapshot
): MembershipChangeBlocker[] {
    const diffs: string[] = []
    if (source.price !== target.price) diffs.push(`precio (${source.price} vs ${target.price})`)
    if (source.monthlyClassLimit !== target.monthlyClassLimit) {
        diffs.push(`clases al mes (${source.monthlyClassLimit} vs ${target.monthlyClassLimit})`)
    }
    if (source.membershipDurationMonths !== target.membershipDurationMonths) {
        diffs.push(
            `duracion (${source.membershipDurationMonths} vs ${target.membershipDurationMonths})`
        )
    }
    if (source.isPackage !== target.isPackage) diffs.push("modalidad de paquete")
    if (source.membershipScheduleKey !== target.membershipScheduleKey) {
        diffs.push(`plan (${source.membershipScheduleKey} vs ${target.membershipScheduleKey})`)
    }
    if (diffs.length === 0) return []
    return [
        {
            code: "TARGET_NOT_EQUIVALENT",
            message: `El tipo destino no es equivalente al origen en: ${diffs.join(", ")}. La orden y la boleta no se tocan, asi que el destino tiene que valer exactamente lo mismo.`,
        },
    ]
}

function planTransfer(
    snapshot: MembershipChangeSnapshot,
    intent: Extract<MembershipChangeIntent, { kind: "TRANSFER" }>
): MembershipChangePlan {
    const targetType = intent.targetType
    const scheduleInput = intent.scheduleInput ?? null
    const { sourceType } = snapshot
    const blockers = [...commonBlockers(snapshot), ...invoiceBlockers(snapshot)]
    const overCapacityOverride =
        intent.allowOverCapacity === true &&
        targetType.capacity !== 0 &&
        targetType.sold + 1 > targetType.capacity

    // Deriva previa entre las dos fuentes de "en que evento esta el carnet":
    // lo que se escribe es `Ticket.eventId`, pero el tipo de entrada trae el
    // suyo. Si ya no coinciden, mover el `ticketTypeId` y decidir el `eventId`
    // contra cualquiera de las dos deja medio movimiento en silencio.
    // scripts/change-academia-schedule.ts afirmaba esta igualdad antes de tocar
    // nada; aqui es un bloqueo.
    if (snapshot.ticket.eventId !== sourceType.eventId) {
        blockers.push({
            code: "TICKET_EVENT_DRIFT",
            message: `El carnet apunta al evento ${snapshot.ticket.eventId} pero su tipo de entrada pertenece al evento ${sourceType.eventId}. Con esa inconsistencia el cambio no procede: requiere revision manual antes de mover nada.`,
        })
    }

    if (targetType.id === sourceType.id) {
        blockers.push({
            code: "TARGET_SAME_AS_SOURCE",
            message: "El tipo destino es el mismo que el actual.",
        })
        return { ok: false, blockers }
    }

    blockers.push(...equivalenceBlockers(sourceType, targetType))

    if (!targetType.isActive) {
        blockers.push({ code: "TARGET_INACTIVE", message: "El tipo destino esta desactivado." })
    }
    if (
        targetType.capacity !== 0 &&
        targetType.sold + 1 > targetType.capacity &&
        !intent.allowOverCapacity
    ) {
        blockers.push({
            code: "TARGET_FULL",
            message: `El tipo destino no tiene cupo: ${targetType.sold} vendidos de ${targetType.capacity}.`,
        })
    }
    if (sourceType.sold < 1) {
        blockers.push({
            code: "SOURCE_SOLD_EMPTY",
            message: "El contador de vendidos del tipo origen ya esta en cero; descontar lo dejaria negativo.",
        })
    }

    // Horario: solo aplica si la sede destino tiene catalogo. En VMT la franja
    // ES el tipo, asi que no hay nada que reescribir.
    const targetProfile = getMembershipScheduleProfile(
        targetType.sucursalCode,
        targetType.membershipScheduleKey
    )
    const beforeSelection = parseMembershipScheduleSelection(snapshot.ticket.membershipSchedule)
    let afterSelection: MembershipScheduleSelection | null = null

    if (targetProfile) {
        const input =
            scheduleInput ??
            (beforeSelection
                ? {
                      category: beforeSelection.category,
                      frequency: beforeSelection.frequency,
                      hours: Object.fromEntries(
                          beforeSelection.groups.map((g) => [g.id, `${g.start}-${g.end}`])
                      ),
                  }
                : null)
        const result = validateMembershipScheduleSelection(
            targetProfile,
            input,
            targetType.sucursalCode ?? ""
        )
        if (!result.ok) {
            blockers.push({
                code: scheduleInput ? "SCHEDULE_INVALID" : "SCHEDULE_REQUIRED",
                message: scheduleInput
                    ? result.error
                    : `El horario actual no existe en el catalogo de la sede destino (${result.error}). Elige uno nuevo para completar el cambio.`,
            })
        } else {
            afterSelection = result.selection
        }
    }

    if (blockers.length > 0) return { ok: false, blockers }

    // Contra `ticket.eventId`, que es LO QUE SE ESCRIBE, no contra
    // `sourceType.eventId`. Llegados aqui el bloqueo de deriva ya garantizo que
    // son el mismo valor, pero la decision tiene que colgar de la fuente real.
    const sameEvent = snapshot.ticket.eventId === targetType.eventId
    const writes: MembershipChangeWrites = {
        ticket: { ticketTypeId: targetType.id },
        orderItem: { ticketTypeId: targetType.id },
        soldDecrementTypeId: sourceType.id,
        soldIncrementTypeId: targetType.id,
    }
    if (!sameEvent) writes.ticket.eventId = targetType.eventId
    if (afterSelection) {
        writes.ticket.membershipSchedule = afterSelection
        const attendee = asRecord((snapshot.orderItem.attendeeData as unknown[])[0])
        writes.orderItem.attendeeData = [{ ...attendee, membershipSchedule: afterSelection }]
    }

    return {
        ok: true,
        kind: "TRANSFER",
        label: sameEvent ? "Cambio de horario (la franja es el tipo de entrada)" : "Cambio de sede",
        before: buildState(
            sourceType,
            beforeSelection,
            normalizeSessions(snapshot.ticket.membershipSchedule),
            sourceType.sold,
            targetType.sold
        ),
        after: {
            ...buildState(
                targetType,
                afterSelection ?? beforeSelection,
                sessionKeys(afterSelection ?? beforeSelection),
                sourceType.sold - 1,
                targetType.sold + 1
            ),
            capacityOverride: overCapacityOverride,
        },
        writes,
        fingerprint: buildMembershipChangeFingerprint(snapshot, intent),
        overCapacityOverride,
    }
}
