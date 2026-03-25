import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { EventDashboard } from "@/components/admin/EventDashboard"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export const dynamic = "force-dynamic"

interface TreasuryEventDetailPageProps {
    params: Promise<{ id: string }>
}

export default async function TreasuryEventDetailPage({
    params,
}: TreasuryEventDetailPageProps) {
    const user = await getCurrentUser()

    if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
        redirect("/")
    }

    const { id } = await params
    const event = await prisma.event.findUnique({
        where: { id },
        include: {
            ticketTypes: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    })

    if (!event) {
        notFound()
    }

    return (
        <div className="space-y-6">
            <div>
                <Button variant="ghost" asChild className="-ml-3">
                    <Link href="/tesoreria/eventos">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver a eventos
                    </Link>
                </Button>
                <h2 className="text-2xl font-semibold text-gray-900">{event.title}</h2>
                <p className="text-sm text-gray-500">
                    Vista financiera del evento con exportes y desglose por tipo de entrada.
                </p>
            </div>

            <EventDashboard
                eventId={event.id}
                ticketTypes={event.ticketTypes.map((ticketType) => ({
                    id: ticketType.id,
                    name: ticketType.name,
                }))}
            />
        </div>
    )
}
