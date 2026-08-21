import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import {
    membershipChangeInclude,
    ticketTypeSnapshotSelect,
    toChangeSnapshot,
    toScanTicket,
    toTicketTypeSnapshot,
} from "@/lib/membership-admin-snapshot"
import {
    formatScheduleSummary,
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    scheduleSelectionToInput,
} from "@/lib/membership-schedule"
import { getAttendeeMatricula } from "@/lib/membership-transfer"
import { prisma } from "@/lib/prisma"
import { formatDateUTC, getTodayDateString } from "@/lib/qr"
import {
    buildAttendanceSummary,
    getEffectiveScheduleSelection,
    getMembershipAccessStatus,
    getMembershipAnchor,
    getMembershipPeriod,
} from "@/lib/scan-helpers"
import { getAcMatriculaFromGroupKey } from "@/lib/servilex-invoice-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN
}

/** Providers cuya venta no emite boleta (ver membership-transfer.ts). */
const PROVIDERS_SIN_BOLETA = new Set(["PRESENCIAL", "COURTESY"])

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params

        const record = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: membershipChangeInclude,
        })
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }

        // Mismo criterio que el listado (api/admin/memberships/route.ts): sin
        // cupo mensual ni duracion, el ticket no es un carnet de membresia. Sin
        // este filtro, una entrada comun de evento entra igual y candidateTypes
        // termina sugiriendo "cambios de sede" sin sentido.
        const isMembership =
            (record.ticketType.monthlyClassLimit ?? 0) > 0 &&
            (record.ticketType.membershipDurationMonths ?? 0) > 0
        if (!isMembership) {
            return NextResponse.json(
                { success: false, error: "Este ticket no es un carnet de membresia" },
                { status: 404 }
            )
        }

        const today = getTodayDateString()

        // El diagnostico corre la MISMA logica que la puerta: lo que se ve aqui
        // es lo que le pasa al alumno al escanear.
        const scanTicket = toScanTicket({
            id: record.id,
            orderId: record.orderId,
            ticketTypeId: record.ticketTypeId,
            ticketCode: record.ticketCode,
            attendeeName: record.attendeeName,
            attendeeDni: record.attendeeDni,
            status: record.status,
            eventId: record.eventId,
            membershipStartDate: record.membershipStartDate,
            membershipSchedule: record.membershipSchedule,
            monthlySchedules: record.monthlySchedules,
            membershipFreeze: record.membershipFreeze,
            event: {
                title: record.event.title,
                startDate: record.event.startDate,
                endDate: record.event.endDate,
                membershipStartFixed: record.event.membershipStartFixed,
            },
            ticketType: {
                name: record.ticketType.name,
                isPackage: record.ticketType.isPackage,
                monthlyClassLimit: record.ticketType.monthlyClassLimit,
                membershipDurationMonths: record.ticketType.membershipDurationMonths,
                membershipScheduleKey: record.ticketType.membershipScheduleKey,
            },
            entitlements: record.entitlements,
        })

        const access = getMembershipAccessStatus(scanTicket, today)
        const attendance = buildAttendanceSummary(scanTicket, today)
        const anchor = getMembershipAnchor(scanTicket)
        const period = anchor ? getMembershipPeriod(today, anchor) : null
        // getEffectiveScheduleSelection recibe el indice de mes (0-based desde
        // el ancla), no la fecha de hoy: fuera de vigencia (sin periodo) cae al
        // mes 0, que es el horario de checkout.
        const effective = getEffectiveScheduleSelection(scanTicket, period?.index ?? 0)
        const sucursalCode = record.ticketType.event.servilexSucursalCode
        const profile = getMembershipScheduleProfile(
            sucursalCode,
            record.ticketType.membershipScheduleKey
        )

        const snapshot = toChangeSnapshot(record)
        const matricula = snapshot ? getAttendeeMatricula(snapshot.orderItem.attendeeData) : null
        const provider = record.order.provider.trim().toUpperCase()
        // En una orden familiar (varios asistentes) puede haber varias boletas:
        // cruzar por matricula para no mostrarle a este carnet el numero de
        // boleta de OTRO alumno de la misma orden. getAcMatriculaFromGroupKey
        // devuelve en MAYUSCULAS.
        const issuedInvoice = matricula
            ? record.order.invoices.find(
                  (invoice) =>
                      invoice.status === "ISSUED" &&
                      getAcMatriculaFromGroupKey(invoice.servilexGroupKey) === matricula.toUpperCase()
              )
            : undefined

        // Destinos posibles: mismo evento (franja = tipo, VMT) y otros eventos
        // de membresia (cambio de sede). La equivalencia la valida el
        // planificador; aqui se listan candidatos para que la UI no ofrezca
        // basura.
        const candidateTypes = await prisma.ticketType.findMany({
            where: {
                id: { not: record.ticketTypeId },
                isActive: true,
                monthlyClassLimit: record.ticketType.monthlyClassLimit,
                membershipDurationMonths: record.ticketType.membershipDurationMonths,
                isPackage: record.ticketType.isPackage,
                membershipScheduleKey: record.ticketType.membershipScheduleKey,
                price: record.ticketType.price,
            },
            select: ticketTypeSnapshotSelect,
            orderBy: [{ event: { title: "asc" } }, { name: "asc" }],
        })

        const history = await prisma.membershipAdminChange.findMany({
            where: { ticketId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                kind: true,
                reason: true,
                before: true,
                after: true,
                createdAt: true,
                actor: { select: { name: true, email: true } },
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                ticket: {
                    id: record.id,
                    ticketCode: record.ticketCode,
                    status: record.status,
                    attendeeName: record.attendeeName,
                    attendeeDni: record.attendeeDni,
                    matricula,
                    membershipStartDate: record.membershipStartDate
                        ? formatDateUTC(record.membershipStartDate)
                        : null,
                    user: record.user,
                },
                event: {
                    id: record.event.id,
                    title: record.event.title,
                    sucursalCode,
                },
                ticketType: toTicketTypeSnapshot(record.ticketType),
                order: {
                    id: record.order.id,
                    status: record.order.status,
                    provider: record.order.provider,
                    totalAmount: Number(record.order.totalAmount),
                    buyerName: record.order.buyerName,
                    // En venta presencial y cortesia NO se emite boleta: se
                    // informa como dato plano, nunca como comprobante faltante.
                    invoicing: PROVIDERS_SIN_BOLETA.has(provider)
                        ? { kind: "sin_boleta" as const, label: "Venta presencial · sin boleta" }
                        : {
                              kind: "boleta" as const,
                              invoiceNumber: issuedInvoice?.invoiceNumber ?? null,
                          },
                },
                diagnosis: {
                    today,
                    accessStatus: access.status,
                    startStr: access.startStr,
                    expiryStr: access.expiryStr,
                    frozenMonth: record.membershipFreeze?.month ?? null,
                    monthIndex: period?.index ?? null,
                    periodStart: period?.startStr ?? null,
                    periodEnd: period?.endStr ?? null,
                    attendance,
                    effectiveSchedule: effective,
                    effectiveScheduleSummary: formatScheduleSummary(effective),
                    baseScheduleSummary: formatScheduleSummary(
                        parseMembershipScheduleSelection(record.membershipSchedule)
                    ),
                    monthlyScheduleCount: record.monthlySchedules.length,
                },
                scheduleProfile: profile,
                currentScheduleInput: scheduleSelectionToInput(
                    parseMembershipScheduleSelection(record.membershipSchedule)
                ),
                candidateTypes: candidateTypes.map((type) => ({
                    ...toTicketTypeSnapshot(type),
                    eventTitle: type.event.title,
                    sameEvent: type.eventId === record.eventId,
                })),
                history,
            },
        })
    } catch (error) {
        console.error("Error al cargar la ficha de membresia:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
