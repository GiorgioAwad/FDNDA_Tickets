import { NextRequest, NextResponse } from "next/server"
import { GET as getEventExport } from "../events/[id]/export/route"

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

    return getEventExport(request, {
        params: Promise.resolve({ id: eventId }),
    })
}
