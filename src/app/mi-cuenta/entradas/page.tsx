import { redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { TicketCardItem } from "@/components/tickets/TicketCardItem"
import { formatDate } from "@/lib/utils"
import {
    normalizeScheduleSelections,
    type ScheduleSelection,
} from "@/lib/ticket-schedule"
import { ArrowLeft, Sparkles, CheckCircle2 } from "lucide-react"

export const dynamic = "force-dynamic"

type RawAttendee = { name?: unknown; dni?: unknown; scheduleSelections?: unknown }

const normalizeKey = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : ""

const normalizeDni = (value: unknown) =>
    typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : ""

function findAttendeeSelections(
    attendees: unknown,
    name: string | null,
    dni: string | null
): ScheduleSelection[] {
    if (!Array.isArray(attendees)) return []
    const targetName = normalizeKey(name)
    const targetDni = normalizeDni(dni)

    let best: { score: number; selections: ScheduleSelection[] } | null = null
    for (const raw of attendees) {
        if (!raw || typeof raw !== "object") continue
        const record = raw as RawAttendee
        const candidateName = normalizeKey(record.name)
        const candidateDni = normalizeDni(record.dni)
        const selections = normalizeScheduleSelections(record.scheduleSelections)
        let score = selections.length > 0 ? 1 : 0
        if (targetDni && candidateDni && targetDni === candidateDni) score += 4
        if (targetName && candidateName && targetName === candidateName) score += 2
        if (!best || score > best.score) {
            best = { score, selections }
        }
    }

    return best?.selections ?? []
}

function formatScheduleLabel(selections: ScheduleSelection[]): string | null {
    if (selections.length === 0) return null
    const uniqueDates = Array.from(new Set(selections.map((s) => s.date))).sort()
    const shiftLabels = Array.from(
        new Set(
            selections
                .map((s) => (s.shift ?? "").replace(/\s*\(.*\)\s*$/, "").trim())
                .filter(Boolean)
        )
    )

    if (uniqueDates.length === 1) {
        const dayLabel = formatDate(uniqueDates[0], { dateStyle: "medium" })
        return shiftLabels.length > 0 ? `${dayLabel} · ${shiftLabels.join(" / ")}` : dayLabel
    }
    return shiftLabels.length > 0
        ? `${uniqueDates.length} días · ${shiftLabels.join(" / ")}`
        : `${uniqueDates.length} días`
}

function buildScheduleKey(selections: ScheduleSelection[]): string {
    if (selections.length === 0) return "no-schedule"
    return selections
        .map((s) => `${s.date}|${(s.shift ?? "").trim()}`)
        .sort()
        .join(";")
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
            order: {
                select: {
                    orderItems: {
                        select: { ticketTypeId: true, attendeeData: true },
                    },
                },
            },
            scans: {
                where: { result: "VALID" },
                select: { id: true },
                take: 1,
            },
        },
        orderBy: [
            { event: { startDate: "asc" } },
            { createdAt: "asc" },
        ],
    })

    const now = new Date().getTime()

    type EnrichedTicket = (typeof tickets)[number] & {
        scheduleKey: string
        scheduleLabel: string | null
        used: boolean
    }

    const enriched: EnrichedTicket[] = tickets.map((ticket) => {
        const matchingItem = ticket.order.orderItems.find(
            (item) => item.ticketTypeId === ticket.ticketTypeId
        )
        const selections = findAttendeeSelections(
            matchingItem?.attendeeData,
            ticket.attendeeName,
            ticket.attendeeDni
        )
        return {
            ...ticket,
            scheduleKey: buildScheduleKey(selections),
            scheduleLabel: formatScheduleLabel(selections),
            used: ticket.scans.length > 0,
        }
    })

    type TicketGroup = {
        key: string
        eventTitle: string
        scheduleLabel: string | null
        tickets: EnrichedTicket[]
    }

    const buildGroups = (items: EnrichedTicket[]): TicketGroup[] => {
        const groups = new Map<string, TicketGroup>()
        for (const ticket of items) {
            const key = `${ticket.eventId}::${ticket.scheduleKey}`
            const existing = groups.get(key)
            if (existing) {
                existing.tickets.push(ticket)
            } else {
                groups.set(key, {
                    key,
                    eventTitle: ticket.event.title,
                    scheduleLabel: ticket.scheduleLabel,
                    tickets: [ticket],
                })
            }
        }
        return Array.from(groups.values())
    }

    const upcomingGroups = buildGroups(
        enriched.filter((t) => t.event.endDate.getTime() >= now)
    )
    const pastGroups = buildGroups(
        enriched.filter((t) => t.event.endDate.getTime() < now)
    )
    const upcomingCount = upcomingGroups.reduce((sum, g) => sum + g.tickets.length, 0)
    const pastCount = pastGroups.reduce((sum, g) => sum + g.tickets.length, 0)

    const renderTicketCard = (
        ticket: EnrichedTicket,
        idx: number,
        isPast: boolean,
        total: number
    ) => {
        const isGrouped = total > 1
        return (
            <TicketCardItem
                key={ticket.id}
                id={ticket.id}
                status={ticket.status as "ACTIVE" | "CANCELLED" | "EXPIRED"}
                attendeeName={ticket.attendeeName}
                typeName={ticket.ticketType.name}
                eventTitle={ticket.event.title}
                eventStartDate={ticket.event.startDate}
                eventVenue={ticket.event.venue}
                discipline={ticket.event.discipline}
                bannerUrl={ticket.event.bannerUrl}
                isPast={isPast}
                index={idx}
                groupIndex={isGrouped ? idx + 1 : undefined}
                groupTotal={isGrouped ? total : undefined}
                used={ticket.used}
            />
        )
    }

    const renderMultiGroup = (group: TicketGroup, isPast: boolean) => {
        const total = group.tickets.length
        const usedCount = group.tickets.filter((t) => t.used).length

        return (
            <div
                key={group.key}
                className="rounded-2xl border border-border bg-card/40 p-4 sm:p-5 space-y-4"
            >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-coral">
                            {total} entradas en grupo
                        </p>
                        <h3 className="font-display text-base sm:text-lg font-bold">
                            {group.eventTitle}
                        </h3>
                        {group.scheduleLabel && (
                            <p className="text-xs sm:text-sm text-muted-foreground">
                                {group.scheduleLabel}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Usadas {usedCount}/{total}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">
                            Disponibles {total - usedCount}
                        </span>
                    </div>
                </div>
                <div className="-mx-4 sm:-mx-5">
                    <div className="overflow-x-auto overscroll-x-contain pb-2 px-4 sm:px-5 snap-x snap-proximity [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                        <div className="flex gap-4 sm:gap-5">
                            {group.tickets.map((ticket, idx) => (
                                <div
                                    key={ticket.id}
                                    className="snap-start shrink-0 w-[280px] sm:w-[300px] [content-visibility:auto] [contain-intrinsic-size:auto_360px]"
                                >
                                    {renderTicketCard(ticket, idx, isPast, total)}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    const renderSection = (groups: TicketGroup[], isPast: boolean) => {
        const singletons = groups.filter((g) => g.tickets.length === 1)
        const multis = groups.filter((g) => g.tickets.length > 1)

        return (
            <div className="space-y-6">
                {singletons.length > 0 && (
                    <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {singletons.map((group) =>
                            renderTicketCard(group.tickets[0], 0, isPast, 1)
                        )}
                    </div>
                )}
                {multis.map((group) => renderMultiGroup(group, isPast))}
            </div>
        )
    }

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
                                {tickets.length} {tickets.length === 1 ? "entrada" : "entradas"} en total · {upcomingCount} próximas
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
                        {upcomingCount > 0 && (
                            <section>
                                <div className="flex items-baseline gap-2 mb-4">
                                    <h2 className="font-display text-xl sm:text-2xl font-bold">Próximas</h2>
                                    <span className="text-xs font-semibold rounded-full bg-coral text-white px-2.5 py-0.5">{upcomingCount}</span>
                                </div>
                                {renderSection(upcomingGroups, false)}
                            </section>
                        )}

                        {pastCount > 0 && (
                            <section>
                                <div className="flex items-baseline gap-2 mb-4">
                                    <h2 className="font-display text-xl sm:text-2xl font-bold text-muted-foreground">Pasadas</h2>
                                    <span className="text-xs font-semibold rounded-full bg-muted text-muted-foreground px-2.5 py-0.5">{pastCount}</span>
                                </div>
                                <div className="opacity-80">{renderSection(pastGroups, true)}</div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
