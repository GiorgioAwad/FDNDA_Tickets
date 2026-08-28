import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { sendPurchaseEmail } from "@/lib/email"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { reserveTicketTypeDateInventory } from "@/lib/ticket-date-inventory"
import { formatPrice, generateTicketCode, parseDateOnly } from "@/lib/utils"
import {
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
    if (!user) return { ok: false, errors: ["El usuario no existe."] }

    const ticketType = await prisma.ticketType.findUnique({
        where: { id: input.ticketTypeId },
        select: TICKET_TYPE_SELECT,
    })
    if (!ticketType) return { ok: false, errors: ["El tipo de entrada no existe."] }

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

    const dateInventory = isPoolFreeEventCategory(ticketType.event.category)
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
        // 1. Cupo global. Con forceCapacity el incremento va sin guard; sin el,
        //    el guard hace que dos emisiones simultaneas no pasen del tope.
        const ticketType = await tx.ticketType.findUniqueOrThrow({
            where: { id: plan.ticketTypeId },
            select: { capacity: true, name: true, eventId: true, event: { select: { category: true } } },
        })

        const capacityWhere =
            ticketType.capacity > 0 && !plan.forcedCapacity
                ? { sold: { lt: ticketType.capacity } }
                : {}
        const updated = await tx.ticketType.updateMany({
            where: { id: plan.ticketTypeId, isActive: true, ...capacityWhere },
            data: { sold: { increment: 1 } },
        })
        if (updated.count !== 1) {
            throw new Error(`No hay cupo para "${ticketType.name}".`)
        }

        // 2. Cupo por fecha (solo piscina libre).
        if (isPoolFreeEventCategory(ticketType.event.category) && plan.scheduleSelections.length > 0) {
            const dateKey = plan.scheduleSelections[0].date
            if (plan.forcedCapacity) {
                // Incremento sin guard, aqui y no en el helper del checkout.
                const bumped = await tx.ticketTypeDateInventory.updateMany({
                    where: { ticketTypeId: plan.ticketTypeId, date: parseDateOnly(dateKey) },
                    data: { sold: { increment: 1 } },
                })
                if (bumped.count === 0) {
                    throw new Error(`No hay inventario configurado para el ${dateKey}.`)
                }
            } else {
                await reserveTicketTypeDateInventory(tx, {
                    ticketTypeId: plan.ticketTypeId,
                    templateCapacity: 0,
                    reservations: new Map([[dateKey, 1]]),
                    ticketLabel: plan.ticketTypeName,
                    requireConfigured: true,
                })
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
                providerResponse: {
                    source: "admin-carnet-panel",
                    issuedByUserId: actor.id,
                    issuedByEmail: actor.email,
                    reason: plan.reason,
                    forcedCapacity: plan.forcedCapacity,
                    allowedExistingActive: plan.allowedExistingActive,
                    issuedAt: now.toISOString(),
                },
                paidAt: now,
                documentType: "BOLETA",
                buyerDocType: "1",
                buyerDocNumber: plan.attendeeDni,
                buyerName: plan.userName,
                buyerEmail: plan.userEmail,
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
