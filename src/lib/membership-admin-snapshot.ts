/**
 * Puente entre Prisma y los modulos puros de correccion de membresias.
 *
 * Vive aparte de las rutas porque las tres (ficha, horario, transfer) leen
 * EXACTAMENTE la misma forma: si el include y el mapeo divergen, la vista previa
 * y la escritura dejarian de mirar lo mismo.
 *
 * `toScanTicket` tambien vive aqui, no repetida en cada ruta: la ficha (Task 5,
 * con orden y entitlements reales) y el endpoint de horario (Task 8, sin orden
 * ni entitlements) necesitan correr EXACTAMENTE la misma logica de diagnostico
 * que el escaner (@/lib/scan-helpers). Si cada ruta arma su propio objeto
 * literal, un campo que se ajuste en una queda desincronizado en la otra.
 */
import { Prisma } from "@prisma/client"

import type {
    MembershipChangeSnapshot,
    MembershipTicketTypeSnapshot,
} from "@/lib/membership-transfer"
import type { ScanTicket, TicketEntitlement } from "@/lib/scan-helpers"

export const ticketTypeSnapshotSelect = {
    id: true,
    eventId: true,
    name: true,
    price: true,
    capacity: true,
    sold: true,
    isActive: true,
    isPackage: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    event: { select: { id: true, title: true, servilexSucursalCode: true } },
} satisfies Prisma.TicketTypeSelect

export type TicketTypeSnapshotRecord = Prisma.TicketTypeGetPayload<{
    select: typeof ticketTypeSnapshotSelect
}>

/** Cuantos escaneos recientes trae la ficha del carnet. */
export const MEMBERSHIP_RECENT_SCANS_LIMIT = 15

export const membershipChangeInclude = {
    ticketType: { select: ticketTypeSnapshotSelect },
    event: {
        select: {
            id: true,
            title: true,
            servilexSucursalCode: true,
            startDate: true,
            endDate: true,
            membershipStartFixed: true,
        },
    },
    order: {
        select: {
            id: true,
            status: true,
            provider: true,
            totalAmount: true,
            buyerName: true,
            buyerDocNumber: true,
            // El campo Prisma se llama `orderItems`, no `items`.
            orderItems: {
                select: { id: true, ticketTypeId: true, attendeeData: true, quantity: true, unitPrice: true },
            },
            invoices: {
                select: { id: true, status: true, servilexGroupKey: true, invoiceNumber: true },
            },
        },
    },
    monthlySchedules: { select: { monthIndex: true, selection: true } },
    membershipFreeze: { select: { month: true, startDate: true, endDate: true } },
    // Sin `shift`: TicketDayEntitlement no tiene esa columna. El horario del
    // carnet vive en Ticket.membershipSchedule, no por entitlement.
    entitlements: { select: { date: true, status: true } },
    // Ultimos escaneos con su resultado: es la unica evidencia de que le pasa
    // al carnet en la puerta de verdad, y la ficha la muestra al lado del
    // diagnostico. Acotado a MEMBERSHIP_RECENT_SCANS_LIMIT: el historico
    // completo de una membresia anual no cabe ni le sirve al admin.
    scans: {
        select: { id: true, scannedAt: true, result: true, notes: true },
        orderBy: { scannedAt: "desc" },
        take: MEMBERSHIP_RECENT_SCANS_LIMIT,
    },
    user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TicketInclude

export type MembershipChangeRecord = Prisma.TicketGetPayload<{
    include: typeof membershipChangeInclude
}>

export function toTicketTypeSnapshot(
    record: TicketTypeSnapshotRecord
): MembershipTicketTypeSnapshot {
    return {
        id: record.id,
        eventId: record.eventId,
        sucursalCode: record.event.servilexSucursalCode,
        name: record.name,
        // Decimal(10,2) de Prisma: sin este Number() las comparaciones de
        // equivalencia del planificador compararian referencias y bloquearian
        // todo cambio de sede.
        price: Number(record.price),
        capacity: record.capacity,
        sold: record.sold,
        isActive: record.isActive,
        isPackage: record.isPackage,
        monthlyClassLimit: record.monthlyClassLimit,
        membershipDurationMonths: record.membershipDurationMonths,
        membershipScheduleKey: record.membershipScheduleKey,
    }
}

/**
 * El OrderItem del carnet. Una orden puede traer varios items; el del carnet es
 * el que apunta a su mismo ticketTypeId. Devuelve null si no se puede
 * identificar sin ambiguedad — el planificador lo reportara como bloqueo.
 */
export function findMembershipOrderItem(record: MembershipChangeRecord) {
    const matches = record.order.orderItems.filter((item) => item.ticketTypeId === record.ticketTypeId)
    return matches.length === 1 ? matches[0] : null
}

export function toChangeSnapshot(record: MembershipChangeRecord): MembershipChangeSnapshot | null {
    const orderItem = findMembershipOrderItem(record)
    if (!orderItem) return null
    return {
        ticket: {
            id: record.id,
            status: record.status,
            eventId: record.eventId,
            ticketTypeId: record.ticketTypeId,
            membershipSchedule: record.membershipSchedule,
            monthlyScheduleCount: record.monthlySchedules.length,
        },
        order: {
            id: record.order.id,
            status: record.order.status,
            provider: record.order.provider,
            invoices: record.order.invoices.map((invoice) => ({
                id: invoice.id,
                status: invoice.status,
                servilexGroupKey: invoice.servilexGroupKey,
                invoiceNumber: invoice.invoiceNumber,
            })),
        },
        orderItem: {
            id: orderItem.id,
            // OrderItem.ticketTypeId es nullable en el schema, pero
            // findMembershipOrderItem ya filtro por igualdad con
            // record.ticketTypeId (string): el fallback nunca se usa, solo
            // estrecha el tipo para MembershipChangeSnapshot.
            ticketTypeId: orderItem.ticketTypeId ?? record.ticketTypeId,
            attendeeData: orderItem.attendeeData,
        },
        sourceType: toTicketTypeSnapshot(record.ticketType),
    }
}

/**
 * Adaptador Prisma → ScanTicket: el diagnostico de un carnet corre la MISMA
 * logica que la puerta (@/lib/scan-helpers). Compartido por la ficha (con orden
 * y entitlements) y por el endpoint de horario (sin ninguno de los dos, pasa
 * `entitlements: []`) para que ambos vean exactamente lo mismo que el escaner.
 */
export function toScanTicket(args: {
    id: string
    orderId?: string
    ticketTypeId: string
    ticketCode?: string
    attendeeName?: string | null
    attendeeDni?: string | null
    status: string
    eventId: string
    membershipStartDate: Date | null
    membershipSchedule: unknown
    monthlySchedules: Array<{ monthIndex: number; selection: unknown }>
    membershipFreeze: { month: string; startDate: Date; endDate: Date } | null
    event: { title: string; startDate: Date; endDate: Date; membershipStartFixed: Date | null }
    ticketType: {
        name: string
        isPackage: boolean
        monthlyClassLimit: number | null
        membershipDurationMonths: number | null
        membershipScheduleKey: string | null
    }
    entitlements: Array<{ date: Date; status: string }>
}): ScanTicket {
    return {
        id: args.id,
        orderId: args.orderId ?? "",
        ticketTypeId: args.ticketTypeId,
        ticketCode: args.ticketCode ?? "",
        attendeeName: args.attendeeName ?? null,
        attendeeDni: args.attendeeDni ?? null,
        status: args.status as ScanTicket["status"],
        eventId: args.eventId,
        membershipStartDate: args.membershipStartDate,
        membershipSchedule: args.membershipSchedule,
        monthlySchedules: args.monthlySchedules,
        membershipFreeze: args.membershipFreeze,
        event: {
            title: args.event.title,
            startDate: args.event.startDate,
            endDate: args.event.endDate,
            membershipStartFixed: args.event.membershipStartFixed,
        },
        ticketType: {
            name: args.ticketType.name,
            isPackage: args.ticketType.isPackage,
            // Ninguno de los dos llamadores tiene estos dos campos: la ficha y
            // el endpoint de horario son membresias, no paquetes/entradas de
            // dias sueltos.
            packageDaysCount: null,
            monthlyClassLimit: args.ticketType.monthlyClassLimit,
            membershipDurationMonths: args.ticketType.membershipDurationMonths,
            membershipScheduleKey: args.ticketType.membershipScheduleKey,
            validDays: null,
        },
        entitlements: args.entitlements.map(
            (item, index): TicketEntitlement => ({
                // Sintetico: ningun llamador tiene el id real ni lo necesita —
                // scan-helpers solo lee date/status para el diagnostico.
                id: `${args.id}-entitlement-${index}`,
                date: item.date,
                status: item.status as TicketEntitlement["status"],
                usedAt: null,
            })
        ),
    }
}
