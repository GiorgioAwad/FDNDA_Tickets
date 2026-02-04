import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { formatDateInput, generateSlug } from "@/lib/utils"
import * as XLSX from "xlsx"
export const runtime = "nodejs"

function toIso(value: Date | null | undefined) {
    return value ? value.toISOString() : ""
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id: eventId } = await params
        const { searchParams } = new URL(request.url)
        const ticketTypeId = searchParams.get("ticketTypeId")

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: {
                id: true,
                title: true,
                slug: true,
                startDate: true,
                endDate: true,
                location: true,
                venue: true,
            },
        })

        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 404 }
            )
        }

        const tickets = await prisma.ticket.findMany({
            where: {
                eventId,
                order: { status: "PAID" },
                ...(ticketTypeId ? { ticketTypeId } : {}),
            },
            include: {
                order: {
                    select: {
                        id: true,
                        status: true,
                        totalAmount: true,
                        currency: true,
                        provider: true,
                        providerRef: true,
                        paidAt: true,
                        createdAt: true,
                        user: { select: { name: true, email: true } },
                        orderItems: {
                            select: {
                                ticketTypeId: true,
                                unitPrice: true,
                                quantity: true,
                                subtotal: true,
                            },
                        },
                    },
                },
                ticketType: {
                    select: { id: true, name: true, price: true, currency: true },
                },
            },
            orderBy: { createdAt: "asc" },
        })

        const headers = [
            "event_id",
            "event_title",
            "event_start_date",
            "event_end_date",
            "event_location",
            "event_venue",
            "order_id",
            "order_status",
            "order_total",
            "order_currency",
            "order_provider",
            "order_provider_ref",
            "order_paid_at",
            "order_created_at",
            "buyer_name",
            "buyer_email",
            "ticket_id",
            "ticket_code",
            "ticket_status",
            "ticket_created_at",
            "ticket_type_id",
            "ticket_type_name",
            "ticket_type_price",
            "ticket_type_currency",
            "order_item_unit_price",
            "order_item_subtotal",
            "attendee_name",
            "attendee_dni",
        ]

        const rows = tickets.map((ticket) => {
            const orderItem = ticket.order.orderItems.find(
                (item) => item.ticketTypeId === ticket.ticketTypeId
            )
            return [
                event.id,
                event.title,
                formatDateInput(event.startDate),
                formatDateInput(event.endDate),
                event.location,
                event.venue,
                ticket.order.id,
                ticket.order.status,
                Number(ticket.order.totalAmount),
                ticket.order.currency,
                ticket.order.provider,
                ticket.order.providerRef || "",
                toIso(ticket.order.paidAt),
                toIso(ticket.order.createdAt),
                ticket.order.user?.name || "",
                ticket.order.user?.email || "",
                ticket.id,
                ticket.ticketCode,
                ticket.status,
                toIso(ticket.createdAt),
                ticket.ticketTypeId,
                ticket.ticketType?.name || "",
                Number(ticket.ticketType?.price || 0),
                ticket.ticketType?.currency || "",
                orderItem ? Number(orderItem.unitPrice) : "",
                orderItem ? Number(orderItem.subtotal) : "",
                ticket.attendeeName || "",
                ticket.attendeeDni || "",
            ]
        })

        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
        XLSX.utils.book_append_sheet(workbook, sheet, "Reporte")
        const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

        const safeName = generateSlug(event.slug || event.title || event.id) || event.id
        const filename = `reporte-evento-${safeName}.xlsx`

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        })
    } catch (error) {
        console.error("Error exporting event report:", error)
        return NextResponse.json(
            { success: false, error: "Error al exportar reporte" },
            { status: 500 }
        )
    }
}
