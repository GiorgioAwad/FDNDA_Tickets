import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { formatDateInput, formatDateTimeForExport, generateSlug } from "@/lib/utils"
import { extractOrderPaymentDetails } from "@/lib/payment-details"
import { formatComprobanteLabel } from "@/lib/billing"
import {
    allocateAmountsProportionally,
    roundCurrency,
} from "@/lib/order-revenue"
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

        const orders = await prisma.order.findMany({
            where: {
                status: "PAID",
                orderItems: {
                    some: {
                        ticketType: { eventId },
                        ...(ticketTypeId ? { ticketTypeId } : {}),
                    },
                },
            },
            select: {
                id: true,
                status: true,
                totalAmount: true,
                currency: true,
                provider: true,
                providerRef: true,
                providerTransactionId: true,
                providerResponse: true,
                paidAt: true,
                createdAt: true,
                documentType: true,
                buyerName: true,
                buyerDocNumber: true,
                user: { select: { name: true, email: true } },
                orderItems: {
                    select: {
                        ticketTypeId: true,
                        unitPrice: true,
                        quantity: true,
                        subtotal: true,
                        ticketType: {
                            select: {
                                id: true,
                                eventId: true,
                                name: true,
                                price: true,
                                currency: true,
                            },
                        },
                    },
                },
            },
            orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
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
            "order_currency",
            "order_provider",
            "order_provider_ref",
            "comprobante",
            "buyer_doc_number",
            "buyer_billing_name",
            "order_payment_operation_number",
            "order_payment_method",
            "order_payment_method_raw",
            "order_payment_brand",
            "order_paid_at_date",
            "order_paid_at_local",
            "order_paid_at_utc",
            "order_created_at_local",
            "order_created_at_utc",
            "buyer_name",
            "buyer_email",
            "order_nominal_total",
            "order_discount_total",
            "order_charged_total",
            "ticket_type_id",
            "ticket_type_name",
            "ticket_type_price",
            "ticket_type_currency",
            "quantity",
            "nominal_subtotal",
            "allocated_discount",
            "collected_amount",
        ]

        const rows: Array<Array<string | number>> = []
        const summary = {
            orderIds: new Set<string>(),
            nominalAmount: 0,
            discountAmount: 0,
            collectedAmount: 0,
            quantity: 0,
        }

        orders.forEach((order) => {
            const orderNominalTotal = roundCurrency(
                order.orderItems.reduce((sum, item) => sum + Number(item.subtotal), 0)
            )
            const orderChargedTotal = Number(order.totalAmount)
            const orderDiscountTotal = roundCurrency(
                Math.max(0, orderNominalTotal - orderChargedTotal)
            )
            const allocatedAmounts = allocateAmountsProportionally(
                order.orderItems.map((item) => Number(item.subtotal)),
                orderChargedTotal
            )
            const groups = new Map<
                string,
                {
                    ticketType: NonNullable<(typeof order.orderItems)[number]["ticketType"]>
                    quantity: number
                    nominalSubtotal: number
                    collectedAmount: number
                }
            >()

            order.orderItems.forEach((item, index) => {
                if (
                    !item.ticketTypeId ||
                    !item.ticketType ||
                    item.ticketType.eventId !== eventId ||
                    (ticketTypeId && item.ticketTypeId !== ticketTypeId)
                ) {
                    return
                }

                const existing = groups.get(item.ticketTypeId) || {
                    ticketType: item.ticketType,
                    quantity: 0,
                    nominalSubtotal: 0,
                    collectedAmount: 0,
                }

                existing.quantity += item.quantity
                existing.nominalSubtotal += Number(item.subtotal)
                existing.collectedAmount += allocatedAmounts[index] || 0
                groups.set(item.ticketTypeId, existing)
            })

            const paymentDetails = extractOrderPaymentDetails(order)

            groups.forEach((group) => {
                const nominalSubtotal = roundCurrency(group.nominalSubtotal)
                const collectedAmount = roundCurrency(group.collectedAmount)
                const allocatedDiscount = roundCurrency(
                    Math.max(0, nominalSubtotal - collectedAmount)
                )

                summary.orderIds.add(order.id)
                summary.nominalAmount += nominalSubtotal
                summary.discountAmount += allocatedDiscount
                summary.collectedAmount += collectedAmount
                summary.quantity += group.quantity

                rows.push([
                    event.id,
                    event.title,
                    formatDateInput(event.startDate),
                    formatDateInput(event.endDate),
                    event.location,
                    event.venue,
                    order.id,
                    order.status,
                    order.currency,
                    order.provider,
                    order.providerRef || "",
                    formatComprobanteLabel(order.documentType, ""),
                    order.buyerDocNumber || "",
                    order.buyerName || "",
                    paymentDetails.operationNumber || "",
                    paymentDetails.methodLabel || order.provider,
                    paymentDetails.methodCode || "",
                    paymentDetails.brand || "",
                    formatDateTimeForExport(order.paidAt).slice(0, 10),
                    formatDateTimeForExport(order.paidAt),
                    toIso(order.paidAt),
                    formatDateTimeForExport(order.createdAt),
                    toIso(order.createdAt),
                    order.user?.name || "",
                    order.user?.email || "",
                    orderNominalTotal,
                    orderDiscountTotal,
                    orderChargedTotal,
                    group.ticketType.id,
                    group.ticketType.name,
                    Number(group.ticketType.price),
                    group.ticketType.currency,
                    group.quantity,
                    nominalSubtotal,
                    allocatedDiscount,
                    collectedAmount,
                ])
            })
        })

        const workbook = XLSX.utils.book_new()
        const summarySheet = XLSX.utils.aoa_to_sheet([
            ["Metrica", "Valor"],
            ["Evento", event.title],
            ["Ordenes pagadas", summary.orderIds.size],
            ["Entradas vendidas", summary.quantity],
            ["Monto nominal", roundCurrency(summary.nominalAmount)],
            ["Descuentos", roundCurrency(summary.discountAmount)],
            ["Monto cobrado", roundCurrency(summary.collectedAmount)],
        ])
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
        XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen")
        XLSX.utils.book_append_sheet(workbook, sheet, "Ordenes")
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
