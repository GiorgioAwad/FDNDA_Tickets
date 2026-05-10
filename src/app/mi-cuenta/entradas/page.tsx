import { redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { TicketCardItem } from "@/components/tickets/TicketCardItem"
import { ArrowLeft, Sparkles } from "lucide-react"

export const dynamic = "force-dynamic"

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
        },
        orderBy: [
            { event: { startDate: "asc" } },
            { createdAt: "desc" },
        ],
    })

    // eslint-disable-next-line react-hooks/purity -- server component, single render per request
    const now = new Date().getTime()
    const upcoming = tickets.filter((t) => t.event.endDate.getTime() >= now)
    const past = tickets.filter((t) => t.event.endDate.getTime() < now)

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            <div className="container mx-auto px-4 py-8 sm:py-12">
                <div className="flex flex-col gap-3 mb-6 sm:mb-8">
                    <Link href="/mi-cuenta" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Volver a mi cuenta
                    </Link>
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-coral mb-1">Mi colección</p>
                            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                                Mis <span className="text-gradient-coral">entradas</span>
                            </h1>
                            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                                {tickets.length} {tickets.length === 1 ? "entrada" : "entradas"} en total · {upcoming.length} próximas
                            </p>
                        </div>
                        <Link href="/eventos">
                            <Button variant="coral" className="rounded-full">
                                <Sparkles className="h-4 w-4" /> Comprar más
                            </Button>
                        </Link>
                    </div>
                </div>

                {tickets.length === 0 ? (
                    <EmptyState
                        variant="no-tickets"
                        title="Aún no tienes entradas"
                        description="Compra tu primera entrada y empieza a coleccionar experiencias acuáticas inolvidables."
                        action={{ label: "Explorar eventos", href: "/eventos", variant: "coral" }}
                    />
                ) : (
                    <div className="space-y-10">
                        {upcoming.length > 0 && (
                            <section>
                                <div className="flex items-baseline gap-2 mb-4">
                                    <h2 className="font-display text-xl sm:text-2xl font-bold">Próximas</h2>
                                    <span className="text-xs font-semibold rounded-full bg-coral text-white px-2.5 py-0.5">{upcoming.length}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    {upcoming.map((t, idx) => (
                                        <TicketCardItem
                                            key={t.id}
                                            id={t.id}
                                            status={t.status as "ACTIVE" | "CANCELLED" | "EXPIRED"}
                                            attendeeName={t.attendeeName}
                                            typeName={t.ticketType.name}
                                            eventTitle={t.event.title}
                                            eventStartDate={t.event.startDate}
                                            eventVenue={t.event.venue}
                                            discipline={t.event.discipline}
                                            bannerUrl={t.event.bannerUrl}
                                            isPast={false}
                                            index={idx}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {past.length > 0 && (
                            <section>
                                <div className="flex items-baseline gap-2 mb-4">
                                    <h2 className="font-display text-xl sm:text-2xl font-bold text-muted-foreground">Pasadas</h2>
                                    <span className="text-xs font-semibold rounded-full bg-muted text-muted-foreground px-2.5 py-0.5">{past.length}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 opacity-80">
                                    {past.map((t, idx) => (
                                        <TicketCardItem
                                            key={t.id}
                                            id={t.id}
                                            status={t.status as "ACTIVE" | "CANCELLED" | "EXPIRED"}
                                            attendeeName={t.attendeeName}
                                            typeName={t.ticketType.name}
                                            eventTitle={t.event.title}
                                            eventStartDate={t.event.startDate}
                                            eventVenue={t.event.venue}
                                            discipline={t.event.discipline}
                                            bannerUrl={t.event.bannerUrl}
                                            isPast={true}
                                            index={idx}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
