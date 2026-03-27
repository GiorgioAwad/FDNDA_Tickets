import { prisma } from "@/lib/prisma"
import { generateTicketCode, getDaysBetween, formatPrice } from "@/lib/utils"
import { sendPurchaseEmail } from "@/lib/email"
import { onTicketSold } from "@/lib/cached-queries"
import { extractTicketValidDates, normalizeScheduleSelections } from "@/lib/ticket-schedule"
import type { Prisma } from "@prisma/client"

export interface FulfillOrderResult {
    success: boolean
    alreadyPaid?: boolean
    error?: string
}

interface FulfillOrderInput {
    orderId: string
    providerRef?: string
    providerResponse?: Prisma.InputJsonValue
}

type StoredAttendeeData = {
    name?: string | null
    dni?: string | null
    matricula?: string | null
    scheduleSelections?: unknown
}

type InvoiceDbClient = Prisma.TransactionClient | typeof prisma

async function upsertPendingInvoice(
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
        invoice?: {
            status:
                | "PENDING"
                | "PROCESSING"
                | "ISSUED"
                | "FAILED"
                | "FAILED_RETRYABLE"
                | "FAILED_REQUIRES_REVIEW"
        } | null
    }
) {
    const documentType = order.documentType === "FACTURA" ? "FACTURA" : "BOLETA"
    const baseSnapshot = {
        documentType,
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

    await db.invoice.upsert({
        where: { orderId: order.id },
        update: order.invoice?.status === "ISSUED"
            ? baseSnapshot
            : {
                ...baseSnapshot,
                status: "PENDING",
                retryCount: 0,
                lastError: null,
            },
        create: {
            orderId: order.id,
            status: "PENDING",
            retryCount: 0,
            ...baseSnapshot,
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
}): Date[] => {
    const configuredDates = extractTicketValidDates(input.ticketType.validDays)
    const allEventDates = getDaysBetween(input.event.startDate, input.event.endDate)
        .map((date) => date.toISOString().split("T")[0])
    const selectedDates = normalizeScheduleSelections(input.attendee?.scheduleSelections).map(
        (selection) => selection.date
    )

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
}: FulfillOrderInput): Promise<FulfillOrderResult> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            user: true,
            invoice: {
                select: {
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
        await upsertPendingInvoice(prisma, order)
        return { success: true, alreadyPaid: true }
    }

    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        return { success: false, error: "Order not payable" }
    }

    const updateData: Prisma.OrderUpdateManyMutationInput = {
        status: "PAID",
    }

    if (!order.paidAt) {
        updateData.paidAt = new Date()
    }

    if (providerRef) {
        updateData.providerRef = providerRef
    }

    if (providerResponse) {
        updateData.providerResponse = providerResponse
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
            await upsertPendingInvoice(tx, order)
            return { alreadyPaid: true }
        }

        for (const item of order.orderItems) {
            const event = item.ticketType.event
            const attendeeData = Array.isArray(item.attendeeData)
                ? (item.attendeeData as StoredAttendeeData[])
                : []

            for (let i = 0; i < item.quantity; i++) {
                const attendee = attendeeData[i] || { name: null, dni: null }
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
                })
                const ticketCode = generateTicketCode()

                await tx.ticket.create({
                    data: {
                        orderId: order.id,
                        userId: order.userId,
                        eventId: event.id,
                        ticketTypeId: item.ticketTypeId,
                        ticketCode,
                        attendeeName: attendee.name || order.user.name,
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

        await upsertPendingInvoice(tx, order)

        return { alreadyPaid: false }
    })

    if (fulfillmentResult.alreadyPaid) {
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
