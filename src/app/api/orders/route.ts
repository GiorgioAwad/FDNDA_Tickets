import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { buildBillingSnapshot, buildNaturalPersonFullName } from "@/lib/billing"
import { rateLimit } from "@/lib/rate-limit"
import { createOrderSchema } from "@/lib/validations"
import { onTicketSold } from "@/lib/cached-queries"
import { buildPoolFreeReservationCounts, isPoolFreeEventCategory } from "@/lib/pool-free"
import { reserveTicketTypeDateInventory } from "@/lib/ticket-date-inventory"
import {
    getShiftOptionsForDate,
    normalizeScheduleSelections,
    normalizeShiftLabel,
    parseTicketScheduleConfig,
} from "@/lib/ticket-schedule"
import { z } from "zod"

export const runtime = "nodejs"

const orderRequestSchema = createOrderSchema.extend({
    discountCodeId: z.string().optional().nullable(),
    rememberBilling: z.boolean().optional().default(false),
})

const normalizeServilexIndicator = (value: unknown): "AC" | "OS" | "PN" | "PA" => {
    if (typeof value !== "string") return "AC"
    const normalized = value.trim().toUpperCase()
    if (normalized === "OS" || normalized === "PN" || normalized === "PA") {
        return normalized
    }
    return "AC"
}

const buildGeneratedServilexMatricula = (seed: string): string => {
    let hash = 0
    for (const char of seed) {
        hash = (hash * 31 + char.charCodeAt(0)) % 10_000_000
    }
    return String(hash).padStart(7, "0")
}

const shiftLabelsMatch = (left: unknown, right: unknown): boolean => {
    const normalizedLeft = normalizeShiftLabel(left)?.toLowerCase() ?? null
    const normalizedRight = normalizeShiftLabel(right)?.toLowerCase() ?? null

    if (!normalizedLeft && !normalizedRight) return true
    if (normalizedLeft === normalizedRight) return true

    const compactLeft = normalizedLeft?.replace(/\s*\(.*\)\s*$/, "").trim() ?? null
    const compactRight = normalizedRight?.replace(/\s*\(.*\)\s*$/, "").trim() ?? null
    return compactLeft !== null && compactLeft === compactRight
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        // Rate limiting para pagos: 10 intentos por minuto por usuario
        const { success: rateLimitOk } = await rateLimit(`payment:${user.id}`, "payment")
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Espera un momento." },
                { status: 429 }
            )
        }

        const rawBody = await request.json()
        const parsedBody = orderRequestSchema.safeParse(rawBody)

        if (!parsedBody.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: parsedBody.error.issues[0]?.message || "Datos de orden invalidos",
                },
                { status: 400 }
            )
        }

        const { eventId, items, billing, discountCodeId, rememberBilling } = parsedBody.data
        const billingSnapshot = buildBillingSnapshot(billing, user.email)
        const cacheInvalidations = new Set<string>()
        const orderSeedTimestamp = Date.now()

        // Transaccion con reserva atomica de stock para evitar sobreventa.
        const order = await prisma.$transaction(async (tx) => {
            const eventConfig = await tx.event.findUnique({
                where: { id: eventId },
                select: {
                    id: true,
                    category: true,
                    startDate: true,
                    endDate: true,
                    servilexSucursalCode: true,
                },
            })

            if (!eventConfig) {
                throw new Error("Evento no encontrado")
            }

            let totalAmount = 0
            let discountAmount = 0
            let hasServilexItems = false
            let hasNonServilexItems = false
            let validatedDiscountCode: {
                id: string
                minPurchase: Prisma.Decimal | null
                value: Prisma.Decimal
                type: "PERCENTAGE" | "FIXED"
            } | null = null
            const orderItemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = []
            // Reservas de stock DIFERIDAS: se ejecutan al final de la transaccion,
            // justo antes del COMMIT, para minimizar el tiempo que se sostiene el
            // lock de la fila del ticket type (sube el throughput de compras
            // concurrentes ~2-2.5x). La atomicidad se mantiene: todo va en la misma
            // transaccion, asi que si una reserva falla, la orden hace rollback.
            const simpleReserves: Array<{ ticketTypeId: string; quantity: number; name: string }> = []
            const poolReserves: Array<{
                ticketTypeId: string
                quantity: number
                templateCapacity: number
                reservations: ReturnType<typeof buildPoolFreeReservationCounts>
                ticketLabel: string
            }> = []

            if (discountCodeId) {
                const discountCode = await tx.discountCode.findUnique({
                    where: { id: discountCodeId },
                    include: { _count: { select: { usages: true } } },
                })

                if (!discountCode || !discountCode.isActive) {
                    throw new Error("Codigo de descuento no valido")
                }

                const now = new Date()
                if (discountCode.validFrom && now < discountCode.validFrom) {
                    throw new Error("Codigo de descuento aun no vigente")
                }
                if (discountCode.validUntil && now > discountCode.validUntil) {
                    throw new Error("Codigo de descuento expirado")
                }
                if (discountCode.maxUses && discountCode._count.usages >= discountCode.maxUses) {
                    throw new Error("Codigo de descuento agotado")
                }
                if (discountCode.eventId && discountCode.eventId !== eventId) {
                    throw new Error("Codigo de descuento no valido para este evento")
                }

                if (discountCode.maxUsesPerUser) {
                    const userUsages = await tx.discountUsage.count({
                        where: { discountCodeId, userId: user.id },
                    })
                    if (userUsages >= discountCode.maxUsesPerUser) {
                        throw new Error("Ya usaste este codigo el maximo permitido")
                    }
                }

                validatedDiscountCode = {
                    id: discountCode.id,
                    minPurchase: discountCode.minPurchase,
                    value: discountCode.value,
                    type: discountCode.type,
                }
            }

            for (const item of items) {
                if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
                    throw new Error("La cantidad debe ser un entero mayor que cero")
                }

                let attendeeData = Array.isArray(item.attendees)
                    ? item.attendees.map((attendee) => ({ ...attendee }))
                    : []
                const usesDailyCapacity = isPoolFreeEventCategory(eventConfig.category)

                let reservedTicketType:
                    | {
                        id: string
                        name: string
                        price: Prisma.Decimal
                        eventId: string
                        capacity: number
                        isPackage: boolean
                        packageDaysCount: number | null
                        validDays: Prisma.JsonValue | null
                        servilexEnabled: boolean
                        servilexIndicator: string | null
                        servilexSucursalCode: string | null
                        servilexServiceCode: string | null
                        servilexDisciplineCode: string | null
                        servilexScheduleCode: string | null
                        servilexPoolCode: string | null
                        servilexExtraConfig: Prisma.JsonValue | null
                    }
                    | undefined

                if (usesDailyCapacity) {
                    const ticketType = await tx.ticketType.findUnique({
                        where: { id: item.ticketTypeId },
                        select: {
                            id: true,
                            name: true,
                            price: true,
                            eventId: true,
                            capacity: true,
                            isPackage: true,
                            packageDaysCount: true,
                            validDays: true,
                            isActive: true,
                            servilexEnabled: true,
                            servilexIndicator: true,
                            servilexSucursalCode: true,
                            servilexServiceCode: true,
                            servilexDisciplineCode: true,
                            servilexScheduleCode: true,
                            servilexPoolCode: true,
                            servilexExtraConfig: true,
                        },
                    })

                    if (!ticketType) {
                        throw new Error(`Tipo de entrada no encontrado: ${item.ticketTypeId}`)
                    }

                    if (ticketType.eventId !== eventId) {
                        throw new Error(`El tipo de entrada "${ticketType.name}" no pertenece a este evento`)
                    }

                    if (!ticketType.isActive) {
                        throw new Error(`El tipo de entrada "${ticketType.name}" no esta disponible`)
                    }

                    const reservationCounts = buildPoolFreeReservationCounts({
                        attendees: attendeeData,
                        quantity: item.quantity,
                        validDays: ticketType.validDays,
                        eventStartDate: eventConfig.startDate,
                        eventEndDate: eventConfig.endDate,
                        ticketLabel: ticketType.name,
                    })

                    // Reserva diferida (ver simpleReserves/poolReserves arriba).
                    poolReserves.push({
                        ticketTypeId: ticketType.id,
                        quantity: item.quantity,
                        templateCapacity: ticketType.capacity,
                        reservations: reservationCounts,
                        ticketLabel: ticketType.name,
                    })

                    reservedTicketType = ticketType
                } else {
                    // Lectura SIN lock del ticket type. La reserva atomica (UPDATE)
                    // se difiere al final de la transaccion (ver simpleReserves).
                    const rows = await tx.$queryRaw<
                        Array<{
                            id: string
                            name: string
                            price: Prisma.Decimal
                            eventId: string
                            capacity: number
                            sold: number
                            isActive: boolean
                            isPackage: boolean
                            packageDaysCount: number | null
                            validDays: Prisma.JsonValue | null
                            servilexEnabled: boolean
                            servilexIndicator: string | null
                            servilexSucursalCode: string | null
                            servilexServiceCode: string | null
                            servilexDisciplineCode: string | null
                            servilexScheduleCode: string | null
                            servilexPoolCode: string | null
                            servilexExtraConfig: Prisma.JsonValue | null
                            servilexBindingId: string | null
                        }>
                    >(Prisma.sql`
                        SELECT
                            "id", "name", "price", "eventId", "capacity", "sold", "isActive",
                            "isPackage", "packageDaysCount", "validDays",
                            "servilexEnabled", "servilexIndicator", "servilexSucursalCode",
                            "servilexServiceCode", "servilexDisciplineCode", "servilexScheduleCode",
                            "servilexPoolCode", "servilexExtraConfig", "servilexBindingId"
                        FROM "ticket_types"
                        WHERE "id" = ${item.ticketTypeId}
                    `)

                    const row = rows[0]

                    if (!row) {
                        throw new Error(`Tipo de entrada no encontrado: ${item.ticketTypeId}`)
                    }

                    if (row.eventId !== eventId) {
                        throw new Error(`El tipo de entrada "${row.name}" no pertenece a este evento`)
                    }

                    if (!row.isActive) {
                        throw new Error(`El tipo de entrada "${row.name}" no esta disponible`)
                    }

                    // Chequeo suave de stock para fallar temprano con mensaje claro.
                    // El control real anti-sobreventa es el UPDATE atomico diferido.
                    if (row.capacity !== 0 && row.sold + item.quantity > row.capacity) {
                        throw new Error(`El tipo de entrada "${row.name}" esta agotado`)
                    }

                    reservedTicketType = row
                    simpleReserves.push({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        name: row.name,
                    })
                }

                const scheduleConfig = parseTicketScheduleConfig(reservedTicketType.validDays)
                const requiredScheduleSelections =
                    scheduleConfig.dates.length > 0
                        ? reservedTicketType.isPackage && reservedTicketType.packageDaysCount
                            ? reservedTicketType.packageDaysCount
                            : 1
                        : 0

                if (requiredScheduleSelections > 0) {
                    const availableDates = new Set(scheduleConfig.dates)
                    const requiresShift =
                        scheduleConfig.requireShiftSelection && scheduleConfig.shifts.length > 0

                    if (attendeeData.length < item.quantity) {
                        throw new Error(`Debes completar todos los asistentes para "${reservedTicketType.name}"`)
                    }

                    attendeeData = attendeeData.map((attendee) => {
                        const selections = normalizeScheduleSelections(attendee.scheduleSelections)
                        if (selections.length < requiredScheduleSelections) {
                            throw new Error(`Selecciona dia${requiresShift ? " y turno" : ""} para "${reservedTicketType.name}"`)
                        }

                        const selectedDates = new Set<string>()
                        const scheduleSelections: Array<{ date: string; shift?: string }> = []

                        for (let i = 0; i < requiredScheduleSelections; i++) {
                            const selection = selections[i]
                            if (!selection?.date || !availableDates.has(selection.date)) {
                                throw new Error(`Selecciona un dia valido para "${reservedTicketType.name}"`)
                            }

                            if (selectedDates.has(selection.date)) {
                                throw new Error(`No repitas el mismo dia en "${reservedTicketType.name}"`)
                            }
                            selectedDates.add(selection.date)

                            if (requiresShift) {
                                const allowedShifts = getShiftOptionsForDate(scheduleConfig, selection.date)
                                const selectedShift = selection.shift || ""
                                if (
                                    !selectedShift ||
                                    !allowedShifts.some((shift) => shiftLabelsMatch(shift, selectedShift))
                                ) {
                                    throw new Error(`Selecciona un turno valido para "${reservedTicketType.name}"`)
                                }
                                scheduleSelections.push({ date: selection.date, shift: selectedShift })
                            } else {
                                scheduleSelections.push({ date: selection.date })
                            }
                        }

                        return {
                            ...attendee,
                            scheduleSelections,
                        }
                    })
                }

                const subtotal = Number(reservedTicketType.price) * item.quantity
                totalAmount += subtotal

                if (reservedTicketType.servilexEnabled) {
                    hasServilexItems = true
                    const indicator = normalizeServilexIndicator(
                        reservedTicketType.servilexIndicator,
                    )
                    const commonRequiredCodes = [
                        reservedTicketType.servilexIndicator,
                        eventConfig.servilexSucursalCode,
                        reservedTicketType.servilexServiceCode,
                    ]

                    if (commonRequiredCodes.some((value) => !String(value || "").trim())) {
                        throw new Error(`El tipo de entrada "${reservedTicketType.name}" no tiene configuracion Servilex base completa`)
                    }

                    if (indicator === "AC") {
                        const requiredCodes = [
                            reservedTicketType.servilexDisciplineCode,
                            reservedTicketType.servilexScheduleCode,
                            reservedTicketType.servilexPoolCode,
                        ]

                        if (requiredCodes.some((value) => !String(value || "").trim())) {
                            throw new Error(`El tipo de entrada "${reservedTicketType.name}" no tiene configuracion Servilex AC completa`)
                        }

                        const attendees = attendeeData
                        if (attendees.length < item.quantity) {
                            throw new Error(`Debes completar todos los asistentes para "${reservedTicketType.name}"`)
                        }

                        attendeeData = attendees.map((attendee, attendeeIndex) => ({
                            ...attendee,
                            name:
                                buildNaturalPersonFullName({
                                    firstName: attendee.firstName,
                                    secondName: attendee.secondName,
                                    lastNamePaternal: attendee.lastNamePaternal,
                                    lastNameMaternal: attendee.lastNameMaternal,
                                }) || attendee.name,
                            matricula:
                                typeof attendee.matricula === "string" && attendee.matricula.trim()
                                    ? attendee.matricula.trim()
                                    : buildGeneratedServilexMatricula(
                                        `${orderSeedTimestamp}:${eventId}:${reservedTicketType.id}:${user.id}:${attendeeIndex}`
                                    ),
                        }))
                    }

                    if (indicator === "PN" || indicator === "PA") {
                        if (!String(reservedTicketType.servilexPoolCode || "").trim()) {
                            throw new Error(`El tipo de entrada "${reservedTicketType.name}" requiere codigo de piscina`)
                        }

                        const extraConfig =
                            reservedTicketType.servilexExtraConfig &&
                            typeof reservedTicketType.servilexExtraConfig === "object" &&
                            !Array.isArray(reservedTicketType.servilexExtraConfig)
                                ? (reservedTicketType.servilexExtraConfig as Record<string, unknown>)
                                : null

                        const horaInicio =
                            typeof extraConfig?.horaInicio === "string" ? extraConfig.horaInicio.trim() : ""
                        const horaFin =
                            typeof extraConfig?.horaFin === "string" ? extraConfig.horaFin.trim() : ""
                        const duracion = Number(extraConfig?.duracion)

                        if (!horaInicio || !horaFin || !Number.isFinite(duracion) || duracion <= 0) {
                            throw new Error(`El tipo de entrada "${reservedTicketType.name}" requiere horaInicio, horaFin y duracion en Servilex`)
                        }
                    }
                } else {
                    hasNonServilexItems = true
                }

                if (hasServilexItems && hasNonServilexItems) {
                    throw new Error("No se pueden mezclar items Servilex y no Servilex en la misma compra")
                }

                orderItemsData.push({
                    ticketTypeId: item.ticketTypeId,
                    quantity: item.quantity,
                    unitPrice: reservedTicketType.price,
                    subtotal,
                    attendeeData: attendeeData as Prisma.InputJsonValue,
                })

                cacheInvalidations.add(`${eventId}:${item.ticketTypeId}`)
            }

            if (validatedDiscountCode) {
                const minPurchase = validatedDiscountCode.minPurchase
                    ? Number(validatedDiscountCode.minPurchase)
                    : 0
                const discountValue = Number(validatedDiscountCode.value)

                if (minPurchase > 0 && totalAmount < minPurchase) {
                    throw new Error(`Compra minima requerida: S/ ${minPurchase.toFixed(2)}`)
                }

                if (validatedDiscountCode.type === "PERCENTAGE") {
                    discountAmount = (totalAmount * discountValue) / 100
                } else {
                    discountAmount = Math.min(discountValue, totalAmount)
                }
            }

            const finalAmount = Math.max(0, totalAmount - discountAmount)

            const newOrder = await tx.order.create({
                data: {
                    userId: user.id,
                    status: "PENDING",
                    totalAmount: finalAmount,
                    currency: "PEN",
                    provider: (() => {
                        const pm = process.env.PAYMENTS_MODE || "mock"
                        if (pm === "openpay") return "OPENPAY"
                        if (pm === "izipay") return "IZIPAY"
                        return "MOCK"
                    })(),
                    documentType: billingSnapshot.documentType,
                    buyerDocType: billingSnapshot.buyerDocType,
                    buyerDocNumber: billingSnapshot.buyerDocNumber,
                    buyerName: billingSnapshot.buyerName,
                    buyerAddress: billingSnapshot.buyerAddress,
                    buyerEmail: billingSnapshot.buyerEmail,
                    buyerPhone: billingSnapshot.buyerPhone,
                    buyerUbigeo: billingSnapshot.buyerUbigeo,
                    buyerFirstName: billingSnapshot.buyerFirstName,
                    buyerSecondName: billingSnapshot.buyerSecondName,
                    buyerLastNamePaternal: billingSnapshot.buyerLastNamePaternal,
                    buyerLastNameMaternal: billingSnapshot.buyerLastNameMaternal,
                    orderItems: {
                        create: orderItemsData,
                    },
                },
                include: {
                    orderItems: true,
                },
            })

            if (validatedDiscountCode) {
                await tx.discountUsage.create({
                    data: {
                        discountCodeId: validatedDiscountCode.id,
                        userId: user.id,
                        orderId: newOrder.id,
                        amountSaved: discountAmount,
                    },
                })
            }

            // ===== Reserva de stock (ULTIMAS escrituras antes del COMMIT) =====
            // Atomico anti-sobreventa: el UPDATE solo afecta filas con cupo. Si no
            // hay cupo (carrera con otra compra), no retorna fila -> throw -> rollback
            // de TODA la transaccion (incluida la orden recien creada). El lock de la
            // fila se sostiene solo durante estos UPDATE + COMMIT, no durante los
            // INSERT de la orden -> mayor throughput bajo concurrencia.
            for (const r of simpleReserves) {
                const reserved = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    UPDATE "ticket_types"
                    SET "sold" = "sold" + ${r.quantity}
                    WHERE "id" = ${r.ticketTypeId}
                      AND "eventId" = ${eventId}
                      AND "isActive" = true
                      AND ("capacity" = 0 OR "sold" + ${r.quantity} <= "capacity")
                    RETURNING "id"
                `)

                if (!reserved[0]) {
                    throw new Error(`El tipo de entrada "${r.name}" esta agotado`)
                }
            }

            for (const r of poolReserves) {
                await reserveTicketTypeDateInventory(tx, {
                    ticketTypeId: r.ticketTypeId,
                    templateCapacity: r.templateCapacity,
                    reservations: r.reservations,
                    ticketLabel: r.ticketLabel,
                })

                await tx.ticketType.update({
                    where: { id: r.ticketTypeId },
                    data: { sold: { increment: r.quantity } },
                })
            }

            return { order: newOrder, discountAmount }
        }, {
            maxWait: 15000,
            timeout: 20000,
        })

        await Promise.all(
            Array.from(cacheInvalidations).map((entry) => {
                const [cacheEventId, cacheTicketTypeId] = entry.split(":")
                return onTicketSold(cacheEventId, cacheTicketTypeId)
            })
        )

        // Opt-in "recordar mis datos de comprobante": guardamos los valores TAL
        // CUAL los ingresó (dirección sin componer con ubigeo, nombre desglosado)
        // para poder autorrellenar el formulario sin duplicar el ubigeo. Si destildó
        // la casilla, olvidamos cualquier perfil previo. Best-effort: nunca rompe la
        // orden ya creada. Fuera de la transacción de stock para no alargar el lock.
        try {
            if (rememberBilling) {
                const profileData = {
                    documentType: billing.documentType,
                    buyerDocNumber: billing.buyerDocNumber,
                    buyerName: billing.buyerName ?? null,
                    buyerAddress: billing.buyerAddress ?? null,
                    buyerEmail: billing.buyerEmail ?? null,
                    buyerPhone: billing.buyerPhone ?? null,
                    buyerUbigeo: billing.buyerUbigeo ?? null,
                    buyerFirstName: billing.buyerFirstName ?? null,
                    buyerSecondName: billing.buyerSecondName ?? null,
                    buyerLastNamePaternal: billing.buyerLastNamePaternal ?? null,
                    buyerLastNameMaternal: billing.buyerLastNameMaternal ?? null,
                }
                await prisma.userBillingProfile.upsert({
                    where: { userId: user.id },
                    create: { userId: user.id, ...profileData },
                    update: profileData,
                })
            } else {
                await prisma.userBillingProfile.deleteMany({ where: { userId: user.id } })
            }
        } catch (billingProfileError) {
            console.error("No se pudo guardar el perfil de comprobante:", billingProfileError)
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.order.id,
                totalAmount: order.order.totalAmount,
                discountAmount: order.discountAmount,
                currency: order.order.currency,
            },
        })
    } catch (error) {
        console.error("Error creating order:", error)
        const message = (error as Error).message || "Error al crear orden"
        const isValidationError =
            message.includes("no valido") ||
            message.includes("invalid") ||
            message.includes("agotad") ||
            message.includes("disponible") ||
            message.includes("minima") ||
            message.includes("maximo") ||
            message.includes("entero") ||
            message.includes("pertenece") ||
            message.includes("dígitos") ||
            message.includes("fiscal") ||
            message.includes("Direccion") ||
            message.includes("Email") ||
            message.includes("Ubigeo") ||
            message.includes("matricula") ||
            message.includes("asistentes") ||
            message.includes("dia") ||
            message.includes("turno") ||
            message.includes("Servilex")

        return NextResponse.json(
            { success: false, error: message },
            { status: isValidationError ? 400 : 500 }
        )
    }
}
