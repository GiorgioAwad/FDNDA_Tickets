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
import { z } from "zod"

export const runtime = "nodejs"

const orderRequestSchema = createOrderSchema.extend({
    discountCodeId: z.string().optional().nullable(),
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

        const { eventId, items, billing, discountCodeId } = parsedBody.data
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

                    await reserveTicketTypeDateInventory(tx, {
                        ticketTypeId: ticketType.id,
                        templateCapacity: ticketType.capacity,
                        reservations: reservationCounts,
                        ticketLabel: ticketType.name,
                    })

                    await tx.ticketType.update({
                        where: { id: ticketType.id },
                        data: {
                            sold: {
                                increment: item.quantity,
                            },
                        },
                    })

                    reservedTicketType = ticketType
                } else {
                    const reservedRows = await tx.$queryRaw<
                        Array<{
                            id: string
                            name: string
                            price: Prisma.Decimal
                            eventId: string
                            capacity: number
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
                        UPDATE "ticket_types"
                        SET "sold" = "sold" + ${item.quantity}
                        WHERE "id" = ${item.ticketTypeId}
                          AND "eventId" = ${eventId}
                          AND "isActive" = true
                          AND ("capacity" = 0 OR "sold" + ${item.quantity} <= "capacity")
                        RETURNING
                            "id",
                            "name",
                            "price",
                            "eventId",
                            "capacity",
                            "validDays",
                            "servilexEnabled",
                            "servilexIndicator",
                            "servilexSucursalCode",
                            "servilexServiceCode",
                            "servilexDisciplineCode",
                            "servilexScheduleCode",
                            "servilexPoolCode",
                            "servilexExtraConfig",
                            "servilexBindingId"
                    `)

                    reservedTicketType = reservedRows[0]

                    if (!reservedTicketType) {
                        const ticketType = await tx.ticketType.findUnique({
                            where: { id: item.ticketTypeId },
                            select: {
                                id: true,
                                name: true,
                                eventId: true,
                                isActive: true,
                                capacity: true,
                                sold: true,
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

                        throw new Error(
                            `El tipo de entrada "${ticketType.name}" esta agotado`
                        )
                    }
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
                        reservedTicketType.servilexSucursalCode,
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

                        const attendees = item.attendees || []
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
            message.includes("Servilex")

        return NextResponse.json(
            { success: false, error: message },
            { status: isValidationError ? 400 : 500 }
        )
    }
}
