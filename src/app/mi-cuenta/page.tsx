import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/ui/kpi-card"
import { User, Mail, Ticket, ShoppingBag, Calendar, ArrowRight, BadgeCheck, AlertCircle, Sparkles } from "lucide-react"
import Link from "next/link"
import ProfileClient from "./ProfileClient"

export const dynamic = "force-dynamic"

export default async function MyAccountPage() {
    const user = await getCurrentUser()

    if (!user) {
        redirect("/login")
    }

    const [ticketCount, orderCount, attendedEvents, totalSpent, nextEvent] = await Promise.all([
        prisma.ticket.count({
            where: { userId: user.id, status: "ACTIVE" },
        }),
        prisma.order.count({
            where: { userId: user.id },
        }),
        prisma.ticket.count({
            where: {
                userId: user.id,
                event: { endDate: { lt: new Date() } },
            },
        }),
        prisma.order
            .aggregate({
                where: { userId: user.id, status: "PAID" },
                _sum: { totalAmount: true },
            })
            .then((res) => Number(res._sum.totalAmount ?? 0))
            .catch(() => 0),
        prisma.ticket
            .findFirst({
                where: { userId: user.id, status: "ACTIVE" },
                orderBy: { event: { startDate: "asc" } },
                include: { event: true },
            })
            .catch(() => null),
    ])

    const initials = (user.name ?? user.email ?? "U")
        .split(/\s+/)
        .map((part: string) => part.charAt(0).toUpperCase())
        .slice(0, 2)
        .join("")

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            {/* Profile header */}
            <section className="relative overflow-hidden bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white">
                <div className="absolute -top-32 right-1/4 h-72 w-72 rounded-full bg-fdnda-accent/30 blur-3xl" aria-hidden="true" />
                <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-coral/20 blur-3xl" aria-hidden="true" />
                <div className="relative container mx-auto px-4 py-10 sm:py-14">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                        <div className="relative shrink-0">
                            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-fdnda-accent to-coral blur opacity-60" aria-hidden="true" />
                            <div className="relative flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white font-display text-2xl sm:text-3xl font-bold ring-4 ring-white/30 shadow-2xl">
                                {initials}
                            </div>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold uppercase tracking-widest text-fdnda-accent mb-1">Mi cuenta</p>
                            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight truncate">
                                ¡Hola, {user.name?.split(" ")[0] ?? "atleta"}!
                            </h1>
                            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-white/80">
                                <span className="inline-flex items-center gap-1.5">
                                    <Mail className="h-3.5 w-3.5" />
                                    {user.email}
                                </span>
                                {user.emailVerified ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-success/20 ring-1 ring-success/40 px-2 py-0.5 text-xs font-semibold text-white">
                                        <BadgeCheck className="h-3 w-3" />
                                        Verificado
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-coral/20 ring-1 ring-coral/40 px-2 py-0.5 text-xs font-semibold text-white">
                                        <AlertCircle className="h-3 w-3" />
                                        Sin verificar
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link href="/mi-cuenta/entradas">
                                <Button variant="glass" size="sm" className="rounded-full">
                                    <Ticket className="h-4 w-4" /> Mis entradas
                                </Button>
                            </Link>
                            <Link href="/mi-cuenta/merch">
                                <Button variant="glass" size="sm" className="rounded-full">
                                    <ShoppingBag className="h-4 w-4" /> Mis pedidos
                                </Button>
                            </Link>
                            <Link href="/eventos">
                                <Button variant="coral" size="sm" className="rounded-full">
                                    <Sparkles className="h-4 w-4" /> Explorar eventos
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 py-8 sm:py-10 -mt-6 sm:-mt-8 relative z-10">
                {/* KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
                    <KpiCard
                        label="Entradas activas"
                        value={ticketCount}
                        icon={<Ticket />}
                        tone="primary"
                    />
                    <KpiCard
                        label="Eventos asistidos"
                        value={attendedEvents}
                        icon={<Calendar />}
                        tone="accent"
                    />
                    <KpiCard
                        label="Órdenes"
                        value={orderCount}
                        icon={<ShoppingBag />}
                        tone="coral"
                    />
                    <KpiCard
                        label="Total invertido"
                        value={totalSpent.toLocaleString("es-PE", { style: "currency", currency: "PEN" })}
                        icon={<ShoppingBag />}
                        tone="success"
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                    {/* Profile (main) */}
                    <div className="lg:col-span-2">
                        <ProfileClient
                            user={{
                                name: user.name ?? "",
                                email: user.email ?? "",
                                emailVerified: user.emailVerified ?? null,
                            }}
                        />
                    </div>

                    {/* Side: next event + quick actions */}
                    <div className="space-y-6">
                        {nextEvent && (
                            <Card className="overflow-hidden border-0 shadow-card-hover">
                                <div className="bg-gradient-to-br from-fdnda-primary to-fdnda-secondary p-5 text-white">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-fdnda-accent mb-2">
                                        Tu próximo evento
                                    </p>
                                    <h3 className="font-display text-xl font-bold leading-tight mb-1 line-clamp-2">
                                        {nextEvent.event.title}
                                    </h3>
                                    <p className="text-sm text-white/80 inline-flex items-center gap-1.5">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {nextEvent.event.startDate.toLocaleDateString("es-PE", {
                                            day: "2-digit",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                    </p>
                                </div>
                                <CardContent className="p-5">
                                    <Link href={`/mi-cuenta/entradas/${nextEvent.id}`}>
                                        <Button variant="coral" className="w-full rounded-xl group">
                                            Ver mi entrada
                                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        )}

                        <Card>
                            <CardHeader>
                                <CardTitle className="font-display flex items-center gap-2 text-lg">
                                    <Sparkles className="h-4 w-4 text-coral" />
                                    Acciones rápidas
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <Link href="/mi-cuenta/entradas" className="block">
                                    <button className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-fdnda-secondary hover:bg-fdnda-light/30">
                                        <div className="flex items-center gap-3">
                                            <Ticket className="h-4 w-4 text-fdnda-secondary" />
                                            <span className="text-sm font-medium">Ver mis entradas</span>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </Link>
                                <Link href="/mi-cuenta/merch" className="block">
                                    <button className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-fdnda-secondary hover:bg-fdnda-light/30">
                                        <div className="flex items-center gap-3">
                                            <ShoppingBag className="h-4 w-4 text-fdnda-secondary" />
                                            <span className="text-sm font-medium">Mis pedidos de merch</span>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </Link>
                                <Link href="/eventos" className="block">
                                    <button className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-fdnda-secondary hover:bg-fdnda-light/30">
                                        <div className="flex items-center gap-3">
                                            <Calendar className="h-4 w-4 text-fdnda-secondary" />
                                            <span className="text-sm font-medium">Buscar eventos</span>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </Link>
                                <Link href="/canjear" className="block">
                                    <button className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-coral hover:bg-coral-soft">
                                        <div className="flex items-center gap-3">
                                            <Sparkles className="h-4 w-4 text-coral" />
                                            <span className="text-sm font-medium">Canjear cortesía</span>
                                        </div>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </Link>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}
