import { NextRequest, NextResponse } from "next/server"
import { GET as getEventReport } from "../events/[id]/report/route"

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

    return getEventReport(request, {
        params: Promise.resolve({ id: eventId }),
    })
}
