import { redirect } from "next/navigation"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ScannerEventList from "./ScannerEventList"

export const dynamic = "force-dynamic"

type ScannerEvent = {
    id: string
    title: string
    startDate: Date
    venue: string
    discipline?: string | null
    isPublished: boolean
}

async function getStaffEvents() {
    return prisma.event.findMany({
        where: {
            endDate: { gte: new Date() },
        },
        orderBy: { startDate: "asc" },
    }) as Promise<ScannerEvent[]>
}

export default async function ScannerSelectionPage() {
    const user = await getCurrentUser()

    if (!user || !hasRole(user.role, "STAFF")) {
        redirect("/")
    }

    const events: ScannerEvent[] = await getStaffEvents()

    return <ScannerEventList events={JSON.parse(JSON.stringify(events))} />
}

