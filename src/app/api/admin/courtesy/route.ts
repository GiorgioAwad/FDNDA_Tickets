import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { randomBytes } from "crypto"
export const runtime = "nodejs"

// POST /api/admin/courtesy - Generate courtesy tickets
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { eventId, ticketTypeId, quantity, reason, email, assignedAttendees } = body

        // assignedAttendees es un array opcional: [{ name: "Juan Perez", dni: "12345678" }, ...]

        if (!eventId || !ticketTypeId || !quantity || !reason) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        // Validar que si hay asignados, la cantidad coincida
        if (assignedAttendees && assignedAttendees.length !== Number(quantity)) {
            return NextResponse.json(
                { success: false, error: "La cantidad de asignados debe coincidir con la cantidad de entradas" },
                { status: 400 }
            )
        }

        // 1. Create Courtesy Batch
        const batch = await prisma.courtesyBatch.create({
            data: {
                eventId,
                ticketTypeId,
                createdBy: user.id,
                quantity: Number(quantity),
                reason,
            },
        })

        // 2. Generate Tickets (if email provided, assign directly; else generate claim codes)
        const tickets = []

        if (email) {
            // Direct assignment to a user (must exist or we create a placeholder? Better require existing user or just send email invitation)
            // For simplicity, let's assume we generate a claim code that is sent to the email
            // OR we create a ticket with status "ACTIVE" if we know the user.

            // Let's implement "Claim Codes" approach as it's more flexible
            for (let i = 0; i < Number(quantity); i++) {
                const claimCode = randomBytes(4).toString("hex").toUpperCase()
                const assigned = assignedAttendees?.[i]

                // Create Courtesy Ticket record (pending claim)
                const courtesyTicket = await prisma.courtesyTicket.create({
                    data: {
                        batchId: batch.id,
                        claimCode,
                        status: "PENDING",
                        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                        assignedName: assigned?.name || null,
                        assignedDni: assigned?.dni || null,
                    },
                })
                tickets.push(courtesyTicket)
            }

            // TODO: Send email with codes
        } else {
            // Just generate codes to display
            for (let i = 0; i < Number(quantity); i++) {
                const claimCode = randomBytes(4).toString("hex").toUpperCase()
                const assigned = assignedAttendees?.[i]

                const courtesyTicket = await prisma.courtesyTicket.create({
                    data: {
                        batchId: batch.id,
                        claimCode,
                        status: "PENDING",
                        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        assignedName: assigned?.name || null,
                        assignedDni: assigned?.dni || null,
                    },
                })
                tickets.push(courtesyTicket)
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                batch,
                tickets,
            },
        })
    } catch (error) {
        console.error("Error generating courtesy tickets:", error)
        return NextResponse.json(
            { success: false, error: "Error al generar cortesías" },
            { status: 500 }
        )
    }
}

// GET /api/admin/courtesy - List batches
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const batches = await prisma.courtesyBatch.findMany({
            include: {
                event: { select: { title: true } },
                ticketType: { select: { name: true } },
                _count: { select: { courtesyTickets: true } }
            },
            orderBy: { createdAt: "desc" }
        })

        return NextResponse.json({ success: true, data: batches })
    } catch (error) {
        console.error("Error fetching courtesy batches:", error)
        return NextResponse.json({ success: false, error: "Error" }, { status: 500 })
    }
}

