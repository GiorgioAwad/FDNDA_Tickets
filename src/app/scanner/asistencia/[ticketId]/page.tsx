import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, CalendarDays, UserRound } from "lucide-react"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const dateFormatter = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
})

const timeFormatter = new Intl.DateTimeFormat("es-PE", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Lima",
})

const present = (value: string | null | undefined) => value?.trim() || null

export default async function StaffAttendanceDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ ticketId: string }>
    searchParams: Promise<{ evento?: string }>
}) {
    const user = await getCurrentUser()
    if (!user || !hasRole(user.role, "STAFF")) redirect("/")

    const { ticketId } = await params
    const { evento } = await searchParams
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            ticketCode: true,
            attendeeName: true,
            event: { select: { title: true } },
            ticketType: { select: { name: true } },
            user: { select: { name: true } },
            order: {
                select: {
                    buyerName: true,
                    buyerEmail: true,
                    buyerDocType: true,
                    buyerDocNumber: true,
                    buyerPhone: true,
                    user: { select: { name: true, email: true, dni: true, phone: true } },
                },
            },
            scans: {
                where: { result: "VALID" },
                select: { id: true, date: true, scannedAt: true },
                orderBy: [{ date: "desc" }, { scannedAt: "desc" }],
            },
        },
    })
    if (!ticket) notFound()

    const buyerDocument = present(ticket.order.buyerDocNumber)
    const buyerFields = [
        { label: "Nombre", value: present(ticket.order.buyerName) ?? present(ticket.order.user.name), fromAccount: !present(ticket.order.buyerName) },
        { label: "Email", value: present(ticket.order.buyerEmail) ?? present(ticket.order.user.email), fromAccount: !present(ticket.order.buyerEmail) },
        {
            label: buyerDocument && ticket.order.buyerDocType === "6" ? "RUC" : "DNI",
            value: buyerDocument ?? present(ticket.order.user.dni),
            fromAccount: !buyerDocument,
        },
        { label: "Celular", value: present(ticket.order.buyerPhone) ?? present(ticket.order.user.phone), fromAccount: !present(ticket.order.buyerPhone) },
    ]

    const days = new Map<string, { id: string; scannedAt: Date }[]>()
    for (const scan of ticket.scans) {
        const date = scan.date.toISOString().slice(0, 10)
        const entries = days.get(date) ?? []
        entries.push({ id: scan.id, scannedAt: scan.scannedAt })
        days.set(date, entries)
    }

    const backHref = evento && /^[a-zA-Z0-9_-]+$/.test(evento)
        ? "/scanner/evento/" + evento
        : "/scanner/asistencia"

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-8">
            <div className="mx-auto max-w-3xl space-y-5">
                <Link
                    href={backHref}
                    className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                </Link>

                <header>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {ticket.attendeeName || ticket.user.name}
                    </h1>
                    <p className="mt-1 text-sm text-gray-600">
                        {ticket.event.title} · {ticket.ticketType.name} · Carnet {ticket.ticketCode}
                    </p>
                </header>

                <section aria-labelledby="buyer-heading" className="rounded-xl border border-gray-200 bg-white p-5">
                    <h2 id="buyer-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                        <UserRound className="h-5 w-5 text-blue-700" />
                        Datos del comprador
                    </h2>
                    <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        {buyerFields.map((field) => (
                            <div key={field.label} className="min-w-0">
                                <dt className="text-xs font-medium uppercase tracking-wide text-gray-600">{field.label}</dt>
                                <dd className="mt-1 break-words text-sm font-medium text-gray-900">{field.value ?? "No registrado"}</dd>
                            </div>
                        ))}
                    </dl>
                    {buyerFields.some((field) => field.fromAccount && field.value) && (
                        <p className="mt-4 text-xs text-gray-600">
                            Los datos que no figuran en la compra se muestran desde la cuenta asociada.
                        </p>
                    )}
                </section>

                <section aria-labelledby="attendance-heading" className="rounded-xl border border-gray-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 id="attendance-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                            <CalendarDays className="h-5 w-5 text-blue-700" />
                            Días asistidos
                        </h2>
                        <span className="text-sm font-medium tabular-nums text-gray-700">
                            {days.size} {days.size === 1 ? "día" : "días"} · {ticket.scans.length} {ticket.scans.length === 1 ? "ingreso" : "ingresos"}
                        </span>
                    </div>
                    {days.size === 0 ? (
                        <p className="mt-4 rounded-lg bg-gray-50 px-4 py-5 text-sm text-gray-700">
                            Todavía no hay asistencias registradas para este carnet.
                        </p>
                    ) : (
                        <ol className="mt-4 divide-y divide-gray-200">
                            {[...days].map(([date, entries]) => (
                                <li key={date} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                                    <span className="text-sm font-medium capitalize text-gray-900">
                                        {dateFormatter.format(new Date(date + "T12:00:00Z"))}
                                    </span>
                                    <span className="text-sm tabular-nums text-gray-700">
                                        {entries.map((entry) => timeFormatter.format(entry.scannedAt)).join(" · ")}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            </div>
        </main>
    )
}