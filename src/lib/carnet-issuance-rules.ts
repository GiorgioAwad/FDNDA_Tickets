import type { Prisma } from "@prisma/client"

import { isBlackoutMonth } from "@/lib/membership-config"
import {
    getMembershipScheduleProfile,
    validateMembershipScheduleSelection,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"
import { isPoolBagTicketType } from "@/lib/pool-bag-classification"
import { getTicketSelectableDates, usesTicketDateCapacity } from "@/lib/ticket-date-capacity"
import { parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { buildEntitlementDates } from "@/lib/entitlement-dates"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * El regex solo comprueba la FORMA. `2026-11-31` la cumple, pero noviembre no
 * tiene 31 dias: `parseDateInput` (lib/utils.ts) la normaliza en silencio a
 * `2026-12-01`, asi que el preview mostraria una fecha y la BD guardaria otra
 * (y en una membresia de termino fijo eso corre todo el plazo). Este
 * round-trip -- parsear y volver a formatear -- es el mismo que hacia
 * `assertDateKey` en el script de import antes de refactorizarlo.
 */
const isValidDateKey = (value: string): boolean => {
    if (!DATE_RE.test(value)) return false
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === value
}

/**
 * Errores que la capa de dominio (issueCarnet, en carnet-issuance.ts) lanza
 * deliberadamente, con un mensaje en espanol pensado para mostrarse tal cual
 * al admin (duplicado, tipo de entrada eliminado, cupo agotado). Las rutas
 * solo devuelven el `.message` de una excepcion cuando es instancia de esta
 * clase; cualquier otro error (conexion caida, violacion de FK, timeout de
 * transaccion, SQL crudo de un helper) cae al mensaje generico. Se define
 * aca, no en carnet-issuance.ts, para que tanto el dominio como las rutas
 * puedan importarla sin crear un ciclo (carnet-issuance.ts ya importa de
 * este modulo; este modulo no importa de carnet-issuance.ts).
 */
export class CarnetIssuanceError extends Error {
    /**
     * `options.cause` deja adjunta la excepcion original cuando este error
     * envuelve a otro (p. ej. el `Error` pelado de
     * reserveTicketTypeDateInventory): el admin ve el mensaje en espanol y el
     * console.error de la ruta conserva la causa real para diagnosticar.
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = "CarnetIssuanceError"
    }
}

/**
 * Discriminador estable de un rechazo, para que quien consuma el resultado no
 * tenga que hacer match contra el texto del mensaje. El script de import
 * (scripts/issue-presential-carnets.ts) lo usa para separar "esta fila ya se
 * emitio, saltala" de "esta fila tiene un error, aborta el lote": reconocer
 * eso por prosa hacia que reescribir un mensaje de este modulo rompiera en
 * silencio el reintento de un lote a medio emitir.
 */
export type CarnetValidationErrorCode = "ALREADY_ISSUED"

export type CarnetValidationIssue = {
    message: string
    code?: CarnetValidationErrorCode
}

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
    /**
     * Marca de origen que queda en `Order.providerResponse.source`. El
     * historial del panel (GET /api/admin/carnets) filtra exactamente por
     * "admin-carnet-panel", asi que otro emisor (el import por CSV) debe
     * mandar SU propia marca para no ensuciar ese historial. Default:
     * "admin-carnet-panel".
     */
    source?: string | null
    /**
     * Datos de facturacion de la orden. No disparan comprobante (la boleta se
     * emite fuera de la web), pero `buyerDocNumber`/`buyerPhone` son columnas
     * de los exports de asistentes y `buyerPhone` es ademas clave de busqueda
     * en /api/admin/memberships: dejarlas vacias hace que el carnet emitido
     * sea imposible de encontrar por telefono y salga en blanco en reporteria.
     */
    buyerName?: string | null
    buyerPhone?: string | null
    buyerDocNumber?: string | null
    documentType?: string | null
    /**
     * Metadatos de auditoria libres que se mezclan en
     * `Order.providerResponse` (lote, numero de fila, fila original del CSV).
     * No hay tabla de auditoria -- el rastro vive en ese JSON -- por eso este
     * canal existe. Las claves canonicas que escribe issueCarnet (source,
     * issuedBy*, reason, forced*, issuedAt) siempre ganan.
     */
    extra?: Record<string, unknown> | null
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

/**
 * Por que `entitlementDates` puede venir vacio. Sin esto la UI no puede
 * distinguir una bolsa de piscina (las visitas se reservan despues, una por
 * una) de una membresia por cupo mensual (el escaner crea el entitlement del
 * dia al vuelo), y describia las dos como "por clase (cupo mensual)".
 */
export type CarnetEntitlementMode = "MONTHLY_CLASS" | "POOL_BAG" | "DATES"

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
    entitlementMode: CarnetEntitlementMode
    providerOrderNumber: string
    sourceRef: string
    reason: string
    /** Marca de origen para `Order.providerResponse.source` (ver CarnetIssuanceInput.source). */
    source: string
    /** Datos de facturacion resueltos, con los defaults ya aplicados. */
    documentType: string
    buyerDocType: string
    buyerDocNumber: string | null
    buyerName: string
    buyerPhone: string | null
    /** Metadatos de auditoria a mezclar en `Order.providerResponse`. */
    auditExtra: Record<string, unknown>
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
    | { ok: false; errors: string[]; issues: CarnetValidationIssue[] }

/**
 * Referencia de idempotencia para emisiones del panel. El servidor la genera en
 * el preview y la UI la devuelve al emitir, de modo que un doble clic choque
 * contra la guarda de duplicados en vez de crear dos carnets.
 */
export function buildPanelSourceRef(userId: string, ticketTypeId: string, now: Date = new Date()): string {
    return `panel:${userId}:${ticketTypeId}:${now.getTime()}`
}

/** Marca de origen del panel admin. El historial (GET /api/admin/carnets) filtra por esta. */
export const DEFAULT_CARNET_SOURCE = "admin-carnet-panel"

export function validateCarnetRequest(ctx: CarnetValidationContext): CarnetValidationResult {
    const { input, user, ticketType } = ctx
    const issues: CarnetValidationIssue[] = []
    const warnings: string[] = []
    const addError = (message: string, code?: CarnetValidationErrorCode) => {
        issues.push(code ? { message, code } : { message })
    }

    const reason = (input.reason ?? "").trim()
    if (!reason) addError("Indica el motivo de la emision.")

    if (!ticketType.isActive) {
        addError(`El tipo de entrada "${ticketType.name}" esta inactivo.`)
    }

    if (ctx.duplicateOrderId) {
        addError(
            `Este carnet ya se emitio (orden ${ctx.duplicateOrderId.slice(-8).toUpperCase()}).`,
            "ALREADY_ISSUED"
        )
    }

    if (ctx.existingActiveTicketCode) {
        if (input.allowExistingActive) {
            warnings.push(
                `${user.email} ya tiene el carnet activo ${ctx.existingActiveTicketCode} para "${ticketType.name}".`
            )
        } else {
            addError(
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
            addError(
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
        addError(`Indica la fecha de inicio para "${ticketType.name}".`)
    }

    if (membershipStartDate) {
        if (!isValidDateKey(membershipStartDate)) {
            addError(
                `La fecha de inicio "${membershipStartDate}" no es una fecha valida del calendario (AAAA-MM-DD).`
            )
            membershipStartDate = null
        } else {
            if (isBlackoutMonth(Number(membershipStartDate.slice(5, 7)))) {
                addError("La membresia no puede empezar en enero ni febrero.")
            }
            const min = ticketType.event.membershipStartMin
                ? toDateKey(ticketType.event.membershipStartMin)
                : null
            const max = ticketType.event.membershipStartMax
                ? toDateKey(ticketType.event.membershipStartMax)
                : null
            if (min && membershipStartDate < min) {
                addError(`El inicio ${membershipStartDate} es anterior al minimo ${min}.`)
            }
            if (max && membershipStartDate > max) {
                addError(`El inicio ${membershipStartDate} supera el maximo ${max}.`)
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
            addError(validation.error)
        }
    }

    // ── Turno ─────────────────────────────────────────────────────────────────
    // El panel manda `{ date }` a secas: no captura turno. Para un tipo que lo
    // exige, el ticket quedaria con expectedShift = null y el escaner
    // (api/scans/lookup) se saltaria la validacion de turno, con lo que el
    // titular entraria a AMBOS turnos consumiendo un solo cupo del dia. Se
    // rechaza en vez de emitir un carnet con ese agujero. El predicado es el
    // mismo que usa el checkout publico (orders/route.ts): requireShiftSelection
    // Y ademas hay turnos configurados.
    const scheduleConfig = parseTicketScheduleConfig(ticketType.validDays)
    if (scheduleConfig.requireShiftSelection && scheduleConfig.shifts.length > 0) {
        addError(
            `"${ticketType.name}" exige elegir turno y este panel todavia no permite seleccionarlo: no se puede emitir desde aca.`
        )
    }

    // ── Fechas (piscina libre, EVENTO con cupo por fecha, y paquetes) ──────────
    // Una fecha con forma correcta pero inexistente (2026-11-31) se reporta
    // como error propio en vez de descartarse en silencio: descartarla movia el
    // diagnostico a un mensaje enganoso mas abajo ("requiere 3 fechas; elegiste
    // 2" cuando el problema real era el tipeo).
    const selections: Array<{ date: string; shift: string | null }> = []
    const seenDates = new Set<string>()
    // Cuantas selecciones se cayeron por invalidas o repetidas. Mientras haya
    // alguna, el conteo de fechas del paquete es ruido derivado y se calla (ver
    // abajo): la peticion ya se rechaza por el error de verdad.
    let rejectedSelections = 0
    for (const raw of input.scheduleSelections ?? []) {
        const rawDate = typeof raw?.date === "string" ? raw.date.trim() : ""
        if (!isValidDateKey(rawDate)) {
            addError(
                `La fecha "${rawDate || "(vacia)"}" no es una fecha valida del calendario (AAAA-MM-DD).`
            )
            rejectedSelections += 1
            continue
        }
        if (seenDates.has(rawDate)) {
            // Mismo criterio que el checkout publico, que rechaza repetir un dia
            // (orders/route.ts). Aceptarlo descuadraba el cupo: la reserva por
            // fecha contaba la repeticion, pero normalizeScheduleSelections
            // deduplica por `date::shift` antes de crear los entitlements, asi
            // que se cobraba un cupo que nadie podia usar.
            addError(`No repitas la fecha ${rawDate} en "${ticketType.name}".`)
            rejectedSelections += 1
            continue
        }
        seenDates.add(rawDate)
        const rawShift = typeof raw?.shift === "string" ? raw.shift.trim() : ""
        selections.push({ date: rawDate, shift: rawShift || null })
    }

    // La bolsa de piscina libre no elige fecha al emitirse: las visitas se
    // reservan despues (draw-down), asi que nunca consume cupo por fecha aqui ni
    // pre-genera entitlements. Se usa el predicado canonico
    // (`isPoolBagTicketType`), que ademas exige packageDaysCount > 0: un tipo
    // PISCINA_LIBRE guardado con "es paquete" y el conteo de dias vacio NO es
    // una bolsa, y tiene que pasar por el gate de fecha como cualquier visita
    // suelta -- si no, entra sin consumir cupo de ningun dia.
    const isBag = isPoolBagTicketType({
        eventCategory: ticketType.event.category,
        isPackage: ticketType.isPackage,
        packageDaysCount: ticketType.packageDaysCount,
    })
    // Un cuerpo armado a mano puede traer fechas para una bolsa. Se descartan:
    // buildEntitlementDates devuelve [] para una bolsa, asi que reservarlas
    // cobraria cupo de dias que ningun entitlement va a usar.
    const effectiveSelections = isBag ? [] : selections

    const usesDateCapacity = usesTicketDateCapacity({
        eventCategory: ticketType.event.category,
        capacityByDate: ticketType.capacityByDate,
    })

    // Ventana de fechas legitimas del tipo de entrada: las de `validDays` si
    // estan configuradas, y si no todos los dias del evento. Es el MISMO helper
    // que aplica el checkout publico (orders/route.ts). Sin esto la unica
    // barrera era "existe fila de inventario", que no corre para los tipos sin
    // cupo por fecha: un tipeo de anio (2027 por 2026) escribia entitlements
    // fuera del evento, que despues el panel no puede revocar.
    if (effectiveSelections.length > 0) {
        const selectable = new Set(
            getTicketSelectableDates({
                validDays: ticketType.validDays,
                eventStartDate: ticketType.event.startDate,
                eventEndDate: ticketType.event.endDate,
            })
        )
        for (const selection of effectiveSelections) {
            if (!selectable.has(selection.date)) {
                addError(
                    `La fecha ${selection.date} no es valida para "${ticketType.name}" (fuera del calendario del evento).`
                )
            }
        }
    }

    let skippedFullDate = false
    if (usesDateCapacity && !isBag) {
        if (effectiveSelections.length === 0) {
            addError("Elige la fecha de la visita.")
        } else {
            // Un paquete (isPackage + packageDaysCount > 1) selecciona varias
            // fechas distintas para el MISMO ticket: cada una consume su propio
            // cupo y hay que validarlas todas, no solo la primera. Las fechas
            // repetidas ya se rechazaron arriba, asi que cada una consume
            // exactamente 1 unidad.
            for (const selection of effectiveSelections) {
                const dateKey = selection.date
                const cell = ctx.dateInventory.find((row) => row.date === dateKey)
                if (!cell) {
                    // Sin fila de inventario no hay como saber si hay cupo, y la
                    // escritura (requireConfigured: true) tampoco la crea sola: el
                    // preview debe rechazar esto en vez de dejarlo pasar en limpio.
                    addError(
                        `No hay inventario configurado para el ${dateKey} en "${ticketType.name}".`
                    )
                } else if (!cell.isEnabled) {
                    // Forzar sobrecupo NO abre una fecha cerrada: cerrarla es una
                    // decision operativa, no un tope lleno.
                    addError(`La fecha ${dateKey} esta cerrada para "${ticketType.name}".`)
                } else if (cell.capacity > 0 && cell.sold + 1 > cell.capacity) {
                    if (input.forceCapacity) {
                        skippedFullDate = true
                        warnings.push(
                            `Sobrecupo del dia ${dateKey}: ${cell.sold}/${cell.capacity}.`
                        )
                    } else {
                        addError(
                            `No hay cupo para "${ticketType.name}" el ${dateKey} (${cell.sold}/${cell.capacity}).`
                        )
                    }
                }
            }
        }
    }

    // El conteo se calla si alguna seleccion se cayo antes (fecha imposible o
    // repetida): en ese caso "elegiste 2" cuenta lo que sobrevivio, no lo que
    // el admin mando, y era exactamente el diagnostico desviado que hacia
    // buscar el problema en el lugar equivocado. La peticion igual se rechaza,
    // por el error real.
    if (ticketType.isPackage && ticketType.packageDaysCount && !isBag && rejectedSelections === 0) {
        const unique = new Set(effectiveSelections.map((s) => s.date))
        if (unique.size < ticketType.packageDaysCount) {
            addError(
                `"${ticketType.name}" requiere ${ticketType.packageDaysCount} fechas; elegiste ${unique.size}.`
            )
        }
    }

    if (issues.length > 0) {
        return { ok: false, errors: issues.map((issue) => issue.message), issues }
    }

    const entitlementDates = buildEntitlementDates({
        ticketType: {
            isPackage: ticketType.isPackage,
            packageDaysCount: ticketType.packageDaysCount,
            monthlyClassLimit: ticketType.monthlyClassLimit,
            validDays: ticketType.validDays,
        },
        event: { startDate: ticketType.event.startDate, endDate: ticketType.event.endDate },
        attendee: effectiveSelections.length > 0 ? { scheduleSelections: effectiveSelections } : null,
        eventCategory: ticketType.event.category,
    })

    const amountPaid = Number.isFinite(input.amountPaid) ? Number(input.amountPaid) : 0
    const attendeeDni = (input.attendeeDni ?? "").trim() || null
    // Mismo default que tenia el script de import antes del refactor: si no
    // viene documento del comprador, se usa el del asistente.
    const buyerDocNumber = (input.buyerDocNumber ?? "").trim() || attendeeDni
    // "6" = RUC (11 digitos), "1" = DNI. Derivado del largo, como en el script.
    const buyerDocType = buyerDocNumber && buyerDocNumber.length === 11 ? "6" : "1"

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
            attendeeDni,
            amountPaid: amountPaid < 0 ? 0 : amountPaid,
            membershipStartDate,
            membershipSchedule,
            scheduleSelections: effectiveSelections,
            entitlementDates: entitlementDates.map(toDateKey),
            entitlementMode: isBag ? "POOL_BAG" : isMembership ? "MONTHLY_CLASS" : "DATES",
            providerOrderNumber: `PRES-${input.sourceRef}`,
            sourceRef: input.sourceRef,
            reason,
            source: (input.source ?? "").trim() || DEFAULT_CARNET_SOURCE,
            documentType: (input.documentType ?? "").trim() || "BOLETA",
            buyerDocType,
            buyerDocNumber,
            buyerName: (input.buyerName ?? "").trim() || user.name,
            buyerPhone: (input.buyerPhone ?? "").trim() || null,
            auditExtra: input.extra ?? {},
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
