import { NextRequest, NextResponse } from "next/server"
import { GET as getAttendeesExport } from "../events/[id]/attendees-export/route"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get("eventId")

    if (!eventId) {
        return NextResponse.json(
            { success: false, error: "Falta eventId" },
            { status: 400 }
        )
    }

    return getAttendeesExport(request, {
        params: Promise.resolve({ id: eventId }),
    })
}
