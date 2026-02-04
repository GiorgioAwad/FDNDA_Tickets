import { redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatDate } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Ticket, Calendar, MapPin, QrCode } from "lucide-react"
export const dynamic = "force-dynamic"

type UserTicket = {
    id: string
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    attendeeName: string | null
    event: {
        title: string
        startDate: Date
        venue: string
    }
    ticketType: {
        name: string
    }
}

export default async function MyTicketsPage() {
    const user = await getCurrentUser()

    if (!user) {
        redirect("/login")
    }

    const tickets = await prisma.ticket.findMany({
        where: { userId: user.id },
        include: {
            event: true,
            ticketType: true,
            entitlements: {
                orderBy: { date: "asc" },
            },
        },
        orderBy: { createdAt: "desc" },
    }) as UserTicket[]

    return (
        <div className="container mx-auto px-4 py-12">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold">Mis Entradas</h1>
                <Link href="/eventos">
                    <Button variant="outline">Comprar más</Button>
                </Link>
            </div>

            {tickets.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {tickets.map((ticket: UserTicket) => (
                        <Card key={ticket.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                            <div className="relative h-32 bg-gradient-fdnda p-4 flex flex-col justify-between text-white">
                                <div className="flex justify-between items-start">
                                    <Badge className="bg-white/20 hover:bg-white/30 text-white border-0">
                                        {ticket.ticketType.name}
                                    </Badge>
                                    <Badge variant={ticket.status === "ACTIVE" ? "active" : "expired"}>
                                        {ticket.status === "ACTIVE" ? "Activo" : "Inactivo"}
                                    </Badge>
                                </div>
                                <h3 className="font-bold text-lg line-clamp-1">{ticket.event.title}</h3>
                            </div>

                            <CardContent className="p-5 space-y-4">
                                <div className="space-y-2 text-sm text-gray-600">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4 text-gray-400" />
                                        <span>{formatDate(ticket.event.startDate)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-gray-400" />
                                        <span className="line-clamp-1">{ticket.event.venue}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Ticket className="h-4 w-4 text-gray-400" />
                                        <span>Asistente: {ticket.attendeeName}</span>
                                    </div>
                                </div>

                                <Link href={`/mi-cuenta/entradas/${ticket.id}`} className="block">
                                    <Button className="w-full gap-2">
                                        <QrCode className="h-4 w-4" />
                                        Ver QR
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 bg-gray-50 rounded-xl">
                    <Ticket className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-xl font-semibold text-gray-600 mb-2">
                        No tienes entradas
                    </h3>
                    <p className="text-gray-500 mb-6">
                        Aún no has comprado entradas para ningún evento.
                    </p>
                    <Link href="/eventos">
                        <Button>Ver Eventos Disponibles</Button>
                    </Link>
                </div>
            )}
        </div>
    )
}

