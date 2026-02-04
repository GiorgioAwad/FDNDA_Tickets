import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
export const runtime = "nodejs"

// GET /api/admin/courtesy/[batchId] - Get batch details with all tickets
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { batchId } = await params

        const batch = await prisma.courtesyBatch.findUnique({
            where: { id: batchId },
            include: {
                event: { select: { id: true, title: true, slug: true } },
                ticketType: { select: { id: true, name: true, price: true } },
                creator: { select: { name: true, email: true } },
                courtesyTickets: {
                    include: {
                        claimedBy: {
                            select: { name: true, email: true }
                        },
                        ticket: {
                            select: { 
                                id: true, 
                                attendeeName: true, 
                                attendeeDni: true,
                                status: true,
                                scans: {
                                    select: {
                                        scannedAt: true,
                                        date: true
                                    },
                                    orderBy: { scannedAt: "desc" as const },
                                    take: 1
                                }
                            }
                        }
                    }
                }
            }
        })

        if (!batch) {
            return NextResponse.json({ success: false, error: "Lote no encontrado" }, { status: 404 })
        }

        // Transform data for frontend
        interface ScanData {
            scannedAt: Date
            date: Date
        }
        
        const transformedBatch = {
            ...batch,
            createdByUser: batch.creator,
            courtesyTickets: batch.courtesyTickets.map(ct => ({
                ...ct,
                claimedByUser: ct.claimedBy,
                generatedTicket: ct.ticket ? {
                    ...ct.ticket,
                    scans: ct.ticket.scans.map((s: ScanData) => ({
                        scannedAt: s.scannedAt,
                        eventDay: null
                    }))
                } : null
            }))
        }

        return NextResponse.json({ success: true, data: transformedBatch })
    } catch (error) {
        console.error("Error fetching batch details:", error)
        return NextResponse.json({ success: false, error: "Error al obtener detalles" }, { status: 500 })
    }
}
