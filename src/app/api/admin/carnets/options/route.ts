import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { prisma } from "@/lib/prisma"
import { getTodayDateString } from "@/lib/qr"
import { usesTicketDateCapacity } from "@/lib/ticket-date-capacity"
import { parseDateOnly } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const includeEnded = new URL(request.url).searchParams.get("includeEnded") === "true"

        const events = await prisma.event.findMany({
            where: {
                // El dia se calcula en America/Lima, no en el UTC del contenedor.
                ...(includeEnded ? {} : { endDate: { gte: parseDateOnly(getTodayDateString()) } }),
            },
            select: {
                id: true,
                title: true,
                category: true,
                servilexSucursalCode: true,
                startDate: true,
                endDate: true,
                membershipStartFixed: true,
                membershipStartMin: true,
                membershipStartMax: true,
                ticketTypes: {
                    where: { isActive: true },
                    orderBy: { name: "asc" },
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        capacity: true,
                        sold: true,
                        monthlyClassLimit: true,
                        membershipDurationMonths: true,
                        membershipScheduleKey: true,
                        isPackage: true,
                        packageDaysCount: true,
                        capacityByDate: true,
                    },
                },
            },
            orderBy: { startDate: "desc" },
        })

        const data = events.map((event) => ({
            id: event.id,
            title: event.title,
            category: event.category,
            servilexSucursalCode: event.servilexSucursalCode,
            startDate: event.startDate.toISOString(),
            endDate: event.endDate.toISOString(),
            membershipStartFixed: iso(event.membershipStartFixed),
            membershipStartMin: iso(event.membershipStartMin),
            membershipStartMax: iso(event.membershipStartMax),
            ticketTypes: event.ticketTypes.map((tt) => ({
                id: tt.id,
                name: tt.name,
                price: Number(tt.price),
                capacity: tt.capacity,
                sold: tt.sold,
                monthlyClassLimit: tt.monthlyClassLimit,
                membershipDurationMonths: tt.membershipDurationMonths,
                isPackage: tt.isPackage,
                packageDaysCount: tt.packageDaysCount,
                capacityByDate: tt.capacityByDate,
                // Predicado unico de "este tipo de entrada usa cupo por fecha"
                // (piscina libre siempre, o EVENTO con capacityByDate=true). Se
                // calcula aca para que la UI no tenga que re-derivarlo.
                usesDateCapacity: usesTicketDateCapacity({
                    eventCategory: event.category,
                    capacityByDate: tt.capacityByDate,
                }),
                scheduleProfile: getMembershipScheduleProfile(
                    event.servilexSucursalCode,
                    tt.membershipScheduleKey
                ),
            })),
        }))

        return NextResponse.json({ success: true, data: { events: data } })
    } catch (error) {
        console.error("Error cargando opciones de carnets:", error)
        return NextResponse.json({ success: false, error: "Error al cargar opciones" }, { status: 500 })
    }
}
