import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { getAttendanceEvents } from "@/lib/attendance-events"
import ManualAttendancePanel from "@/components/attendance/ManualAttendancePanel"

export const dynamic = "force-dynamic"

// Ruta de asistencia manual accesible por STAFF (no usa el layout /admin, que
// está restringido a ADMIN). Mismo panel compartido; los endpoints
// /api/scans/search y /api/scans/lookup ya aceptan STAFF.
export default async function ScannerAsistenciaPage() {
    const user = await getCurrentUser()
    if (!user || !hasRole(user.role, "STAFF")) {
        redirect("/")
    }

    const events = await getAttendanceEvents()

    return (
        <div className="min-h-screen bg-gray-50 py-6 sm:py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <Link
                    href="/scanner"
                    className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 mb-4"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver al escáner
                </Link>
                <ManualAttendancePanel events={events} />
            </div>
        </div>
    )
}
