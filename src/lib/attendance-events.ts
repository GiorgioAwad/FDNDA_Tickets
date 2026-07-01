import { prisma } from "@/lib/prisma"
import { getEventActiveThreshold } from "@/lib/utils"
import type { AttendanceEventOption } from "@/components/attendance/ManualAttendancePanel"

/**
 * Eventos vigentes para el panel de asistencia manual. Mismo criterio que el
 * escáner: se mantiene el evento hasta las 11:59pm hora Lima de su último día
 * (ver getEventActiveThreshold). Compartido por /admin/asistencia (ADMIN) y
 * /scanner/asistencia (STAFF).
 */
export async function getAttendanceEvents(): Promise<AttendanceEventOption[]> {
    const events = await prisma.event.findMany({
        where: { endDate: { gte: getEventActiveThreshold() } },
        orderBy: { startDate: "asc" },
        select: { id: true, title: true, startDate: true, endDate: true, category: true },
    })
    return events.map((event) => ({
        id: event.id,
        title: event.title,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
        category: event.category,
    }))
}
