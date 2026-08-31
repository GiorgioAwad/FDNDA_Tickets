import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { sendPurchaseEmail } from "@/lib/email"
import { usesTicketDateCapacity } from "@/lib/ticket-date-capacity"
import { reserveTicketTypeDateInventory } from "@/lib/ticket-date-inventory"
import { formatPrice, generateTicketCode, parseDateOnly } from "@/lib/utils"
import {
    CarnetIssuanceError,
    validateCarnetRequest,
    type CarnetIssuanceInput,
    type CarnetPlan,
    type CarnetValidationResult,
} from "@/lib/carnet-issuance-rules"

const TICKET_TYPE_SELECT = {
    id: true,
    name: true,
    isActive: true,
    capacity: true,
    sold: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    isPackage: true,
    packageDaysCount: true,
    capacityByDate: true,
    validDays: true,
    eventId: true,
    event: {
        select: {
            id: true,
            title: true,
            category: true,
            servilexSucursalCode: true,
            startDate: true,
            endDate: true,
            membershipStartFixed: true,
            membershipStartMin: true,
            membershipStartMax: true,
        },
    },
} satisfies Prisma.TicketTypeSelect

/**
 * Rechazo que no nace de las reglas sino de la carga de contexto (no existe el
 * usuario / el tipo de entrada). Va sin `code` porque no hay ningun consumidor
 * que necesite distinguirlo: los codigos existen para lo que el script tiene
 * que clasificar (ver CarnetValidationErrorCode).
 */
const contextFailure = (message: string): CarnetValidationResult => ({
    ok: false,
    errors: [message],
    issues: [{ message }],
})

/**
 * Carga el contexto desde la BD y valida. No escribe nada: es el dry-run que
 * usan tanto el preview del panel como el script.
 */
export async function planCarnetIssuance(
    input: CarnetIssuanceInput
): Promise<CarnetValidationResult> {
    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, name: true },
    })
    if (!user) return contextFailure("El usuario no existe.")

    const ticketType = await prisma.ticketType.findUnique({
        where: { id: input.ticketTypeId },
        select: TICKET_TYPE_SELECT,
    })
    if (!ticketType) return contextFailure("El tipo de entrada no existe.")

    const [duplicate, existingActive] = await Promise.all([
        prisma.order.findFirst({
            where: { provider: "PRESENCIAL", providerOrderNumber: `PRES-${input.sourceRef}` },
            select: { id: true },
        }),
        prisma.ticket.findFirst({
            where: {
                userId: user.id,
                ticketTypeId: ticketType.id,
                status: "ACTIVE",
                order: { status: "PAID" },
            },
            select: { ticketCode: true },
        }),
    ])

    const dateInventory = usesTicketDateCapacity({
        eventCategory: ticketType.event.category,
        capacityByDate: ticketType.capacityByDate,
    })
        ? (
              await prisma.ticketTypeDateInventory.findMany({
                  where: { ticketTypeId: ticketType.id },
                  select: { date: true, capacity: true, sold: true, isEnabled: true },
              })
          ).map((row) => ({
              date: row.date.toISOString().slice(0, 10),
              capacity: row.capacity,
              sold: row.sold,
              isEnabled: row.isEnabled,
          }))
        : []

    return validateCarnetRequest({
        input,
        user: { id: user.id, email: user.email, name: user.name },
        ticketType,
        existingActiveTicketCode: existingActive?.ticketCode ?? null,
        duplicateOrderId: duplicate?.id ?? null,
        dateInventory,
    })
}

/**
 * Escribe el carnet: cupos, orden PRESENCIAL, item, ticket y entitlements, todo
 * en una transaccion. El correo va despues del commit, best-effort.
 */
export async function issueCarnet(
    plan: CarnetPlan,
    actor: { id: string; email: string }
): Promise<{ orderId: string; ticketCode: string; emailSent: boolean; emailError: string | null }> {
    const now = new Date()

    const created = await prisma.$transaction(async (tx) => {
        // 0. Guarda de idempotencia por sourceRef. Repite dentro de la
        //    transaccion el check que planCarnetIssuance hace con el cliente
        //    global, para que el reintento de un lote (o un doble clic que
        //    reenvia el MISMO sourceRef del preview) no cree una segunda orden.
        //
        //    Cuidado con lo que esta guarda NO da: bajo READ COMMITTED (el
        //    default de Postgres y de Prisma; aca no se fija isolation level)
        //    dos transacciones concurrentes no ven las filas que la otra aun no
        //    confirmo, asi que este findFirst no serializa nada por si solo. Si
        //    dos emisiones con el mismo sourceRef entran a la vez, ambas leen
        //    "no existe" y ambas insertan. Lo que de verdad las ordena es el
        //    row-lock que toma el `ticketType.updateMany` de abajo (todas las
        //    emisiones del mismo ticketType compiten por esa fila), y lo que
        //    cerraria el hueco del todo seria un unique sobre
        //    (provider, providerOrderNumber) -- que no existe: esta rama no
        //    puede tocar el schema. No se elimine esta guarda pensando que el
        //    unique sobra, ni se confie en ella como si fuera el unique.
        const existingOrder = await tx.order.findFirst({
            where: { provider: "PRESENCIAL", providerOrderNumber: plan.providerOrderNumber },
            select: { id: true },
        })
        if (existingOrder) {
            throw new CarnetIssuanceError(
                `Este carnet ya se emitio (orden ${existingOrder.id.slice(-8).toUpperCase()}).`
            )
        }

        // 1. Cupo global. Con forcedGlobalCapacity el incremento va sin guard; sin
        //    el, el guard hace que dos emisiones simultaneas no pasen del tope.
        const ticketType = await tx.ticketType.findUnique({
            where: { id: plan.ticketTypeId },
            select: {
                capacity: true,
                isActive: true,
                name: true,
                eventId: true,
                capacityByDate: true,
                event: { select: { category: true } },
            },
        })
        if (!ticketType) {
            throw new CarnetIssuanceError(`El tipo de entrada "${plan.ticketTypeName}" ya no existe.`)
        }
        // isActive se comprueba por separado del cupo: los dos van juntos en el
        // `where` del updateMany de abajo, asi que sin este check un tipo
        // desactivado entre el preview y el commit se reportaba como "no hay
        // cupo", que manda al admin a buscar el problema donde no esta.
        if (!ticketType.isActive) {
            throw new CarnetIssuanceError(`El tipo de entrada "${ticketType.name}" esta inactivo.`)
        }

        const capacityWhere =
            ticketType.capacity > 0 && !plan.forcedGlobalCapacity
                ? { sold: { lt: ticketType.capacity } }
                : {}
        const updated = await tx.ticketType.updateMany({
            where: { id: plan.ticketTypeId, isActive: true, ...capacityWhere },
            data: { sold: { increment: 1 } },
        })
        if (updated.count !== 1) {
            // El where cubre cupo Y isActive: el chequeo de arriba descarta el
            // caso comun, pero entre esa lectura y este update alguien pudo
            // desactivar el tipo, asi que el mensaje nombra las dos causas.
            throw new CarnetIssuanceError(
                `No se pudo emitir "${ticketType.name}": el cupo se lleno o el tipo de entrada se desactivo.`
            )
        }

        // 1b. Carnet activo duplicado, DENTRO de la transaccion y despues del
        //     update de arriba a proposito: ese update toma el row-lock del
        //     ticketType, asi que dos emisiones del mismo tipo se serializan y
        //     la segunda si ve el ticket que confirmo la primera. El unico
        //     check equivalente vivia en planCarnetIssuance, fuera de toda
        //     transaccion: dos admins con la misma planilla previsualizaban y
        //     emitian a la vez, ninguno veia el ticket del otro (cada sourceRef
        //     lleva su Date.now(), asi que la guarda de idempotencia tampoco
        //     los cruzaba) y quedaban dos carnets ACTIVE con sold +2.
        if (!plan.allowedExistingActive) {
            const existingActive = await tx.ticket.findFirst({
                where: {
                    userId: plan.userId,
                    ticketTypeId: plan.ticketTypeId,
                    status: "ACTIVE",
                    order: { status: "PAID" },
                },
                select: { ticketCode: true },
            })
            if (existingActive) {
                throw new CarnetIssuanceError(
                    `${plan.userEmail} ya tiene el carnet activo ${existingActive.ticketCode} para "${ticketType.name}". Marca "permitir duplicado" si es intencional.`
                )
            }
        }

        // 2. Cupo por fecha (piscina libre, o EVENTO con capacityByDate).
        const usesDateCapacity = usesTicketDateCapacity({
            eventCategory: ticketType.event.category,
            capacityByDate: ticketType.capacityByDate,
        })
        if (usesDateCapacity && plan.scheduleSelections.length > 0) {
            // Un paquete selecciona varias fechas para el mismo ticket: cada una
            // consume su propio cupo, por eso el mapa por fecha.
            //
            // Las fechas repetidas ya las rechazo validateCarnetRequest, asi que
            // aca cada fecha vale 1. (buildTicketDateReservationCounts, del
            // checkout, tampoco "cuenta duplicados": lo que no deduplica es
            // ENTRE asistentes distintos de una misma compra, y un carnet tiene
            // exactamente un asistente. Contar dos veces el mismo dia reservaba
            // un cupo que ningun entitlement iba a usar, porque
            // normalizeScheduleSelections deduplica por `date::shift`.)
            const dateCounts = new Map<string, number>()
            for (const selection of plan.scheduleSelections) {
                dateCounts.set(selection.date, (dateCounts.get(selection.date) ?? 0) + 1)
            }

            if (plan.forcedDateCapacity) {
                // Incremento sin guard, aqui y no en el helper del checkout. Cada
                // fecha se incrementa por su propia cantidad, no solo la primera.
                for (const [dateKey, count] of dateCounts) {
                    const bumped = await tx.ticketTypeDateInventory.updateMany({
                        where: { ticketTypeId: plan.ticketTypeId, date: parseDateOnly(dateKey) },
                        data: { sold: { increment: count } },
                    })
                    if (bumped.count === 0) {
                        throw new CarnetIssuanceError(`No hay inventario configurado para el ${dateKey}.`)
                    }
                }
            } else {
                // reserveTicketTypeDateInventory lanza `Error` pelado (y corre
                // SQL crudo). La ruta solo devuelve el texto de una
                // CarnetIssuanceError, asi que sin esta traduccion el caso mas
                // probable de todos -- que el checkout publico se lleve el
                // ultimo cupo del dia entre el preview y el clic -- llegaba al
                // admin como "Error al emitir el carnet". Se reetiqueta aca;
                // ticket-date-inventory.ts esta congelado (corre en el checkout
                // de produccion) y no se toca.
                try {
                    await reserveTicketTypeDateInventory(tx, {
                        ticketTypeId: plan.ticketTypeId,
                        templateCapacity: 0,
                        reservations: dateCounts,
                        ticketLabel: plan.ticketTypeName,
                        requireConfigured: true,
                    })
                } catch (error) {
                    const dates = Array.from(dateCounts.keys()).join(", ")
                    throw new CarnetIssuanceError(
                        `No se pudo reservar el cupo de "${plan.ticketTypeName}" para ${dates}: el dia se lleno o dejo de estar configurado. Vuelve a previsualizar.`,
                        { cause: error }
                    )
                }
            }
        }

        const order = await tx.order.create({
            data: {
                userId: plan.userId,
                status: "PAID",
                orderType: "TICKET",
                totalAmount: plan.amountPaid,
                currency: "PEN",
                provider: "PRESENCIAL",
                providerRef: plan.sourceRef,
                providerOrderNumber: plan.providerOrderNumber,
                // No hay tabla de auditoria (esta rama no puede migrar el
                // schema): el rastro de quien emitio, por que y con que
                // overrides vive en este JSON. `auditExtra` trae los
                // metadatos propios de cada emisor (el import por CSV manda
                // lote/fila/fila original) y va PRIMERO para que no pueda
                // pisar ninguna de las claves canonicas de abajo.
                //
                // `source` distingue al emisor: el historial del panel
                // (GET /api/admin/carnets) filtra por "admin-carnet-panel",
                // asi que un lote importado por CSV manda su propia marca y no
                // aparece ahi.
                providerResponse: {
                    ...plan.auditExtra,
                    source: plan.source,
                    issuedByUserId: actor.id,
                    issuedByEmail: actor.email,
                    reason: plan.reason,
                    forcedGlobalCapacity: plan.forcedGlobalCapacity,
                    forcedDateCapacity: plan.forcedDateCapacity,
                    allowedExistingActive: plan.allowedExistingActive,
                    issuedAt: now.toISOString(),
                } as Prisma.InputJsonValue,
                paidAt: now,
                // Datos de facturacion. No disparan comprobante (la boleta se
                // emite fuera de la web), pero buyerDocNumber y buyerPhone son
                // columnas de los exports de asistentes y buyerPhone es clave
                // de busqueda en /api/admin/memberships: hardcodearlos hacia
                // que un lote importado quedara sin telefono, invisible para
                // esa busqueda y en blanco en la reporteria.
                documentType: plan.documentType,
                buyerDocType: plan.buyerDocType,
                buyerDocNumber: plan.buyerDocNumber,
                buyerName: plan.buyerName,
                buyerEmail: plan.userEmail,
                buyerPhone: plan.buyerPhone,
                orderItems: {
                    create: [
                        {
                            ticketTypeId: plan.ticketTypeId,
                            quantity: 1,
                            unitPrice: plan.amountPaid,
                            subtotal: plan.amountPaid,
                            attendeeData: [
                                {
                                    name: plan.attendeeName,
                                    dni: plan.attendeeDni,
                                    membershipStartDate: plan.membershipStartDate,
                                    membershipSchedule: plan.membershipSchedule,
                                    scheduleSelections: plan.scheduleSelections,
                                },
                            ] as Prisma.InputJsonValue,
                        },
                    ],
                },
            },
            select: { id: true },
        })

        const ticket = await tx.ticket.create({
            data: {
                orderId: order.id,
                userId: plan.userId,
                eventId: plan.eventId,
                ticketTypeId: plan.ticketTypeId,
                ticketCode: generateTicketCode(),
                attendeeName: plan.attendeeName,
                attendeeDni: plan.attendeeDni ?? undefined,
                membershipStartDate: plan.membershipStartDate
                    ? parseDateOnly(plan.membershipStartDate)
                    : null,
                membershipSchedule: plan.membershipSchedule
                    ? (plan.membershipSchedule as unknown as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                status: "ACTIVE",
                entitlements: {
                    create: plan.entitlementDates.map((dateKey) => ({
                        date: parseDateOnly(dateKey),
                        status: "AVAILABLE" as const,
                    })),
                },
            },
            select: { ticketCode: true },
        })

        return { orderId: order.id, ticketCode: ticket.ticketCode }
    }, { timeout: 30_000 })

    // El carnet ya existe: un fallo de correo no revierte nada.
    let emailSent = false
    let emailError: string | null = null
    if (!plan.sendEmail) {
        return { ...created, emailSent: false, emailError: null }
    }
    try {
        const result = await sendPurchaseEmail(
            plan.userEmail,
            plan.userName,
            created.orderId,
            plan.eventTitle,
            1,
            formatPrice(plan.amountPaid)
        )
        emailSent = result.success
        if (!result.success) emailError = result.error ?? "desconocido"
    } catch (error) {
        emailError = error instanceof Error ? error.message : String(error)
    }

    return { ...created, emailSent, emailError }
}
