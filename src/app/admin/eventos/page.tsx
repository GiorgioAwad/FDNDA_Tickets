import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getTreasuryEventSummaries } from "@/lib/treasury"
import { formatDate, formatPrice, getEventActiveThreshold } from "@/lib/utils"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    CompletedEventsExportButton,
    type CompletedEventExportRow,
} from "@/components/treasury/CompletedEventsExportButton"
import {
    ArrowUpDown,
    Plus,
    MapPin,
    Ticket,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Eye,
    Search,
    Users,
    X,
} from "lucide-react"
import { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

type EventWithStats = {
    id: string
    title: string
    slug: string
    venue: string
    location: string
    bannerUrl: string | null
    startDate: Date
    endDate: Date
    mode: "RANGE" | "DAYS"
    category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    discipline: string | null
    isPublished: boolean
    _count: {
        tickets: number
        scans: number
    }
    ticketTypes: {
        id: string
        name: string
        price: Prisma.Decimal
        sold: number
        capacity: number
    }[]
}

type EventsSearchParams = {
    q?: string | string[]
    category?: string | string[]
    status?: string | string[]
    sort?: string | string[]
    pastPage?: string | string[]
}

const PAST_EVENTS_PER_PAGE = 6

function getSearchParam(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function buildEventsHref(
    params: { q: string; category: string; status: string; sort: string },
    pastPage: number
) {
    const searchParams = new URLSearchParams()

    if (params.q) searchParams.set('q', params.q)
    if (params.category !== 'all') searchParams.set('category', params.category)
    if (params.status !== 'all') searchParams.set('status', params.status)
    if (params.sort !== 'date_desc') searchParams.set('sort', params.sort)
    if (pastPage > 1) searchParams.set('pastPage', String(pastPage))

    const query = searchParams.toString()
    return `/admin/eventos${query ? `?${query}` : ''}#eventos-pasados`
}

function getCategoryLabel(category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA") {
    switch (category) {
        case "PISCINA_LIBRE":
            return "Piscina libre"
        case "ACADEMIA":
            return "Academia"
        default:
            return "Evento"
    }
}

export default async function AdminEventsPage({
    searchParams,
}: {
    searchParams: Promise<EventsSearchParams>
}) {
    const resolvedSearchParams = await searchParams
    const query = getSearchParam(resolvedSearchParams.q).trim()
    const normalizedQuery = query.toLocaleLowerCase('es-PE')
    const requestedCategory = getSearchParam(resolvedSearchParams.category)
    const category = ['EVENTO', 'PISCINA_LIBRE', 'ACADEMIA'].includes(requestedCategory)
        ? requestedCategory
        : 'all'
    const requestedStatus = getSearchParam(resolvedSearchParams.status)
    const status = ['ongoing', 'upcoming', 'past'].includes(requestedStatus)
        ? requestedStatus
        : 'all'
    const requestedSort = getSearchParam(resolvedSearchParams.sort)
    const sort = ['date_asc', 'title_asc'].includes(requestedSort)
        ? requestedSort
        : 'date_desc'
    const requestedPastPage = Number.parseInt(getSearchParam(resolvedSearchParams.pastPage), 10)

    const [events, financeSummaries, poolOccupancyRows] = await Promise.all([
        prisma.event.findMany({
            include: {
                _count: {
                    select: {
                        tickets: true,
                        scans: true,
                    },
                },
                ticketTypes: {
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        sold: true,
                        capacity: true,
                    },
                },
            },
            orderBy: { startDate: "desc" },
        }) as Promise<EventWithStats[]>,
        getTreasuryEventSummaries(),
        // Ocupacion real de piscina libre: por (horario, fecha), no el template base.
        prisma.$queryRaw<Array<{ eventId: string; cap: number | bigint; sold: number | bigint }>>(Prisma.sql`
            SELECT tt."eventId" AS "eventId",
                   COALESCE(SUM(inv."capacity"), 0) AS cap,
                   COALESCE(SUM(inv."sold"), 0) AS sold
            FROM "ticket_type_date_inventories" inv
            JOIN "ticket_types" tt ON tt."id" = inv."ticketTypeId"
            JOIN "events" e ON e."id" = tt."eventId"
            WHERE e."category" = 'PISCINA_LIBRE'
              AND inv."isEnabled" = true
              AND inv."capacity" > 0
            GROUP BY tt."eventId"
        `),
    ])

    // eventId -> ocupacion % real (null si no hay cupos configurados/limitados)
    const poolOccupancyByEvent = new Map<string, number>()
    for (const row of poolOccupancyRows) {
        const cap = Number(row.cap)
        const sold = Number(row.sold)
        if (cap > 0) {
            poolOccupancyByEvent.set(row.eventId, Math.round((sold / cap) * 100))
        }
    }

    const totalEvents = events.length
    const publishedEvents = events.filter((event) => event.isPublished).length
    const activeThreshold = getEventActiveThreshold()
    const activeEvents = events.filter((event) => new Date(event.endDate) >= activeThreshold && event.isPublished).length

    // Las tres secciones se clasifican contra el MISMO umbral (dia civil de Lima,
    // ver getEventActiveThreshold). Con `new Date()` un evento en su ultimo dia
    // dejaba de ser "en curso" a las 7am Lima pero todavia no era "pasado", asi
    // que no caia en ninguna seccion y desaparecia del listado.
    const matchesFilters = (event: EventWithStats) => {
        const matchesCategory = category === 'all' || event.category === category
        const searchableText = [event.title, event.discipline, event.venue, event.location]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('es-PE')

        return matchesCategory && (!normalizedQuery || searchableText.includes(normalizedQuery))
    }

    const sortEvents = (eventList: EventWithStats[]) =>
        [...eventList].sort((a, b) => {
            if (sort === 'title_asc') {
                return a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
            }

            const difference = a.startDate.getTime() - b.startDate.getTime()
            return sort === 'date_asc' ? difference : -difference
        })

    const filteredEvents = events.filter(matchesFilters)
    const upcomingEvents = sortEvents(
        filteredEvents.filter((event) => new Date(event.startDate) > activeThreshold)
    )
    const ongoingEvents = sortEvents(
        filteredEvents.filter(
            (event) =>
                new Date(event.startDate) <= activeThreshold &&
                new Date(event.endDate) >= activeThreshold
        )
    )
    const pastEvents = sortEvents(
        filteredEvents.filter((event) => new Date(event.endDate) < activeThreshold)
    )
    const visibleOngoingEvents = status === 'all' || status === 'ongoing' ? ongoingEvents : []
    const visibleUpcomingEvents = status === 'all' || status === 'upcoming' ? upcomingEvents : []
    const visiblePastEvents = status === 'all' || status === 'past' ? pastEvents : []
    const pastTotalPages = Math.max(1, Math.ceil(visiblePastEvents.length / PAST_EVENTS_PER_PAGE))
    const pastPage = Math.min(
        Math.max(Number.isFinite(requestedPastPage) ? requestedPastPage : 1, 1),
        pastTotalPages
    )
    const paginatedPastEvents = visiblePastEvents.slice(
        (pastPage - 1) * PAST_EVENTS_PER_PAGE,
        pastPage * PAST_EVENTS_PER_PAGE
    )
    const visibleEventCount =
        visibleOngoingEvents.length + visibleUpcomingEvents.length + visiblePastEvents.length
    const hasActiveFilters =
        Boolean(query) || category !== 'all' || status !== 'all' || sort !== 'date_desc'
    const navigationParams = { q: query, category, status, sort }

    const financeByEvent = new Map(
        financeSummaries.map((summary) => [summary.id, summary])
    )

    const completedExportRows: CompletedEventExportRow[] = financeSummaries
        .filter((event) => event.isCompleted)
        .map((event) => ({
            title: event.title,
            category: getCategoryLabel(event.category),
            venue: event.venue,
            location: event.location,
            startDate: formatDate(event.startDate),
            endDate: formatDate(event.endDate),
            totalOrders: event.totalOrders,
            ticketsSold: event.ticketsSold,
            grossRevenue: event.grossRevenue,
            commissionAmount: event.commissionAmount,
            advanceAmount: event.advanceAmount,
            depositedAmount: event.depositedAmount,
        }))

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-gray-500">Gestiona eventos, clasificacion comercial y resultados financieros.</p>
                </div>
                <Link href="/admin/eventos/nuevo">
                    <Button className="w-full gap-2 sm:w-auto">
                        <Plus className="h-4 w-4" />
                        Nuevo Evento
                    </Button>
                </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-blue-100 p-2">
                                <Calendar className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalEvents}</p>
                                <p className="text-xs text-gray-500">Total Eventos</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-green-100 p-2">
                                <Eye className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{publishedEvents}</p>
                                <p className="text-xs text-gray-500">Publicados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-orange-100 p-2">
                                <Ticket className="h-5 w-5 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{activeEvents}</p>
                                <p className="text-xs text-gray-500">Activos Ahora</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-purple-100 p-2">
                                <Users className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {events.reduce((acc, event) => acc + event._count.tickets, 0)}
                                </p>
                                <p className="text-xs text-gray-500">Entradas Totales</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className='p-4'>
                    <form
                        method='get'
                        className='grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.45fr)_minmax(10rem,0.45fr)_minmax(11rem,0.5fr)_auto] lg:items-end'
                    >
                        <label className='block'>
                            <span className='mb-1.5 block text-xs font-medium text-gray-600'>
                                Buscar evento
                            </span>
                            <span className='relative block'>
                                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400' />
                                <input
                                    type='search'
                                    name='q'
                                    defaultValue={query}
                                    placeholder='Nombre, disciplina o sede'
                                    className='h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20'
                                />
                            </span>
                        </label>

                        <label className='block'>
                            <span className='mb-1.5 block text-xs font-medium text-gray-600'>Estado</span>
                            <select
                                name='status'
                                defaultValue={status}
                                className='h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20'
                            >
                                <option value='all'>Todos</option>
                                <option value='ongoing'>En curso</option>
                                <option value='upcoming'>Próximos</option>
                                <option value='past'>Pasados</option>
                            </select>
                        </label>

                        <label className='block'>
                            <span className='mb-1.5 block text-xs font-medium text-gray-600'>Tipo</span>
                            <select
                                name='category'
                                defaultValue={category}
                                className='h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20'
                            >
                                <option value='all'>Todos</option>
                                <option value='EVENTO'>Eventos</option>
                                <option value='PISCINA_LIBRE'>Piscina libre</option>
                                <option value='ACADEMIA'>Academias</option>
                            </select>
                        </label>

                        <label className='block'>
                            <span className='mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600'>
                                <ArrowUpDown className='h-3.5 w-3.5' />
                                Ordenar por
                            </span>
                            <select
                                name='sort'
                                defaultValue={sort}
                                className='h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20'
                            >
                                <option value='date_desc'>Más recientes</option>
                                <option value='date_asc'>Más antiguos</option>
                                <option value='title_asc'>Nombre A–Z</option>
                            </select>
                        </label>

                        <Button type='submit' className='h-10'>Aplicar</Button>
                    </form>

                    <div className='mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3'>
                        <p className='text-sm text-gray-600' aria-live='polite'>
                            <span className='font-semibold text-gray-900'>{visibleEventCount}</span>{' '}
                            {visibleEventCount === 1 ? 'evento encontrado' : 'eventos encontrados'}
                        </p>
                        {hasActiveFilters && (
                            <Button asChild variant='ghost' size='sm' className='text-gray-600'>
                                <Link href='/admin/eventos'>
                                    <X className='h-4 w-4' />
                                    Limpiar filtros
                                </Link>
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {visibleOngoingEvents.length > 0 && (
                <div>
                    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        En Curso ({visibleOngoingEvents.length})
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {visibleOngoingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="ongoing" paidRevenue={financeByEvent.get(event.id)?.grossRevenue ?? 0} poolOccupancy={poolOccupancyByEvent.get(event.id) ?? null} />
                        ))}
                    </div>
                </div>
            )}

            {visibleUpcomingEvents.length > 0 && (
                <div>
                    <h2 className="mb-3 text-lg font-semibold">Próximos ({visibleUpcomingEvents.length})</h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {visibleUpcomingEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="upcoming" paidRevenue={financeByEvent.get(event.id)?.grossRevenue ?? 0} poolOccupancy={poolOccupancyByEvent.get(event.id) ?? null} />
                        ))}
                    </div>
                </div>
            )}

            {visiblePastEvents.length > 0 && (
                <div id="eventos-pasados" className="scroll-mt-6">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-700">
                                Pasados ({visiblePastEvents.length})
                            </h2>
                            <p className="text-sm text-gray-500">
                                Mostrando {Math.min((pastPage - 1) * PAST_EVENTS_PER_PAGE + 1, visiblePastEvents.length)}–{Math.min(pastPage * PAST_EVENTS_PER_PAGE, visiblePastEvents.length)}
                            </p>
                        </div>
                        {pastTotalPages > 1 && (
                            <p className="text-sm tabular-nums text-gray-500">
                                Página {pastPage} de {pastTotalPages}
                            </p>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {paginatedPastEvents.map((event) => (
                            <EventCard key={event.id} event={event} status="past" paidRevenue={financeByEvent.get(event.id)?.grossRevenue ?? 0} poolOccupancy={poolOccupancyByEvent.get(event.id) ?? null} />
                        ))}
                    </div>
                    {pastTotalPages > 1 && (
                        <nav
                            className="mt-4 flex items-center justify-end gap-2"
                            aria-label="Paginación de eventos pasados"
                        >
                            {pastPage > 1 ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={buildEventsHref(navigationParams, pastPage - 1)}>
                                        <ChevronLeft className="h-4 w-4" />
                                        Anterior
                                    </Link>
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" disabled>
                                    <ChevronLeft className="h-4 w-4" />
                                    Anterior
                                </Button>
                            )}
                            {pastPage < pastTotalPages ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={buildEventsHref(navigationParams, pastPage + 1)}>
                                        Siguiente
                                        <ChevronRight className="h-4 w-4" />
                                    </Link>
                                </Button>
                            ) : (
                                <Button variant="outline" size="sm" disabled>
                                    Siguiente
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            )}
                        </nav>
                    )}
                </div>
            )}

            {events.length > 0 && visibleEventCount === 0 && (
                <Card className="border-dashed p-10 text-center">
                    <Search className="mx-auto mb-3 h-9 w-9 text-gray-300" />
                    <h2 className="font-semibold text-gray-900">No encontramos eventos</h2>
                    <p className="mt-1 text-sm text-gray-500">
                        Prueba otro nombre o elimina alguno de los filtros.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-4">
                        <Link href="/admin/eventos">Limpiar filtros</Link>
                    </Button>
                </Card>
            )}

            <Card>
                <CardContent className="space-y-4 p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Eventos culminados para descarga</h2>
                            <p className="text-sm text-gray-500">
                                Incluye tipo, fecha de fin, recaudacion, comision + IGV, adelanto y monto depositado.
                            </p>
                        </div>
                        <CompletedEventsExportButton
                            rows={completedExportRows}
                            filenamePrefix="admin_eventos_culminados"
                        />
                    </div>

                    {completedExportRows.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                            No hay eventos culminados para exportar.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-medium">Evento</th>
                                        <th className="py-2 pr-4 font-medium">Tipo</th>
                                        <th className="py-2 pr-4 font-medium">Fecha fin</th>
                                        <th className="py-2 pr-4 font-medium">Recaudacion</th>
                                        <th className="py-2 pr-4 font-medium">Comision + IGV</th>
                                        <th className="py-2 pr-4 font-medium">Adelanto</th>
                                        <th className="py-2 pr-4 font-medium">Monto depositado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {completedExportRows.map((row) => (
                                        <tr key={`${row.title}-${row.endDate}`} className="border-b last:border-0">
                                            <td className="py-3 pr-4 font-medium text-gray-900">{row.title}</td>
                                            <td className="py-3 pr-4">{row.category}</td>
                                            <td className="py-3 pr-4 text-gray-600">{row.endDate}</td>
                                            <td className="py-3 pr-4 text-emerald-700">{formatPrice(row.grossRevenue)}</td>
                                            <td className="py-3 pr-4">{formatPrice(row.commissionAmount)}</td>
                                            <td className="py-3 pr-4">{formatPrice(row.advanceAmount)}</td>
                                            <td className="py-3 pr-4 font-medium text-gray-900">
                                                {formatPrice(row.depositedAmount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {events.length === 0 && (
                <Card className="p-12 text-center">
                    <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                    <h3 className="mb-2 text-lg font-medium text-gray-900">No hay eventos</h3>
                    <p className="mb-4 text-gray-500">Comienza creando tu primer evento</p>
                    <Link href="/admin/eventos/nuevo">
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Crear Evento
                        </Button>
                    </Link>
                </Card>
            )}
        </div>
    )
}

function EventCard({
    event,
    status,
    paidRevenue,
    poolOccupancy,
}: {
    event: EventWithStats
    status: "ongoing" | "upcoming" | "past"
    paidRevenue: number
    poolOccupancy?: number | null
}) {
    const totalRevenue = paidRevenue
    const isPoolFree = event.category === "PISCINA_LIBRE"
    const totalCapacity = event.ticketTypes.reduce(
        (acc, ticketType) => acc + (ticketType.capacity || 0),
        0
    )
    const totalSold = event.ticketTypes.reduce((acc, ticketType) => acc + ticketType.sold, 0)
    // Piscina libre: la capacidad real es por (horario, fecha), no el template base.
    // Usamos la ocupacion calculada desde los inventarios por fecha y, si no hay
    // cupos configurados/limitados, no mostramos la barra (evita el % fantasma).
    const showOccupancy = isPoolFree ? poolOccupancy != null : totalCapacity > 0
    const soldPercentage = isPoolFree
        ? poolOccupancy ?? 0
        : totalCapacity > 0
          ? Math.round((totalSold / totalCapacity) * 100)
          : 0

    return (
        <Link href={`/admin/eventos/${event.id}`}>
            <Card className={`h-full overflow-hidden transition-shadow hover:shadow-lg ${status === "past" ? "opacity-80" : ""}`}>
                <div className="relative h-32 bg-gradient-to-br from-blue-600 to-blue-700">
                    {event.bannerUrl ? (
                        <EventBannerMedia
                            src={event.bannerUrl}
                            alt={event.title}
                            className="object-cover"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Calendar className="h-12 w-12 text-white/30" />
                        </div>
                    )}
                    <div className="absolute left-2 top-2">
                        {status === "ongoing" && <Badge className="bg-green-500 text-white">En curso</Badge>}
                        {status === "upcoming" && event.isPublished && <Badge className="bg-blue-500 text-white">Publicado</Badge>}
                        {status === "upcoming" && !event.isPublished && <Badge variant="secondary">Borrador</Badge>}
                        {status === "past" && <Badge variant="outline" className="bg-white/90">Finalizado</Badge>}
                    </div>
                    <div className="absolute right-2 top-2">
                        <Badge variant="outline" className="bg-white/90 text-xs">
                            {getCategoryLabel(event.category)}
                        </Badge>
                    </div>
                </div>

                <CardContent className="p-4">
                    <h3 className="mb-1 line-clamp-1 font-semibold text-gray-900">{event.title}</h3>
                    <p className="mb-2 text-sm text-gray-500">{event.discipline || getCategoryLabel(event.category)}</p>
                    <p className="mb-3 flex items-center gap-1 text-sm text-gray-500">
                        <MapPin className="h-3 w-3" />
                        {event.venue}
                    </p>

                    <div className="mb-3 text-sm text-gray-600">
                        <p>Inicio: {formatDate(event.startDate)}</p>
                        <p>Fin: {formatDate(event.endDate)}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t pt-3">
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.tickets}</p>
                            <p className="text-xs text-gray-500">Entradas</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-900">{event._count.scans}</p>
                            <p className="text-xs text-gray-500">Escaneos</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-green-600">{formatPrice(totalRevenue)}</p>
                            <p className="text-xs text-gray-500">Ingresos</p>
                        </div>
                    </div>

                    {showOccupancy && (
                        <div className="mt-3">
                            <div className="mb-1 flex justify-between text-xs text-gray-500">
                                <span>Ocupacion</span>
                                <span>{soldPercentage}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${
                                        soldPercentage >= 90
                                            ? "bg-red-500"
                                            : soldPercentage >= 70
                                              ? "bg-orange-500"
                                              : "bg-green-500"
                                    }`}
                                    style={{ width: `${Math.min(soldPercentage, 100)}%` }}
                                />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </Link>
    )
}
