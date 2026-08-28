import type { Prisma } from "@prisma/client"

import { isBlackoutMonth } from "@/lib/membership-config"
import {
    getMembershipScheduleProfile,
    validateMembershipScheduleSelection,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { usesTicketDateCapacity } from "@/lib/ticket-date-capacity"
import { buildEntitlementDates } from "@/lib/entitlement-dates"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type CarnetIssuanceInput = {
    userId: string
    ticketTypeId: string
    attendeeName?: string | null
    attendeeDni?: string | null
    amountPaid?: number
    membershipStartDate?: string | null
    membershipSchedule?: MembershipScheduleInput | null
    scheduleSelections?: Array<{ date: string; shift?: string | null }>
    sourceRef: string
    reason: string
    forceCapacity?: boolean
    allowExistingActive?: boolean
    sendEmail?: boolean
}

/** El TicketType con su evento, ya cargado desde la BD. */
export type CarnetTicketTypeContext = {
    id: string
    name: string
    isActive: boolean
    capacity: number
    sold: number
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
    isPackage: boolean
    packageDaysCount: number | null
    /** EVENTO con cupo por fecha (ver `usesTicketDateCapacity`). Piscina libre ignora este flag. */
    capacityByDate: boolean
    validDays: Prisma.JsonValue | null
    eventId: string
    event: {
        id: string
        title: string
        category: string
        servilexSucursalCode: string
        startDate: Date
        endDate: Date
        membershipStartFixed: Date | null
        membershipStartMin: Date | null
        membershipStartMax: Date | null
    }
}

/** Inventario por fecha de un ticketType con cupo por fecha (piscina libre o EVENTO+capacityByDate). */
export type CarnetDateInventory = {
    date: string
    capacity: number
    sold: number
    isEnabled: boolean
}

export type CarnetValidationContext = {
    input: CarnetIssuanceInput
    user: { id: string; email: string; name: string }
    ticketType: CarnetTicketTypeContext
    /** Codigo del carnet ACTIVE que este usuario ya tiene para este tipo, si hay. */
    existingActiveTicketCode: string | null
    /** Id de la orden previa con el mismo sourceRef, si ya se emitio. */
    duplicateOrderId: string | null
    /** Solo si `usesTicketDateCapacity` aplica: inventario configurado del ticketType. */
    dateInventory: CarnetDateInventory[]
}

export type CarnetPlan = {
    userId: string
    userEmail: string
    userName: string
    ticketTypeId: string
    ticketTypeName: string
    eventId: string
    eventTitle: string
    attendeeName: string
    attendeeDni: string | null
    amountPaid: number
    membershipStartDate: string | null
    membershipSchedule: MembershipScheduleSelection | null
    scheduleSelections: Array<{ date: string; shift: string | null }>
    /** Fechas de entitlement en formato YYYY-MM-DD, para mostrar en el preview. */
    entitlementDates: string[]
    providerOrderNumber: string
    sourceRef: string
    reason: string
    capacityBefore: number
    capacityTotal: number
    /**
     * Dos gates independientes: el cupo global (ticketType.capacity/sold) y el
     * cupo por fecha (TicketTypeDateInventory). Cada uno es true solo si se
     * salto SU propio tope realmente lleno, no si el check estaba marcado de
     * mas ni por estar lleno el otro gate. `issueCarnet` los usa por separado
     * para decidir que guard quitar en cada escritura.
     */
    forcedGlobalCapacity: boolean
    forcedDateCapacity: boolean
    allowedExistingActive: boolean
    sendEmail: boolean
    warnings: string[]
}

export type CarnetValidationResult =
    | { ok: true; plan: CarnetPlan }
    | { ok: false; errors: string[] }

/**
 * Referencia de idempotencia para emisiones del panel. El servidor la genera en
 * el preview y la UI la devuelve al emitir, de modo que un doble clic choque
 * contra la guarda de duplicados en vez de crear dos carnets.
 */
export function buildPanelSourceRef(userId: string, ticketTypeId: string, now: Date = new Date()): string {
    return `panel:${userId}:${ticketTypeId}:${now.getTime()}`
}

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10)

export function validateCarnetRequest(ctx: CarnetValidationContext): CarnetValidationResult {
    const { input, user, ticketType } = ctx
    const errors: string[] = []
    const warnings: string[] = []

    const reason = (input.reason ?? "").trim()
    if (!reason) errors.push("Indica el motivo de la emision.")

    if (!ticketType.isActive) {
        errors.push(`El tipo de entrada "${ticketType.name}" esta inactivo.`)
    }

    if (ctx.duplicateOrderId) {
        errors.push(
            `Este carnet ya se emitio (orden ${ctx.duplicateOrderId.slice(-8).toUpperCase()}).`
        )
    }

    if (ctx.existingActiveTicketCode) {
        if (input.allowExistingActive) {
            warnings.push(
                `${user.email} ya tiene el carnet activo ${ctx.existingActiveTicketCode} para "${ticketType.name}".`
            )
        } else {
            errors.push(
                `${user.email} ya tiene el carnet activo ${ctx.existingActiveTicketCode} para "${ticketType.name}". Marca "permitir duplicado" si es intencional.`
            )
        }
    }

    // ── Cupo global ───────────────────────────────────────────────────────────
    const hasGlobalCap = ticketType.capacity > 0
    const globalFull = hasGlobalCap && ticketType.sold >= ticketType.capacity
    if (globalFull) {
        if (input.forceCapacity) {
            warnings.push(
                `Sobrecupo: "${ticketType.name}" esta en ${ticketType.sold}/${ticketType.capacity}.`
            )
        } else {
            errors.push(
                `No hay cupo para "${ticketType.name}" (${ticketType.sold}/${ticketType.capacity}).`
            )
        }
    }

    // ── Fecha de inicio de membresia ──────────────────────────────────────────
    const isMembership = (ticketType.monthlyClassLimit ?? 0) > 0
    const isFixedTerm = isMembership && (ticketType.membershipDurationMonths ?? 0) > 0
    const fixedStart = ticketType.event.membershipStartFixed
    let membershipStartDate: string | null = fixedStart
        ? toDateKey(fixedStart)
        : (input.membershipStartDate ?? null)

    if (isFixedTerm && !membershipStartDate) {
        errors.push(`Indica la fecha de inicio para "${ticketType.name}".`)
    }

    if (membershipStartDate) {
        if (!DATE_RE.test(membershipStartDate)) {
            errors.push(`La fecha de inicio "${membershipStartDate}" no tiene el formato AAAA-MM-DD.`)
            membershipStartDate = null
        } else {
            if (isBlackoutMonth(Number(membershipStartDate.slice(5, 7)))) {
                errors.push("La membresia no puede empezar en enero ni febrero.")
            }
            const min = ticketType.event.membershipStartMin
                ? toDateKey(ticketType.event.membershipStartMin)
                : null
            const max = ticketType.event.membershipStartMax
                ? toDateKey(ticketType.event.membershipStartMax)
                : null
            if (min && membershipStartDate < min) {
                errors.push(`El inicio ${membershipStartDate} es anterior al minimo ${min}.`)
            }
            if (max && membershipStartDate > max) {
                errors.push(`El inicio ${membershipStartDate} supera el maximo ${max}.`)
            }
        }
    }

    // ── Horario semanal ───────────────────────────────────────────────────────
    const profile = getMembershipScheduleProfile(
        ticketType.event.servilexSucursalCode,
        ticketType.membershipScheduleKey
    )
    let membershipSchedule: MembershipScheduleSelection | null = null
    if (profile) {
        const validation = validateMembershipScheduleSelection(
            profile,
            input.membershipSchedule ?? null,
            ticketType.event.servilexSucursalCode
        )
        if (validation.ok) {
            membershipSchedule = validation.selection
        } else {
            errors.push(validation.error)
        }
    }

    // ── Fechas (piscina libre, EVENTO con cupo por fecha, y paquetes) ──────────
    const selections = (input.scheduleSelections ?? [])
        .filter((s) => DATE_RE.test(s.date))
        .map((s) => ({ date: s.date, shift: s.shift?.trim() ? s.shift.trim() : null }))

    const isPoolFree = isPoolFreeEventCategory(ticketType.event.category)
    // La bolsa de piscina libre (isPackage + pool-free) no elige fecha al emitirse:
    // las visitas se reservan despues (draw-down), asi que nunca consume cupo por
    // fecha aqui ni pre-genera entitlements. Este carve-out es exclusivo de
    // piscina libre; un EVENTO con capacityByDate no tiene ese concepto de bolsa.
    const isBag = ticketType.isPackage && isPoolFree
    const usesDateCapacity = usesTicketDateCapacity({
        eventCategory: ticketType.event.category,
        capacityByDate: ticketType.capacityByDate,
    })

    let skippedFullDate = false
    if (usesDateCapacity && !isBag) {
        if (selections.length === 0) {
            errors.push("Elige la fecha de la visita.")
        } else {
            const dateKey = selections[0].date
            const cell = ctx.dateInventory.find((row) => row.date === dateKey)
            if (!cell) {
                // Sin fila de inventario no hay como saber si hay cupo, y la
                // escritura (requireConfigured: true) tampoco la crea sola: el
                // preview debe rechazar esto en vez de dejarlo pasar en limpio.
                errors.push(
                    `No hay inventario configurado para el ${dateKey} en "${ticketType.name}".`
                )
            } else if (!cell.isEnabled) {
                // Forzar sobrecupo NO abre una fecha cerrada: cerrarla es una
                // decision operativa, no un tope lleno.
                errors.push(`La fecha ${dateKey} esta cerrada para "${ticketType.name}".`)
            } else if (cell.capacity > 0 && cell.sold >= cell.capacity) {
                if (input.forceCapacity) {
                    skippedFullDate = true
                    warnings.push(
                        `Sobrecupo del dia ${dateKey}: ${cell.sold}/${cell.capacity}.`
                    )
                } else {
                    errors.push(
                        `No hay cupo para "${ticketType.name}" el ${dateKey} (${cell.sold}/${cell.capacity}).`
                    )
                }
            }
        }
    }

    if (ticketType.isPackage && ticketType.packageDaysCount && !isBag) {
        const unique = new Set(selections.map((s) => s.date))
        if (unique.size < ticketType.packageDaysCount) {
            errors.push(
                `"${ticketType.name}" requiere ${ticketType.packageDaysCount} fechas; elegiste ${unique.size}.`
            )
        }
    }

    if (errors.length > 0) return { ok: false, errors }

    const entitlementDates = buildEntitlementDates({
        ticketType: {
            isPackage: ticketType.isPackage,
            packageDaysCount: ticketType.packageDaysCount,
            monthlyClassLimit: ticketType.monthlyClassLimit,
            validDays: ticketType.validDays,
        },
        event: { startDate: ticketType.event.startDate, endDate: ticketType.event.endDate },
        attendee: selections.length > 0 ? { scheduleSelections: selections } : null,
        eventCategory: ticketType.event.category,
    })

    const amountPaid = Number.isFinite(input.amountPaid) ? Number(input.amountPaid) : 0

    return {
        ok: true,
        plan: {
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            ticketTypeId: ticketType.id,
            ticketTypeName: ticketType.name,
            eventId: ticketType.eventId,
            eventTitle: ticketType.event.title,
            attendeeName: (input.attendeeName ?? "").trim() || user.name,
            attendeeDni: (input.attendeeDni ?? "").trim() || null,
            amountPaid: amountPaid < 0 ? 0 : amountPaid,
            membershipStartDate,
            membershipSchedule,
            scheduleSelections: selections,
            entitlementDates: entitlementDates.map(toDateKey),
            providerOrderNumber: `PRES-${input.sourceRef}`,
            sourceRef: input.sourceRef,
            reason,
            capacityBefore: ticketType.sold,
            capacityTotal: ticketType.capacity,
            // Cada gate solo es true si DE VERDAD se salto su propio tope lleno.
            // Marcar el check sin que hubiera nada lleno, o que el otro gate
            // estuviera lleno, no debe desactivar el guard de la escritura.
            forcedGlobalCapacity: Boolean(input.forceCapacity) && globalFull,
            forcedDateCapacity: Boolean(input.forceCapacity) && skippedFullDate,
            allowedExistingActive: Boolean(ctx.existingActiveTicketCode && input.allowExistingActive),
            sendEmail: input.sendEmail !== false,
            warnings,
        },
    }
}
