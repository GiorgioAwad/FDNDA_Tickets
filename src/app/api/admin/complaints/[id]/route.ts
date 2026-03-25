import { NextRequest, NextResponse } from "next/server"
import { ComplaintBookStatus } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { sendComplaintBookResolutionEmail } from "@/lib/complaint-book"

export const runtime = "nodejs"

const updateSchema = z.object({
    status: z.nativeEnum(ComplaintBookStatus),
    responseDetail: z.string().trim().max(3000).optional().or(z.literal("")),
})

function isPrivileged(role?: string) {
    return role === "ADMIN" || role === "TREASURY"
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !isPrivileged(user.role)) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params

        const entry = await prisma.complaintBookEntry.findUnique({
            where: { id },
            select: {
                id: true,
                ticketNumber: true,
                type: true,
                subjectType: true,
                consumerIsMinor: true,
                parentName: true,
                customerName: true,
                documentType: true,
                documentNumber: true,
                email: true,
                phone: true,
                address: true,
                orderId: true,
                eventName: true,
                subjectDescription: true,
                amountClaimed: true,
                detail: true,
                requestDetail: true,
                status: true,
                responseDetail: true,
                respondedAt: true,
                emailAcknowledgedAt: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        })

        if (!entry) {
            return NextResponse.json(
                { success: false, error: "Registro no encontrado." },
                { status: 404 }
            )
        }

        return NextResponse.json({ success: true, data: entry })
    } catch (error) {
        console.error("Error loading complaint book entry:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo cargar el registro." },
            { status: 500 }
        )
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !isPrivileged(user.role)) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params
        const body = await request.json()
        const parsed = updateSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: parsed.error.issues[0]?.message || "Datos invalidos.",
                },
                { status: 400 }
            )
        }

        const current = await prisma.complaintBookEntry.findUnique({
            where: { id },
            select: {
                id: true,
                ticketNumber: true,
                customerName: true,
                email: true,
                status: true,
                respondedAt: true,
                responseDetail: true,
            },
        })

        if (!current) {
            return NextResponse.json(
                { success: false, error: "Registro no encontrado." },
                { status: 404 }
            )
        }

        const responseDetail = parsed.data.responseDetail?.trim() || null
        const nextResponseDetail =
            responseDetail || (parsed.data.status === "RESPONDED" || parsed.data.status === "CLOSED"
                ? current.responseDetail
                : null)
        const requiresResponse =
            parsed.data.status === "RESPONDED" || parsed.data.status === "CLOSED"

        if (requiresResponse && !nextResponseDetail) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Debes registrar una respuesta antes de marcar el caso como respondido o cerrado.",
                },
                { status: 400 }
            )
        }

        const shouldMarkRespondedAt =
            requiresResponse && !current.respondedAt

        const updated = await prisma.complaintBookEntry.update({
            where: { id },
            data: {
                status: parsed.data.status,
                responseDetail: nextResponseDetail,
                ...(shouldMarkRespondedAt ? { respondedAt: new Date() } : {}),
            },
            select: {
                id: true,
                ticketNumber: true,
                type: true,
                status: true,
                customerName: true,
                email: true,
                subjectDescription: true,
                responseDetail: true,
                respondedAt: true,
                updatedAt: true,
            },
        })

        if (shouldMarkRespondedAt && updated.responseDetail) {
            await sendComplaintBookResolutionEmail({
                ticketNumber: updated.ticketNumber,
                customerName: updated.customerName,
                customerEmail: updated.email,
                status: parsed.data.status === "CLOSED" ? "CLOSED" : "RESPONDED",
                responseDetail: updated.responseDetail,
            })
        }

        return NextResponse.json({ success: true, data: updated })
    } catch (error) {
        console.error("Error updating complaint book entry:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo actualizar el registro." },
            { status: 500 }
        )
    }
}
