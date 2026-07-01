import ManualAttendancePanel from "@/components/attendance/ManualAttendancePanel"
import { getAttendanceEvents } from "@/lib/attendance-events"

export const dynamic = "force-dynamic"

// El layout /admin ya restringe a ADMIN. Este server component solo resuelve los
// eventos vigentes y monta el panel compartido.
export default async function AsistenciaManualPage() {
    const events = await getAttendanceEvents()
    return <ManualAttendancePanel events={events} />
}
