import { prisma } from "@/lib/prisma"
import { generateTicketCode, getDaysBetween, formatPrice } from "@/lib/utils"
import { sendPurchaseEmail } from "@/lib/email"
import { onTicketSold } from "@/lib/cached-queries"
import { extractTicketValidDates, normalizeScheduleSelections } from "@/lib/ticket-schedule"
import { buildNaturalPersonFullName } from "@/lib/billing"
import { buildServilexInvoiceSnapshots } from "@/lib/servilex"
import { Prisma } from "@prisma/client"

export interface FulfillOrderResult {
    success: boolean
    alreadyPaid?: boolean
    error?: string
}

interface FulfillOrderInput {
    orderId: string
    providerRef?: string
    providerResponse?: Prisma.InputJsonValue
    providerOrderNumber?: string
    providerTransactionId?: string
}

function buildOrderPaymentMetadata(input: {
    providerRef?: string
    providerResponse?: Prisma.InputJsonValue
    providerOrderNumber?: string
    providerTransactionId?: string
}) {
    const data: {
        providerRef?: string
        providerResponse?: Prisma.InputJsonValue
        providerOrderNumber?: string
        providerTransactionId?: string
    } = {}

    if (input.providerRef) {
        data.providerRef = input.providerRef
    }

    if (input.providerResponse) {
        data.providerResponse = input.providerResponse
    }

    if (input.providerOrderNumber) {
        data.providerOrderNumber = input.providerOrderNumber
    }

    if (input.providerTransactionId) {
        data.providerTransactionId = input.providerTransactionId
    }

    return data
}

async function syncPaidOrderMetadata(orderId: string, input: FulfillOrderInput) {
    const data = buildOrderPaymentMetadata(input)

    if (Object.keys(data).length === 0) {
        return
    }

    await prisma.order.update({
        where: { id: orderId },
        data,
    })
}

type StoredAttendeeData = {
    name?: string | null
    firstName?: string | null
    secondName?: string | null
    lastNamePaternal?: string | null
    lastNameMaternal?: string | null
    dni?: string | null
    matricula?: string | null
    scheduleSelections?: unknown
}

type InvoiceDbClient = Prisma.TransactionClient | typeof prisma

const toJsonValue = (
    value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput => {
    if (value === undefined || value === null) return Prisma.JsonNull
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        typeof value === "object"
    ) {
        return value as Prisma.InputJsonValue
    }
    return String(value)
}

async function syncServilexInvoices(
    db: InvoiceDbClient,
    order: {
        id: string
        documentType: string | null
        buyerDocType: string | null
        buyerDocNumber: string | null
        buyerName: string | null
        buyerAddress: string | null
        buyerEmail: string | null
        buyerPhone: string | null
        buyerUbigeo: string | null
        buyerFirstName: string | null
        buyerSecondName: string | null
        buyerLastNamePaternal: string | null
        buyerLastNameMaternal: string | null
        provider: string | null
        providerRef: string | null
        providerResponse: Prisma.JsonValue | null
        currency: string
        totalAmount: Prisma.Decimal
        paidAt: Date | null
        createdAt: Date
        user: {
            email: string
        }
        orderItems: Array<{
            quantity: number
            unitPrice: Prisma.Decimal
            attendeeData: Prisma.JsonValue | null
            ticketType: {
                name: string
                servilexEnabled: boolean
                servilexIndicator: string | null
                servilexSucursalCode: string | null
                servilexServiceCode: string | null
                servilexDisciplineCode: string | null
                servilexScheduleCode: string | null
                servilexPoolCode: string | null
                servilexExtraConfig: Prisma.JsonValue | null
                event: {
                    id: string
                    startDate: Date
                }
            }
        }>
        invoices: Array<{
            id: string
            servilexGroupKey: string
            status:
                | "PENDING"
                | "PROCESSING"
                | "ISSUED"
                | "FAILED"
                | "FAILED_RETRYABLE"
                | "FAILED_REQUIRES_REVIEW"
        }>
    }
) {
    const baseSnapshot = {
        documentType: order.documentType === "FACTURA" ? "FACTURA" : "BOLETA",
        buyerDocType: order.buyerDocType,
        buyerDocNumber: order.buyerDocNumber,
        buyerName: order.buyerName,
        buyerAddress: order.buyerAddress,
        buyerEmail: order.buyerEmail,
        buyerPhone: order.buyerPhone,
        buyerUbigeo: order.buyerUbigeo,
        buyerFirstName: order.buyerFirstName,
        buyerSecondName: order.buyerSecondName,
        buyerLastNamePaternal: order.buyerLastNamePaternal,
        buyerLastNameMaternal: order.buyerLastNameMaternal,
    } as const
    const snapshots = buildServilexInvoiceSnapshots({
        id: order.id,
        provider: order.provider,
        providerRef: order.providerRef,
        providerResponse: order.providerResponse,
        documentType: order.documentType,
        buyerDocType: order.buyerDocType,
        buyerDocNumber: order.buyerDocNumber,
        buyerName: order.buyerName,
        buyerFirstName: order.buyerFirstName,
        buyerSecondName: order.buyerSecondName,
        buyerLastNamePaternal: order.buyerLastNamePaternal,
        buyerLastNameMaternal: order.buyerLastNameMaternal,
        buyerAddress: order.buyerAddress,
        buyerUbigeo: order.buyerUbigeo,
        buyerEmail: order.buyerEmail,
        buyerPhone: order.buyerPhone,
        currency: order.currency,
        totalAmount: order.totalAmount,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        user: { email: order.user.email },
        orderItems: order.orderItems.map((item) => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            attendeeData: item.attendeeData,
            ticketType: {
                name: item.ticketType.name,
                servilexEnabled: item.ticketType.servilexEnabled,
                servilexIndicator: item.ticketType.servilexIndicator,
                servilexSucursalCode: item.ticketType.servilexSucursalCode,
                servilexServiceCode: item.ticketType.servilexServiceCode,
                servilexDisciplineCode: item.ticketType.servilexDisciplineCode,
                servilexScheduleCode: item.ticketType.servilexScheduleCode,
                servilexPoolCode: item.ticketType.servilexPoolCode,
                servilexExtraConfig: item.ticketType.servilexExtraConfig,
                event: {
                    id: item.ticketType.event.id,
                    startDate: item.ticketType.event.startDate,
                },
            },
        })),
    })

    if (snapshots.length === 0) {
        await db.invoice.deleteMany({
            where: {
                orderId: order.id,
                status: {
                    not: "ISSUED",
                },
            },
        })
        return
    }

    const existingByGroupKey = new Map(
        order.invoices.map((invoice) => [invoice.servilexGroupKey, invoice])
    )

    for (const snapshot of snapshots) {
        const existing = existingByGroupKey.get(snapshot.groupKey)

        if (existing?.status === "ISSUED") {
            continue
        }

        const shouldResetStatus =
            !existing ||
            existing.status === "FAILED" ||
            existing.status === "FAILED_RETRYABLE" ||
            existing.status === "FAILED_REQUIRES_REVIEW"

        await db.invoice.upsert({
            where: {
                orderId_servilexGroupKey: {
                    orderId: order.id,
                    servilexGroupKey: snapshot.groupKey,
                },
            },
            update: {
                ...baseSnapshot,
                servilexIndicator: snapshot.indicator,
                servilexSucursalCode: snapshot.sucursal,
                servilexGroupType: snapshot.groupType,
                servilexGroupLabel: snapshot.groupLabel,
                assignedTotal: snapshot.assignedTotal,
                alumnoSnapshot: toJsonValue(snapshot.alumno),
                servilexPayloadSnapshot: toJsonValue(snapshot),
                ...(shouldResetStatus
                    ? {
                        status: "PENDING",
                        retryCount: 0,
                        lastError: null,
                        httpStatus: null,
                        requestPayload: null,
                        requestSignature: null,
                        providerResponse: Prisma.JsonNull,
                        sentAt: null,
                        sentToProvider: false,
                    }
                    : {}),
            },
            create: {
                orderId: order.id,
                servilexGroupKey: snapshot.groupKey,
                status: "PENDING",
                retryCount: 0,
                servilexIndicator: snapshot.indicator,
                servilexSucursalCode: snapshot.sucursal,
                servilexGroupType: snapshot.groupType,
                servilexGroupLabel: snapshot.groupLabel,
                assignedTotal: snapshot.assignedTotal,
                alumnoSnapshot: toJsonValue(snapshot.alumno),
                servilexPayloadSnapshot: toJsonValue(snapshot),
                ...baseSnapshot,
            },
        })
    }

    await db.invoice.deleteMany({
        where: {
            orderId: order.id,
            servilexGroupKey: {
                notIn: snapshots.map((snapshot) => snapshot.groupKey),
            },
            status: {
                not: "ISSUED",
            },
        },
    })
}

const toDateObjectsFromDateStrings = (values: string[]): Date[] => {
    const unique = Array.from(new Set(values))
    return unique.map((value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
        if (!match) return new Date(value)
        const [, year, month, day] = match
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
    })
}

const buildEntitlementDates = (input: {
    ticketType: {
        isPackage: boolean
        packageDaysCount: number | null
        validDays: Prisma.JsonValue | null
    }
    event: {
        startDate: Date
        endDate: Date
    }
    attendee: StoredAttendeeData | null
    eventCategory?: string
}): Date[] => {
    const configuredDates = extractTicketValidDates(input.ticketType.validDays)
    const allEventDates = getDaysBetween(input.event.startDate, input.event.endDate)
        .map((date) => date.toISOString().split("T")[0])
    const selectedDates = normalizeScheduleSelections(input.attendee?.scheduleSelections).map(
        (selection) => selection.date
    )

    // Piscina libre: solo 1 entitlement (el dia seleccionado)
    if (input.eventCategory === "PISCINA_LIBRE") {
        if (selectedDates.length > 0) {
            return toDateObjectsFromDateStrings([selectedDates[0]])
        }
        return [input.event.startDate]
    }

    if (input.ticketType.isPackage && input.ticketType.packageDaysCount) {
        const requiredDays = input.ticketType.packageDaysCount
        const chosenDates: string[] = []

        for (const date of selectedDates) {
            if (!chosenDates.includes(date)) {
                chosenDates.push(date)
            }
            if (chosenDates.length >= requiredDays) break
        }

        if (chosenDates.length < requiredDays) {
            for (const date of configuredDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        if (chosenDates.length < requiredDays) {
            for (const date of allEventDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        return toDateObjectsFromDateStrings(chosenDates.slice(0, requiredDays))
    }

    if (selectedDates.length > 0) {
        return toDateObjectsFromDateStrings(selectedDates)
    }

    if (configuredDates.length > 0) {
        return toDateObjectsFromDateStrings(configuredDates)
    }

    return getDaysBetween(input.event.startDate, input.event.endDate)
}

export async function fulfillPaidOrder({
    orderId,
    providerRef,
    providerResponse,
    providerOrderNumber,
    providerTransactionId,
}: FulfillOrderInput): Promise<FulfillOrderResult> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            user: true,
            invoices: {
                select: {
                    id: true,
                    servilexGroupKey: true,
                    status: true,
                },
            },
            tickets: { select: { id: true } },
            orderItems: {
                include: {
                    ticketType: {
                        include: {
                            event: true,
                        },
                    },
                },
            },
        },
    })

    if (!order) {
        return { success: false, error: "Order not found" }
    }

    if (order.orderItems.length === 0) {
        return { success: false, error: "Order has no items" }
    }

    if (order.status === "PAID" && order.tickets.length > 0) {
        await syncPaidOrderMetadata(order.id, {
            orderId,
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        })
        await syncServilexInvoices(prisma, order)
        return { success: true, alreadyPaid: true }
    }

    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        return { success: false, error: "Order not payable" }
    }

    const updateData: Prisma.OrderUpdateManyMutationInput = {
        status: "PAID",
        ...buildOrderPaymentMetadata({
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        }),
    }

    if (!order.paidAt) {
        updateData.paidAt = new Date()
    }

    const cacheToInvalidate = new Map<string, Set<string>>()
    const fulfillmentResult = await prisma.$transaction(async (tx) => {
        const transition = await tx.order.updateMany({
            where: {
                id: order.id,
                status: "PENDING",
            },
            data: updateData,
        })

        if (transition.count === 0) {
            const currentOrder = await tx.order.findUnique({
                where: { id: order.id },
                select: {
                    status: true,
                    _count: {
                        select: { tickets: true },
                    },
                },
            })

            if (!currentOrder) {
                throw new Error("Order not found")
            }

            if (currentOrder.status === "PAID" && currentOrder._count.tickets > 0) {
                return { alreadyPaid: true }
            }

            if (currentOrder.status === "CANCELLED" || currentOrder.status === "REFUNDED") {
                throw new Error("Order not payable")
            }
        }

        const existingTickets = await tx.ticket.count({
            where: { orderId: order.id },
        })

        if (existingTickets > 0) {
            await syncServilexInvoices(tx, order)
            return { alreadyPaid: true }
        }

        for (const item of order.orderItems) {
            const event = item.ticketType.event
            const attendeeData = Array.isArray(item.attendeeData)
                ? (item.attendeeData as StoredAttendeeData[])
                : []

            for (let i = 0; i < item.quantity; i++) {
                const attendee = attendeeData[i] || { name: null, dni: null }
                const attendeeFullName =
                    buildNaturalPersonFullName({
                        firstName: attendee.firstName,
                        secondName: attendee.secondName,
                        lastNamePaternal: attendee.lastNamePaternal,
                        lastNameMaternal: attendee.lastNameMaternal,
                    }) || attendee.name || order.user.name
                const entitlementDates = buildEntitlementDates({
                    ticketType: {
                        isPackage: item.ticketType.isPackage,
                        packageDaysCount: item.ticketType.packageDaysCount,
                        validDays: item.ticketType.validDays,
                    },
                    event: {
                        startDate: event.startDate,
                        endDate: event.endDate,
                    },
                    attendee,
                    eventCategory: event.category,
                })
                const ticketCode = generateTicketCode()

                await tx.ticket.create({
                    data: {
                        orderId: order.id,
                        userId: order.userId,
                        eventId: event.id,
                        ticketTypeId: item.ticketTypeId,
                        ticketCode,
                        attendeeName: attendeeFullName,
                        attendeeDni: attendee.dni || null,
                        status: "ACTIVE",
                        entitlements: {
                            create: entitlementDates.map((date) => ({
                                date,
                                status: "AVAILABLE",
                            })),
                        },
                    },
                })
            }

            if (!cacheToInvalidate.has(item.ticketType.eventId)) {
                cacheToInvalidate.set(item.ticketType.eventId, new Set())
            }
            cacheToInvalidate.get(item.ticketType.eventId)?.add(item.ticketTypeId)
        }

        await syncServilexInvoices(tx, order)

        return { alreadyPaid: false }
    })

    if (fulfillmentResult.alreadyPaid) {
        await syncPaidOrderMetadata(order.id, {
            orderId,
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        })
        return { success: true, alreadyPaid: true }
    }

    for (const [eventId, ticketTypeIds] of cacheToInvalidate) {
        for (const ticketTypeId of ticketTypeIds) {
            await onTicketSold(eventId, ticketTypeId)
        }
    }

    if (order.orderItems.length > 0) {
        const eventTitle = order.orderItems[0]?.ticketType.event.title || "Evento FDNDA"
        const eventId = order.orderItems[0]?.ticketType.eventId
        const ticketCount = order.orderItems.reduce(
            (sum: number, item: { quantity: number }) => sum + item.quantity,
            0
        )

        // Usar email con cola (más resiliente)
        await sendPurchaseEmail(
            order.user.email,
            order.user.name,
            order.id,
            eventTitle,
            ticketCount,
            formatPrice(Number(order.totalAmount))
        )

        // Invalidar cache de evento si no se hizo en el loop
        if (eventId) {
            await onTicketSold(eventId, order.orderItems[0].ticketTypeId)
        }
    }

    return { success: true }
}
