import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import slugify from "slugify"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
import { onEventUpdated } from "@/lib/cached-queries"
import { parseTicketScheduleConfig, buildTicketValidDaysPayload } from "@/lib/ticket-schedule"
import {
    formatFrequencyLabel,
    frequencyKeyFromDates,
    getDuplicateScheduleFrequencies,
    getFirstFrequencyDate,
    isValidDateKey,
    parseFrequencyKey,
    remapDatesByFrequency,
    weekdayOfDateKey,
} from "@/lib/event-duplication-schedule"

export const runtime = "nodejs"

type DuplicatePayload = {
    title?: string
    startDate?: string
    endDate?: string
    isPublished?: boolean
    remapByDayOfWeek?: boolean
    frequencyStartDates?: Record<string, string>
}

function toDateKeyUTC(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

function listDateKeysBetween(start: Date, end: Date): string[] {
    const out: string[] = []
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 12))
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 12))
    while (cursor.getTime() <= last.getTime()) {
        out.push(toDateKeyUTC(cursor))
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return out
}

function generateAccessToken(): string {
    return randomBytes(16).toString("hex")
}

async function ensureUniqueSlug(base: string): Promise<string> {
    const baseSlug = slugify(base || "evento", { lower: true, strict: true }) || "evento"
    let candidate = baseSlug
    let counter = 0
    while (await prisma.event.findUnique({ where: { slug: candidate } })) {
        counter++
        candidate = `${baseSlug}-${counter}`
    }
    return candidate
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params
        const body = (await request.json().catch(() => ({}))) as DuplicatePayload

        const startDateRaw = body.startDate?.trim()
        const endDateRaw = body.endDate?.trim()
        if (!startDateRaw || !endDateRaw) {
            return NextResponse.json(
                { success: false, error: "Fechas de inicio y fin son requeridas" },
                { status: 400 }
            )
        }

        const newStartDate = parseDateOnly(startDateRaw)
        const newEndDate = parseDateOnly(endDateRaw)
        if (newStartDate.getTime() > newEndDate.getTime()) {
            return NextResponse.json(
                { success: false, error: "La fecha de inicio no puede ser posterior a la fecha de fin" },
                { status: 400 }
            )
        }

        const source = await prisma.event.findUnique({
            where: { id },
            include: {
                ticketTypes: {
                    orderBy: { sortOrder: "asc" },
                    include: {
                        dateInventories: { orderBy: { date: "asc" } },
                    },
                },
                eventDays: { orderBy: { date: "asc" } },
            },
        })

        if (!source) {
            return NextResponse.json(
                { success: false, error: "Evento origen no encontrado" },
                { status: 404 }
            )
        }

        const newTitle = (body.title?.trim() || `${source.title} (copia)`).slice(0, 200)
        const newSlug = await ensureUniqueSlug(newTitle)
        const remap = body.remapByDayOfWeek !== false

        const newDateKeys = listDateKeysBetween(newStartDate, newEndDate)
        const newDateKeysSet = new Set(newDateKeys)
        const availableFrequencies = getDuplicateScheduleFrequencies(source.ticketTypes)
        const availableFrequencyKeys = new Set(availableFrequencies.map((frequency) => frequency.key))
        const frequencyStartDates: Record<string, string> = {}

        if (
            body.frequencyStartDates !== undefined &&
            (!body.frequencyStartDates || typeof body.frequencyStartDates !== "object" || Array.isArray(body.frequencyStartDates))
        ) {
            return NextResponse.json(
                { success: false, error: "Las fechas de inicio por frecuencia no tienen un formato válido" },
                { status: 400 }
            )
        }

        for (const [frequencyKey, value] of Object.entries(body.frequencyStartDates ?? {})) {
            const weekdays = parseFrequencyKey(frequencyKey)
            if (!weekdays || !availableFrequencyKeys.has(frequencyKey)) {
                return NextResponse.json(
                    { success: false, error: "Se recibió una frecuencia que no existe en el evento origen" },
                    { status: 400 }
                )
            }
            if (!isValidDateKey(value) || value < startDateRaw || value > endDateRaw) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `El inicio de ${formatFrequencyLabel(weekdays)} debe estar dentro del rango del nuevo evento`,
                    },
                    { status: 400 }
                )
            }
            if (!getFirstFrequencyDate(weekdays, value, endDateRaw)) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `No hay fechas de ${formatFrequencyLabel(weekdays)} desde el inicio seleccionado`,
                    },
                    { status: 400 }
                )
            }
            frequencyStartDates[frequencyKey] = value
        }

        const isPublished = Boolean(body.isPublished)
        const visibility = source.visibility
        const accessToken = visibility === "PRIVATE" ? generateAccessToken() : null

        const created = await prisma.$transaction(async (tx) => {
            const event = await tx.event.create({
                data: {
                    slug: newSlug,
                    title: newTitle,
                    description: source.description,
                    location: source.location,
                    venue: source.venue,
                    servilexSucursalCode: source.servilexSucursalCode,
                    bannerUrl: source.bannerUrl,
                    startDate: newStartDate,
                    endDate: newEndDate,
                    mode: source.mode,
                    category: source.category,
                    advanceAmount: source.advanceAmount,
                    academiaWeeklyFrequency: source.academiaWeeklyFrequency,
                    ticketLayout: source.ticketLayout,
                    membershipStartFixed: source.membershipStartFixed,
                    membershipStartMin: source.membershipStartMin,
                    membershipStartMax: source.membershipStartMax,
                    isPublished,
                    visibility,
                    accessToken,
                    discipline: source.discipline,
                    createdBy: user.id,
                },
            })

            for (const day of source.eventDays) {
                const sourceKey = toDateKeyUTC(day.date)
                const candidates = newDateKeys.filter((key) => weekdayOfDateKey(key) === weekdayOfDateKey(sourceKey))
                const targetKey = candidates[0]
                if (!targetKey) continue
                await tx.eventDay.create({
                    data: {
                        eventId: event.id,
                        date: parseDateOnly(targetKey),
                        openTime: day.openTime,
                        closeTime: day.closeTime,
                        capacity: day.capacity,
                    },
                })
            }

            for (const ticketType of source.ticketTypes) {
                const schedule = parseTicketScheduleConfig(ticketType.validDays)
                const frequencyKey = frequencyKeyFromDates(schedule.dates)
                const frequencyStartDate = frequencyKey ? frequencyStartDates[frequencyKey] : undefined
                let nextDates = schedule.dates
                if (remap && schedule.dates.length > 0) {
                    nextDates = remapDatesByFrequency(schedule.dates, newDateKeys, frequencyStartDate)
                } else if (schedule.dates.length > 0) {
                    nextDates = schedule.dates.filter((date) => newDateKeysSet.has(date))
                }

                const nextSlotsByDate = new Map<string, string[]>()
                for (const slot of schedule.slots ?? []) {
                    const targetDates = remap
                        ? remapDatesByFrequency([slot.date], newDateKeys, frequencyStartDate)
                        : nextDates.includes(slot.date)
                            ? [slot.date]
                            : []

                    for (const targetDate of targetDates) {
                        const current = nextSlotsByDate.get(targetDate) ?? []
                        nextSlotsByDate.set(targetDate, Array.from(new Set([...current, ...slot.shifts])))
                    }
                }

                const validDaysPayload = buildTicketValidDaysPayload({
                    dates: nextDates,
                    shifts: schedule.shifts,
                    slots: Array.from(nextSlotsByDate.entries()).map(([date, shifts]) => ({ date, shifts })),
                    requireShiftSelection: schedule.requireShiftSelection,
                })

                const newTicketType = await tx.ticketType.create({
                    data: {
                        eventId: event.id,
                        name: ticketType.name,
                        description: ticketType.description,
                        price: ticketType.price,
                        currency: ticketType.currency,
                        capacity: ticketType.capacity,
                        sold: 0,
                        capacityByDate: ticketType.capacityByDate,
                        isPackage: ticketType.isPackage,
                        packageDaysCount: ticketType.packageDaysCount,
                        monthlyClassLimit: ticketType.monthlyClassLimit,
                        membershipDurationMonths: ticketType.membershipDurationMonths,
                        allowMultipleDailyScans: ticketType.allowMultipleDailyScans,
                        membershipScheduleKey: ticketType.membershipScheduleKey,
                        originalPrice: ticketType.originalPrice,
                        benefits: (ticketType.benefits ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                        isFeatured: ticketType.isFeatured,
                        highlightLabel: ticketType.highlightLabel,
                        accentColor: ticketType.accentColor,
                        validDays: validDaysPayload as Prisma.InputJsonValue,
                        servilexEnabled: ticketType.servilexEnabled,
                        servilexIndicator: ticketType.servilexIndicator,
                        servilexSucursalCode: ticketType.servilexSucursalCode,
                        servilexServiceCode: ticketType.servilexServiceCode,
                        servilexDisciplineCode: ticketType.servilexDisciplineCode,
                        servilexScheduleCode: ticketType.servilexScheduleCode,
                        servilexPoolCode: ticketType.servilexPoolCode,
                        servilexExtraConfig: (ticketType.servilexExtraConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                        servilexServiceId: ticketType.servilexServiceId,
                        servilexBindingId: ticketType.servilexBindingId,
                        isActive: ticketType.isActive,
                        sortOrder: ticketType.sortOrder,
                    },
                })

                const sourceInventoryByKey = new Map(
                    ticketType.dateInventories.map((inventory) => [toDateKeyUTC(inventory.date), inventory])
                )
                const templateCapacity = ticketType.capacity
                for (const dateKey of nextDates) {
                    const sourceKey = remap
                        ? Array.from(sourceInventoryByKey.keys()).find(
                              (key) => weekdayOfDateKey(key) === weekdayOfDateKey(dateKey)
                          )
                        : dateKey
                    const sourceInventory = sourceKey ? sourceInventoryByKey.get(sourceKey) : null
                    const capacity = sourceInventory?.capacity ?? templateCapacity
                    const isEnabled = sourceInventory?.isEnabled ?? true
                    await tx.ticketTypeDateInventory.create({
                        data: {
                            ticketTypeId: newTicketType.id,
                            date: parseDateOnly(dateKey),
                            capacity,
                            sold: 0,
                            isEnabled,
                        },
                    })
                }
            }

            return event
        })

        await onEventUpdated(created.id)

        return NextResponse.json({
            success: true,
            data: {
                id: created.id,
                slug: created.slug,
                title: created.title,
            },
        })
    } catch (error) {
        console.error("[duplicate-event]", error)
        const message = error instanceof Error ? error.message : "Error al duplicar evento"
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        )
    }
}
