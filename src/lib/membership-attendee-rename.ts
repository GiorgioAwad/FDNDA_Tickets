/**
 * Cambio del nombre del asistente de un carnet desde el panel de membresías.
 *
 * La identidad vive en DOS lugares que se actualizan juntos (ver
 * project_cambio_nombre_asistente): `Ticket.attendeeName` (lo que ven el escáner,
 * la asistencia y los reportes) y la entrada del asistente en
 * `OrderItem.attendeeData` (name + firstName/secondName/lastNamePaternal/
 * lastNameMaternal). Solo cambia el nombre: DNI, matrícula, horario y fechas se
 * conservan, y el comprobante ya emitido no se toca (el comprador fiscal es quien
 * pagó).
 *
 * Módulo PURO (sin Prisma): la ruta lo corre dos veces (validación previa y dentro
 * de la transacción, con el ticket bloqueado) sobre el mismo estado.
 */
import { buildNaturalPersonFullName } from "@/lib/billing"

export class AttendeeRenameError extends Error {}

export interface AttendeeNameInput {
    firstName: string
    secondName?: string
    lastNamePaternal: string
    lastNameMaternal?: string
}

export const ATTENDEE_NAME_PART_MAX = 60

const clean = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "")
const sameName = (a: unknown, b: unknown) => clean(a).toLocaleUpperCase("es-PE") === clean(b).toLocaleUpperCase("es-PE")
const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null

export function normalizeAttendeeNameInput(raw: Partial<Record<keyof AttendeeNameInput, unknown>> | null | undefined): AttendeeNameInput {
    const parts = {
        firstName: clean(raw?.firstName),
        secondName: clean(raw?.secondName),
        lastNamePaternal: clean(raw?.lastNamePaternal),
        lastNameMaternal: clean(raw?.lastNameMaternal),
    }
    if (parts.firstName.length < 2) throw new AttendeeRenameError("Ingresa el primer nombre (mínimo 2 letras).")
    if (parts.lastNamePaternal.length < 2) throw new AttendeeRenameError("Ingresa el apellido paterno (mínimo 2 letras).")
    for (const [field, value] of Object.entries(parts)) {
        if (value.length > ATTENDEE_NAME_PART_MAX) throw new AttendeeRenameError(`El campo ${field} supera ${ATTENDEE_NAME_PART_MAX} caracteres.`)
        if (value && !/^[\p{L}][\p{L}\p{M}'.\- ]*$/u.test(value)) throw new AttendeeRenameError("Los nombres solo pueden tener letras, espacios, apóstrofo, punto o guion.")
    }
    return parts
}

export interface AttendeeRenamePlanInput {
    ticket: { status: string; attendeeName: string | null; attendeeDni: string | null }
    orderStatus: string
    attendeeData: unknown
    name: AttendeeNameInput
}

export interface AttendeeRenamePlan {
    index: number
    attendeeData: unknown[]
    beforeName: string
    afterName: string
}

/**
 * Ubica la entrada del asistente del carnet en attendeeData y devuelve la lista
 * con el nombre nuevo. Con un solo asistente es esa entrada; en compras de varios
 * (mismo OrderItem) se identifica por nombre + DNI del carnet, y debe ser única.
 */
export function planAttendeeRename(input: AttendeeRenamePlanInput): AttendeeRenamePlan {
    const { ticket, orderStatus, attendeeData, name } = input
    if (ticket.status !== "ACTIVE" || orderStatus !== "PAID") {
        throw new AttendeeRenameError("Solo se puede cambiar el nombre de carnets activos y pagados.")
    }
    const attendees = Array.isArray(attendeeData) ? attendeeData : []
    if (attendees.length === 0) throw new AttendeeRenameError("La compra no tiene datos del asistente.")

    let index = -1
    if (attendees.length === 1) {
        index = 0
    } else {
        const matches = attendees
            .map((raw, i) => ({ i, a: asRecord(raw) }))
            .filter(({ a }) => a && sameName(a.name, ticket.attendeeName) && clean(a.dni) === clean(ticket.attendeeDni))
        if (matches.length !== 1) {
            throw new AttendeeRenameError("La compra agrupa varios asistentes y no se pudo identificar el de este carnet sin ambigüedad.")
        }
        index = matches[0].i
    }
    const current = asRecord(attendees[index])
    if (!current) throw new AttendeeRenameError("Los datos del asistente no tienen un formato válido.")

    const afterName = buildNaturalPersonFullName(name)
    const beforeName = clean(ticket.attendeeName) || clean(current.name)
    if (afterName === beforeName) {
        throw new AttendeeRenameError("El nombre nuevo es igual al actual.")
    }

    const updated = {
        ...current,
        name: afterName,
        firstName: name.firstName,
        secondName: name.secondName ?? "",
        lastNamePaternal: name.lastNamePaternal,
        lastNameMaternal: name.lastNameMaternal ?? "",
    }
    return {
        index,
        attendeeData: attendees.map((raw, i) => (i === index ? updated : raw)),
        beforeName,
        afterName,
    }
}

/** Marca en before/after del historial (MembershipAdminChange) para distinguir el cambio de nombre. */
export const ATTENDEE_NAME_CHANGE_FIELD = "ATTENDEE_NAME"
