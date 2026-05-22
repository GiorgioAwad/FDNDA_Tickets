import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import type { TicketIssuanceOutcome } from "@prisma/client"

export interface TicketIssuanceLogInput {
    outcome: TicketIssuanceOutcome
    reason?: string | null
    ticketId?: string | null
    userId?: string | null
    eventId?: string | null
    qrDate?: string | null
    qrShift?: string | null
    requestedDate?: string | null
    request?: NextRequest
}

const truncate = (value: string | null | undefined, max: number): string | null => {
    if (!value) return null
    return value.length > max ? value.slice(0, max) : value
}

function extractClientIp(request?: NextRequest): string | null {
    if (!request) return null
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim()
        if (first) return first
    }
    return request.headers.get("x-real-ip") || null
}

/**
 * Persiste un log de emisión de QR. Nunca lanza: si la escritura falla,
 * se reporta a stderr para no romper la respuesta al usuario.
 */
export async function logTicketIssuance(input: TicketIssuanceLogInput): Promise<void> {
    try {
        await prisma.ticketIssuanceLog.create({
            data: {
                outcome: input.outcome,
                reason: truncate(input.reason ?? null, 1000),
                ticketId: input.ticketId ?? null,
                userId: input.userId ?? null,
                eventId: input.eventId ?? null,
                qrDate: input.qrDate ?? null,
                qrShift: input.qrShift ?? null,
                requestedDate: input.requestedDate ?? null,
                userAgent: truncate(input.request?.headers.get("user-agent") ?? null, 500),
                ipAddress: extractClientIp(input.request),
            },
        })
    } catch (err) {
        console.error("[ticket-issuance-log] failed to persist:", err)
    }
}
