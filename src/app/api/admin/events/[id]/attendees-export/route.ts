import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { generateSlug, formatDateInput, formatDateTimeForExport } from "@/lib/utils"
import { extractOrderPaymentDetails } from "@/lib/payment-details"
import * as XLSX from "xlsx"
export const runtime = "nodejs"

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
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
                ticketType: { select: { name: true } },
                order: {
                    select: {
                        id: true,
                        provider: true,
                        providerRef: true,
                        providerTransactionId: true,
                        providerResponse: true,
                        paidAt: true,
                        user: { select: { name: true, email: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        })

        const headers = [
            "event_id",
            "event_title",
            "event_start_date",
            "event_end_date",
            "event_location",
            "event_venue",
            "ticket_id",
            "ticket_code",
            "attendee_name",
            "attendee_dni",
            "ticket_type_name",
            "order_id",
            "order_provider",
            "order_payment_operation_number",
            "order_payment_method",
            "order_payment_method_raw",
            "order_payment_brand",
            "paid_at_local",
            "paid_at_utc",
            "buyer_name",
            "buyer_email",
        ]

        const rows = tickets.map((ticket) => {
            const paymentDetails = extractOrderPaymentDetails(ticket.order || {})

            return [
                event.id,
                event.title,
                formatDateInput(event.startDate),
                formatDateInput(event.endDate),
                event.location,
                event.venue,
                ticket.id,
                ticket.ticketCode,
                ticket.attendeeName || "",
                ticket.attendeeDni || "",
                ticket.ticketType?.name || "",
                ticket.order?.id || "",
                ticket.order?.provider || "",
                paymentDetails.operationNumber || "",
                paymentDetails.methodLabel || ticket.order?.provider || "",
                paymentDetails.methodCode || "",
                paymentDetails.brand || "",
                formatDateTimeForExport(ticket.order?.paidAt),
                ticket.order?.paidAt ? ticket.order.paidAt.toISOString() : "",
                ticket.order?.user?.name || "",
                ticket.order?.user?.email || "",
            ]
        })

        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
        XLSX.utils.book_append_sheet(workbook, sheet, "Asistentes")
        const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

        const safeName = generateSlug(event.slug || event.title || event.id) || event.id
        const filename = `asistentes-${safeName}.xlsx`

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename=\"${filename}\"`,
            },
        })
    } catch (error) {
        console.error("Error exporting attendees:", error)
        return NextResponse.json(
            { success: false, error: "Error al exportar asistentes" },
            { status: 500 }
        )
    }
}
