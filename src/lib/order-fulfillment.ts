import { prisma } from "@/lib/prisma"
import { generateTicketCode, getDaysBetween, formatPrice } from "@/lib/utils"
import { sendPurchaseEmail, sendMerchOrderConfirmationEmail, type MerchOrderEmailItem } from "@/lib/email"
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

type SyncServilexOrderItem = {
    id: string
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
            category: string
            servilexSucursalCode: string
        }
    } | null
    merchVariant: {
        id: string
        size: string | null
        product: {
            id: string
            name: string
            servilexService: {
                id: string
                codigo: string
                indicador: string
                sede: string | null
            } | null
        }
    } | null
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
        orderItems: Array<SyncServilexOrderItem>
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
            id: item.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            attendeeData: item.attendeeData,
            ticketType: item.ticketType
                ? {
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
                        category: item.ticketType.event.category,
                        servilexSucursalCode: item.ticketType.event.servilexSucursalCode,
                    },
                }
                : null,
            merchVariant: item.merchVariant
                ? {
                    id: item.merchVariant.id,
                    size: item.merchVariant.size,
                    product: {
                        id: item.merchVariant.product.id,
                        name: item.merchVariant.product.name,
                        servilexService: item.merchVariant.product.servilexService
                            ? {
                                id: item.merchVariant.product.servilexService.id,
                                codigo: item.merchVariant.product.servilexService.codigo,
                                indicador: item.merchVariant.product.servilexService.indicador,
                                sede: item.merchVariant.product.servilexService.sede,
                            }
                            : null,
                    },
                }
                : null,
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
    const issuedGroupKeys = new Set(
        order.invoices
            .filter((invoice) => invoice.status === "ISSUED")
            .map((invoice) => invoice.servilexGroupKey)
    )

    for (const snapshot of snapshots) {
        const existing = existingByGroupKey.get(snapshot.groupKey)
        const legacyGroupKey = snapshot.legacyGroupKey || snapshot.groupKey

        if (snapshot.groupKey !== legacyGroupKey && issuedGroupKeys.has(legacyGroupKey)) {
            continue
        }

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
                    merchVariant: {
                        include: {
                            product: {
                                include: {
                                    servilexService: true,
                                },
                            },
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

    // Merch orders: branch al inicio — no generan tickets, despachan stock + email
    if (order.orderType === "MERCH") {
        return fulfillMerchOrder({
            order,
            orderId,
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        })
    }

    const ticketOrderItems = order.orderItems.filter(
        (item): item is typeof item & { ticketType: NonNullable<typeof item.ticketType>; ticketTypeId: string } =>
            item.ticketType !== null && item.ticketTypeId !== null
    )
    const orderForInvoicing = { ...order, orderItems: ticketOrderItems }

    if (order.status === "PAID" && order.tickets.length > 0) {
        await syncPaidOrderMetadata(order.id, {
            orderId,
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        })
        await syncServilexInvoices(prisma, orderForInvoicing)
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
            await syncServilexInvoices(tx, orderForInvoicing)
            return { alreadyPaid: true }
        }

        for (const item of ticketOrderItems) {
            const ticketType = item.ticketType
            const ticketTypeId = item.ticketTypeId
            const event = ticketType.event
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
                        isPackage: ticketType.isPackage,
                        packageDaysCount: ticketType.packageDaysCount,
                        validDays: ticketType.validDays,
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
                        ticketTypeId,
                        ticketCode,
                        attendeeName: attendeeFullName,
                        attendeeDni: attendee.dni || undefined,
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

            if (!cacheToInvalidate.has(ticketType.eventId)) {
                cacheToInvalidate.set(ticketType.eventId, new Set())
            }
            cacheToInvalidate.get(ticketType.eventId)?.add(ticketTypeId)
        }

        await syncServilexInvoices(tx, orderForInvoicing)

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

    if (ticketOrderItems.length > 0) {
        const firstTicketItem = ticketOrderItems[0]
        const eventTitle = firstTicketItem.ticketType.event.title || "Evento FDNDA"
        const eventId = firstTicketItem.ticketType.eventId
        const ticketCount = ticketOrderItems.reduce(
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
        await onTicketSold(eventId, firstTicketItem.ticketTypeId)
    }

    return { success: true }
}

// ==================== MERCH FULFILLMENT ====================

interface MerchSnapshot {
    productId?: string
    productName?: string
    category?: string
    zone?: string
    size?: string | null
    sku?: string
    imageUrl?: string | null
}

function readMerchSnapshot(value: Prisma.JsonValue | null | undefined): MerchSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as MerchSnapshot
}

interface FulfillMerchOrderArgs {
    order: Awaited<ReturnType<typeof loadOrderForMerchFulfillment>>
    orderId: string
    providerRef?: string
    providerResponse?: Prisma.InputJsonValue
    providerOrderNumber?: string
    providerTransactionId?: string
}

// type helper para inferir el shape del order ya cargado en fulfillPaidOrder
async function loadOrderForMerchFulfillment(orderId: string) {
    return prisma.order.findUnique({
        where: { id: orderId },
        include: {
            user: true,
            invoices: { select: { id: true, servilexGroupKey: true, status: true } },
            tickets: { select: { id: true } },
            orderItems: {
                include: {
                    ticketType: { include: { event: true } },
                    merchVariant: {
                        include: {
                            product: {
                                include: {
                                    servilexService: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    })
}

export async function fulfillMerchOrder({
    order,
    orderId,
    providerRef,
    providerResponse,
    providerOrderNumber,
    providerTransactionId,
}: FulfillMerchOrderArgs): Promise<FulfillOrderResult> {
    if (!order) {
        return { success: false, error: "Order not found" }
    }

    if (order.status === "PAID" && order.fulfillmentStatus && order.fulfillmentStatus !== "PENDING") {
        await syncPaidOrderMetadata(order.id, {
            orderId,
            providerRef,
            providerResponse,
            providerOrderNumber,
            providerTransactionId,
        })
        return { success: true, alreadyPaid: true }
    }

    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        return { success: false, error: "Order not payable" }
    }

    const merchItems = order.orderItems.filter(
        (item): item is typeof item & { merchVariant: NonNullable<typeof item.merchVariant>; merchVariantId: string } =>
            item.merchVariant !== null && item.merchVariantId !== null
    )

    if (merchItems.length === 0) {
        return { success: false, error: "Orden MERCH sin variantes" }
    }

    const updateData: Prisma.OrderUpdateManyMutationInput = {
        status: "PAID",
        fulfillmentStatus: "PENDING",
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

    const alreadyConfirmed = await prisma.$transaction(async (tx) => {
        // Marcar orden como PAID atómicamente. Si ya estaba PAID, saltamos el decremento.
        const transition = await tx.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: updateData,
        })

        if (transition.count === 0) {
            const current = await tx.order.findUnique({
                where: { id: order.id },
                select: { status: true },
            })
            if (!current) throw new Error("Order not found")
            if (current.status === "PAID") return true
            if (current.status === "CANCELLED" || current.status === "REFUNDED") {
                throw new Error("Order not payable")
            }
        }

        // Confirma stock: reserved -> sold (no decrementa "stock" porque eso refleja inventario físico bruto)
        for (const item of merchItems) {
            await tx.$queryRaw`
                UPDATE "merch_variants"
                SET "reserved" = GREATEST("reserved" - ${item.quantity}, 0),
                    "sold" = "sold" + ${item.quantity},
                    "updatedAt" = NOW()
                WHERE "id" = ${item.merchVariantId}
            `
        }

        await syncServilexInvoices(tx, order)

        return false
    })

    if (alreadyConfirmed) {
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

    // Email de confirmación (best-effort, no rompe si falla)
    try {
        const pickupEventTitle = order.pickupEventId
            ? await prisma.event
                .findUnique({ where: { id: order.pickupEventId }, select: { title: true } })
                .then((evt) => evt?.title ?? null)
            : null

        const emailItems: MerchOrderEmailItem[] = merchItems.map((item) => {
            const snapshot = readMerchSnapshot(item.merchSnapshot)
            return {
                productName: snapshot.productName || item.merchVariant.product.name,
                size: snapshot.size ?? item.merchVariant.size,
                zone: snapshot.zone ?? item.merchVariant.product.zone,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
            }
        })

        const subtotal = emailItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
        const shippingCost = order.shippingCost ? Number(order.shippingCost) : 0

        await sendMerchOrderConfirmationEmail({
            email: order.user.email,
            name: order.user.name,
            orderId: order.id,
            items: emailItems,
            subtotal,
            shippingCost,
            total: Number(order.totalAmount),
            deliveryMethod: order.deliveryMethod ?? "PICKUP_OFFICE",
            pickupEventTitle,
            shippingAddress: order.shippingAddress,
            shippingDistrito: order.shippingDistrito,
            shippingReference: order.shippingReference,
            shippingPhone: order.shippingPhone,
        })
    } catch (err) {
        console.error("Failed to send merch confirmation email:", err)
    }

    // TODO: emitir boleta Servilex desde MerchProduct.servilexService (PR 3)

    return { success: true }
}
