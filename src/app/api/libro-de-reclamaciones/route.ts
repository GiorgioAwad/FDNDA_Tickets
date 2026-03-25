import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { buildComplaintTicketNumber, sendComplaintBookEmails } from "@/lib/complaint-book"

export const runtime = "nodejs"

const complaintSchema = z
    .object({
        type: z.enum(["RECLAMO", "QUEJA"]),
        subjectType: z.enum(["PRODUCTO", "SERVICIO"]),
        consumerIsMinor: z.boolean().default(false),
        parentName: z.string().trim().max(120).optional().or(z.literal("")),
        customerName: z.string().trim().min(5).max(120),
        documentType: z.enum(["DNI", "CE", "PASAPORTE", "RUC", "OTRO"]),
        documentNumber: z.string().trim().min(5).max(20),
        email: z.string().trim().email().max(120),
        phone: z.string().trim().max(20).optional().or(z.literal("")),
        address: z.string().trim().min(8).max(180),
        orderId: z.string().trim().max(60).optional().or(z.literal("")),
        eventName: z.string().trim().max(160).optional().or(z.literal("")),
        subjectDescription: z.string().trim().min(5).max(180),
        amountClaimed: z.string().trim().max(20).optional().or(z.literal("")),
        detail: z.string().trim().min(20).max(3000),
        requestDetail: z.string().trim().min(10).max(2000),
        acceptedPolicy: z.literal(true),
    })
    .superRefine((value, ctx) => {
        if (value.consumerIsMinor && !value.parentName?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Debes ingresar el nombre del padre, madre o apoderado.",
                path: ["parentName"],
            })
        }

        if (value.amountClaimed) {
            const normalized = Number(value.amountClaimed)
            if (!Number.isFinite(normalized) || normalized < 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "El monto ingresado no es valido.",
                    path: ["amountClaimed"],
                })
            }
        }
    })

export async function POST(request: Request) {
    try {
        const user = await getCurrentUser()
        const body = await request.json()
        const parsed = complaintSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: parsed.error.issues[0]?.message || "Datos invalidos.",
                },
                { status: 400 }
            )
        }

        const data = parsed.data
        const ticketNumber = buildComplaintTicketNumber()
        const amountClaimed = data.amountClaimed ? Number(data.amountClaimed) : null

        const entry = await prisma.complaintBookEntry.create({
            data: {
                ticketNumber,
                userId: user?.id ?? null,
                type: data.type,
                subjectType: data.subjectType,
                consumerIsMinor: data.consumerIsMinor,
                parentName: data.parentName?.trim() || null,
                customerName: data.customerName,
                documentType: data.documentType,
                documentNumber: data.documentNumber,
                email: data.email,
                phone: data.phone?.trim() || null,
                address: data.address,
                orderId: data.orderId?.trim() || null,
                eventName: data.eventName?.trim() || null,
                subjectDescription: data.subjectDescription,
                amountClaimed,
                detail: data.detail,
                requestDetail: data.requestDetail,
                emailAcknowledgedAt: new Date(),
            },
        })

        await sendComplaintBookEmails({
            ticketNumber: entry.ticketNumber,
            customerName: entry.customerName,
            customerEmail: entry.email,
            type: entry.type,
            subjectDescription: entry.subjectDescription,
        })

        return NextResponse.json({
            success: true,
            data: {
                ticketNumber: entry.ticketNumber,
                createdAt: entry.createdAt,
            },
        })
    } catch (error) {
        console.error("Complaint book error:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo registrar tu solicitud." },
            { status: 500 }
        )
    }
}
