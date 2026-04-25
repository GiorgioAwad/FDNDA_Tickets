import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import slugify from "slugify"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
import { onEventUpdated } from "@/lib/cached-queries"
import { parseTicketScheduleConfig, buildTicketValidDaysPayload } from "@/lib/ticket-schedule"

export const runtime = "nodejs"

type DuplicatePayload = {
    title?: string
    startDate?: string
    endDate?: string
    isPublished?: boolean
    remapByDayOfWeek?: boolean
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function toDateKeyUTC(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

function dowOfDateKey(dateKey: string): number {
    const [y, m, d] = dateKey.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
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

function remapDatesByDow(sourceDates: string[], newDateKeys: string[]): string[] {
    const sourceDows = new Set(
        sourceDates
            .filter((d) => DATE_KEY_RE.test(d))
            .map((d) => dowOfDateKey(d))
    )
    if (sourceDows.size === 0) return []
    const remapped = newDateKeys.filter((d) => sourceDows.has(dowOfDateKey(d)))
    return Array.from(new Set(remapped)).sort()
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
                    isPublished,
                    visibility,
                    accessToken,
                    discipline: source.discipline,
                    createdBy: user.id,
                },
            })

            for (const day of source.eventDays) {
                const sourceKey = toDateKeyUTC(day.date)
                const candidates = newDateKeys.filter((k) => dowOfDateKey(k) === dowOfDateKey(sourceKey))
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

            for (const tt of source.ticketTypes) {
                const schedule = parseTicketScheduleConfig(tt.validDays)
                let nextDates = schedule.dates
                if (remap && schedule.dates.length > 0) {
                    nextDates = remapDatesByDow(schedule.dates, newDateKeys)
                } else if (schedule.dates.length > 0) {
                    nextDates = schedule.dates.filter((d) => newDateKeysSet.has(d))
                }

                const validDaysPayload = buildTicketValidDaysPayload({
                    dates: nextDates,
                    shifts: schedule.shifts,
                    requireShiftSelection: schedule.requireShiftSelection,
                })

                const newTicketType = await tx.ticketType.create({
                    data: {
                        eventId: event.id,
                        name: tt.name,
                        description: tt.description,
                        price: tt.price,
                        currency: tt.currency,
                        capacity: tt.capacity,
                        sold: 0,
                        isPackage: tt.isPackage,
                        packageDaysCount: tt.packageDaysCount,
                        validDays: validDaysPayload as Prisma.InputJsonValue,
                        servilexEnabled: tt.servilexEnabled,
                        servilexIndicator: tt.servilexIndicator,
                        servilexSucursalCode: tt.servilexSucursalCode,
                        servilexServiceCode: tt.servilexServiceCode,
                        servilexDisciplineCode: tt.servilexDisciplineCode,
                        servilexScheduleCode: tt.servilexScheduleCode,
                        servilexPoolCode: tt.servilexPoolCode,
                        servilexExtraConfig: (tt.servilexExtraConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                        servilexServiceId: tt.servilexServiceId,
                        servilexBindingId: tt.servilexBindingId,
                        isActive: tt.isActive,
                        sortOrder: tt.sortOrder,
                    },
                })

                const sourceInventoryByKey = new Map(
                    tt.dateInventories.map((inv) => [toDateKeyUTC(inv.date), inv])
                )
                const templateCapacity = tt.capacity
                for (const dateKey of nextDates) {
                    const sourceKey = remap
                        ? Array.from(sourceInventoryByKey.keys()).find(
                              (k) => dowOfDateKey(k) === dowOfDateKey(dateKey)
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
