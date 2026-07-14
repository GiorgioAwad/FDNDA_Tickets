import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
import {
    buildTicketValidDaysPayload,
    extractTicketValidDates,
    parseTicketScheduleConfig,
} from "@/lib/ticket-schedule"
import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"
import { Prisma } from "@prisma/client"
import { parseDateOnly } from "@/lib/utils"
import { assertDateCapacityNotBelowSold } from "@/lib/ticket-date-inventory"

export const runtime = "nodejs"

const normalizePackageDaysCount = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num <= 0) return null
    return Math.floor(num)
}

const normalizeValidDays = (value: unknown): Prisma.InputJsonValue => {
    const config = parseTicketScheduleConfig(value)
    return buildTicketValidDaysPayload(config) as Prisma.InputJsonValue
}

const getTicketTypeErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") return "Ya existe un registro con esos datos"
        if (error.code === "P2003") return "La configuracion seleccionada referencia un registro que ya no existe"
        if (error.code === "P2025") return "Tipo de entrada no encontrado"
        return `${fallback} (${error.code})`
    }

    if (error instanceof Error && error.message) {
        return error.message
    }

    return fallback
}

const normalizeDescription = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

const normalizeOptionalCode = (value: unknown, fallback?: string | null): string | null => {
    const source = value === undefined ? fallback : value
    if (source === undefined || source === null) return null
    if (typeof source !== "string") return null
    const trimmed = source.trim()
    return trimmed.length > 0 ? trimmed : null
}

const normalizeExtraConfig = (
    value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
    if (value === undefined) return undefined
    if (value === null) return Prisma.JsonNull
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return Prisma.JsonNull
    }
    return value as Prisma.InputJsonValue
}

const asExtraConfigRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

// Membresías: cupo de clases por mes (independiente de isPackage).
const normalizeMonthlyLimit = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num <= 0) return null
    return Math.floor(num)
}

// Duración de membresía a término fijo (6 = semestral, 12 = anual). null = sin
// duración fija (vigencia ligada al evento).
const normalizeDurationMonths = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num <= 0) return null
    return Math.floor(num)
}

// Membresías de natación: clave del perfil de horario semanal. Solo se acepta si
// existe en el catálogo (membership-schedule.ts) para la sede del evento.
const normalizeScheduleKey = (value: unknown, sucursalCode: string | null): string | null => {
    if (value === undefined || value === null || value === "") return null
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed) return null
    return getMembershipScheduleProfile(sucursalCode, trimmed) ? trimmed : null
}

// Precio regular (tachado) para layout de planes. Devuelve null si no aplica.
const normalizeOptionalPrice = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num < 0) return null
    return num
}

// Lista de beneficios del plan: [{ text, footnote? }]
const normalizeBenefits = (value: unknown): Prisma.InputJsonValue | null => {
    if (!Array.isArray(value)) return null
    const items: Array<{ text: string; footnote?: boolean }> = []
    for (const entry of value) {
        if (!entry) continue
        if (typeof entry === "string") {
            const text = entry.trim()
            if (text) items.push({ text })
            continue
        }
        if (typeof entry === "object") {
            const obj = entry as Record<string, unknown>
            const text = typeof obj.text === "string" ? obj.text.trim() : ""
            if (!text) continue
            const item: { text: string; footnote?: boolean } = { text }
            if (obj.footnote === true) item.footnote = true
            items.push(item)
        }
    }
    return items.length > 0 ? (items as unknown as Prisma.InputJsonValue) : null
}

type NormalizedDateCapacity = {
    dateKey: string
    date: Date
    capacity: number
    isEnabled: boolean
}

const normalizeDateCapacities = (
    value: unknown,
    validDays: unknown,
    eventStartDate: Date,
    eventEndDate: Date
): NormalizedDateCapacity[] => {
    const configuredDates = extractTicketValidDates(validDays)
    if (configuredDates.length === 0) {
        throw new Error("Los cupos diarios requieren al menos un día válido")
    }
    if (!Array.isArray(value)) {
        throw new Error("Debes configurar el cupo de cada día válido")
    }

    const configuredSet = new Set(configuredDates)
    const rows = new Map<string, NormalizedDateCapacity>()
    for (const raw of value) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("La configuración de cupos diarios es inválida")
        }
        const record = raw as Record<string, unknown>
        const dateKey = typeof record.date === "string" ? record.date.trim() : ""
        if (!configuredSet.has(dateKey) || rows.has(dateKey)) {
            throw new Error(`El día ${dateKey || "indicado"} no pertenece a esta entrada`)
        }
        const date = parseDateOnly(dateKey)
        if (date < parseDateOnly(eventStartDate.toISOString().slice(0, 10)) || date > parseDateOnly(eventEndDate.toISOString().slice(0, 10))) {
            throw new Error(`El día ${dateKey} está fuera del rango del evento`)
        }
        const capacity = Number(record.capacity)
        if (!Number.isInteger(capacity) || capacity < 0) {
            throw new Error(`El cupo de ${dateKey} debe ser un entero mayor o igual a cero`)
        }
        rows.set(dateKey, {
            dateKey,
            date,
            capacity,
            isEnabled: record.isEnabled === undefined ? true : Boolean(record.isEnabled),
        })
    }

    const missing = configuredDates.filter((date) => !rows.has(date))
    if (missing.length > 0) {
        throw new Error(`Falta configurar el cupo de: ${missing.join(", ")}`)
    }
    return configuredDates.map((date) => rows.get(date)!)
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const {
            eventId,
            name,
            description,
            price,
            capacity,
            capacityByDate,
            dateCapacities,
            isPackage,
            packageDaysCount,
            monthlyClassLimit,
            membershipDurationMonths,
            allowMultipleDailyScans,
            membershipScheduleKey,
            validDays,
            sortOrder,
            isActive,
            originalPrice,
            benefits,
            isFeatured,
            highlightLabel,
            accentColor,
            servilexEnabled,
            servilexIndicator,
            servilexServiceCode,
            servilexDisciplineCode,
            servilexScheduleCode,
            servilexPoolCode,
            servilexExtraConfig,
            servilexServiceId,
            servilexBindingId,
        } = body

        if (!eventId || !name || price === undefined || capacity === undefined) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: {
                id: true,
                category: true,
                servilexSucursalCode: true,
                startDate: true,
                endDate: true,
            },
        })

        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 404 }
            )
        }

        // Resolve servilex fields from catalog if serviceId provided
        let resolvedIndicator = normalizeOptionalCode(servilexIndicator, "AC")
        let resolvedServiceCode = normalizeOptionalCode(servilexServiceCode)
        let resolvedServiceId: string | null = normalizeOptionalCode(servilexServiceId)
        let resolvedBindingId: string | null = normalizeOptionalCode(servilexBindingId)
        const resolvedSucursalCode = normalizeOptionalCode(event.servilexSucursalCode, "01")
        let resolvedDisciplineCode = normalizeOptionalCode(servilexDisciplineCode)
        let resolvedScheduleCode = normalizeOptionalCode(servilexScheduleCode)
        let resolvedPoolCode = normalizeOptionalCode(servilexPoolCode)
        let resolvedExtraConfig = normalizeExtraConfig(servilexExtraConfig)

        if (resolvedServiceId) {
            const catalogEntry = await prisma.servilexService.findUnique({
                where: { id: resolvedServiceId },
            })
            if (catalogEntry) {
                resolvedIndicator = catalogEntry.indicador
                resolvedServiceCode = catalogEntry.codigo
            } else {
                resolvedServiceId = null
            }
        }

        if (resolvedBindingId) {
            const bindingEntry = await prisma.abioCatalogBinding.findUnique({
                where: { id: resolvedBindingId },
            })
            if (bindingEntry) {
                if (bindingEntry.sucursalCodigo !== resolvedSucursalCode) {
                    return NextResponse.json(
                        { success: false, error: "La configuracion ABIO no corresponde a la sede del evento" },
                        { status: 400 }
                    )
                }
                resolvedServiceCode = bindingEntry.servicioCodigo
                resolvedDisciplineCode = bindingEntry.disciplinaCodigo
                resolvedScheduleCode = bindingEntry.horarioCodigo
                resolvedPoolCode = bindingEntry.piscinaCodigo

                const currentExtraConfig = asExtraConfigRecord(servilexExtraConfig)
                if (resolvedIndicator === "PN" || resolvedIndicator === "PA") {
                    const scheduleEntry = await prisma.abioCatalogSchedule.findFirst({
                        where: {
                            codigoEmp: bindingEntry.codigoEmp,
                            disciplinaCodigo: bindingEntry.disciplinaCodigo,
                            horarioCodigo: bindingEntry.horarioCodigo,
                            isActive: true,
                        },
                        select: {
                            horaInicio: true,
                            horaFin: true,
                            duracionHoras: true,
                        },
                    })
                    resolvedExtraConfig = {
                        ...currentExtraConfig,
                        cantidad:
                            currentExtraConfig.cantidad !== undefined
                                ? currentExtraConfig.cantidad
                                : 1,
                        horaInicio:
                            currentExtraConfig.horaInicio ||
                            scheduleEntry?.horaInicio ||
                            "",
                        horaFin:
                            currentExtraConfig.horaFin ||
                            scheduleEntry?.horaFin ||
                            "",
                        duracion:
                            currentExtraConfig.duracion !== undefined
                                ? currentExtraConfig.duracion
                                : scheduleEntry?.duracionHoras
                                  ? Number(scheduleEntry.duracionHoras)
                                  : 1,
                    } as Prisma.InputJsonValue
                }
            } else {
                resolvedBindingId = null
            }
        }

        // Auto-resolve binding for pool ticket types when individual codes are present
        if (
            !resolvedBindingId &&
            resolvedSucursalCode &&
            resolvedServiceCode &&
            resolvedDisciplineCode &&
            resolvedPoolCode &&
            resolvedScheduleCode &&
            (resolvedIndicator === "PN" || resolvedIndicator === "PA")
        ) {
            const config = getAbioCatalogConfig()
            const autoBinding = await prisma.abioCatalogBinding.findFirst({
                where: {
                    codigoEmp: config.codigoEmp,
                    sucursalCodigo: resolvedSucursalCode,
                    servicioCodigo: resolvedServiceCode,
                    disciplinaCodigo: resolvedDisciplineCode,
                    piscinaCodigo: resolvedPoolCode,
                    horarioCodigo: resolvedScheduleCode,
                    isActive: true,
                },
            })
            if (autoBinding) {
                resolvedBindingId = autoBinding.id
            }
        }

        const packageDays = normalizePackageDaysCount(packageDaysCount)
        const normalizedValidDays = normalizeValidDays(validDays)
        const resolvedCapacityByDate = event.category === "EVENTO" && Boolean(capacityByDate)
        const normalizedDateCapacities = resolvedCapacityByDate
            ? normalizeDateCapacities(
                  dateCapacities,
                  normalizedValidDays,
                  event.startDate,
                  event.endDate
              )
            : []
        const ticketType = await prisma.$transaction((tx) => tx.ticketType.create({
            data: {
                eventId,
                name,
                description: normalizeDescription(description),
                price: Number(price),
                capacity: Number(capacity),
                capacityByDate: resolvedCapacityByDate,
                isPackage: Boolean(isPackage),
                packageDaysCount: Boolean(isPackage) ? packageDays : null,
                monthlyClassLimit: normalizeMonthlyLimit(monthlyClassLimit),
                membershipDurationMonths: normalizeDurationMonths(membershipDurationMonths),
                allowMultipleDailyScans: Boolean(allowMultipleDailyScans),
                membershipScheduleKey: normalizeScheduleKey(membershipScheduleKey, resolvedSucursalCode),
                validDays: normalizedValidDays,
                sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
                isActive: isActive === undefined ? true : Boolean(isActive),
                originalPrice: normalizeOptionalPrice(originalPrice),
                benefits: normalizeBenefits(benefits) ?? Prisma.JsonNull,
                isFeatured: Boolean(isFeatured),
                highlightLabel: normalizeDescription(highlightLabel),
                accentColor: normalizeOptionalCode(accentColor),
                servilexEnabled: Boolean(servilexEnabled),
                servilexIndicator: resolvedIndicator,
                servilexSucursalCode: resolvedSucursalCode,
                servilexServiceCode: resolvedServiceCode,
                servilexDisciplineCode: resolvedDisciplineCode,
                servilexScheduleCode: resolvedScheduleCode,
                servilexPoolCode: resolvedPoolCode,
                servilexExtraConfig: resolvedExtraConfig,
                servilexServiceId: resolvedServiceId,
                servilexBindingId: resolvedBindingId,
                dateInventories: resolvedCapacityByDate
                    ? {
                          create: normalizedDateCapacities.map((row) => ({
                              date: row.date,
                              capacity: row.capacity,
                              sold: 0,
                              isEnabled: row.isEnabled,
                          })),
                      }
                    : undefined,
            },
            include: {
                dateInventories: { orderBy: { date: "asc" } },
            },
        }))

        await invalidateTicketTypeCache(event.id)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error creating ticket type:", error)
        return NextResponse.json(
            { success: false, error: getTicketTypeErrorMessage(error, "Error al crear tipo de entrada") },
            { status: 500 }
        )
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const {
            id,
            name,
            description,
            price,
            capacity,
            capacityByDate,
            dateCapacities,
            isPackage,
            packageDaysCount,
            monthlyClassLimit,
            membershipDurationMonths,
            allowMultipleDailyScans,
            membershipScheduleKey,
            validDays,
            sortOrder,
            isActive,
            originalPrice,
            benefits,
            isFeatured,
            highlightLabel,
            accentColor,
            servilexEnabled,
            servilexIndicator,
            servilexSucursalCode,
            servilexServiceCode,
            servilexDisciplineCode,
            servilexScheduleCode,
            servilexPoolCode,
            servilexExtraConfig,
            servilexServiceId,
            servilexBindingId,
            dateInventoryDate,
            dateInventoryEnabled,
        } = body

        if (!id) {
            return NextResponse.json(
                { success: false, error: "ID requerido" },
                { status: 400 }
            )
        }

        if (dateInventoryDate !== undefined && dateInventoryEnabled !== undefined) {
            const ticketType = await prisma.ticketType.findUnique({
                where: { id },
                select: {
                    id: true,
                    eventId: true,
                    capacity: true,
                },
            })

            if (!ticketType) {
                return NextResponse.json(
                    { success: false, error: "Tipo de entrada no encontrado" },
                    { status: 404 }
                )
            }

            const normalizedDate =
                typeof dateInventoryDate === "string" && dateInventoryDate.trim()
                    ? parseDateOnly(dateInventoryDate.trim())
                    : null

            if (!normalizedDate || Number.isNaN(normalizedDate.getTime())) {
                return NextResponse.json(
                    { success: false, error: "Fecha invalida" },
                    { status: 400 }
                )
            }

            const inventory = await prisma.ticketTypeDateInventory.upsert({
                where: {
                    ticketTypeId_date: {
                        ticketTypeId: id,
                        date: normalizedDate,
                    },
                },
                update: {
                    isEnabled: Boolean(dateInventoryEnabled),
                },
                create: {
                    ticketTypeId: id,
                    date: normalizedDate,
                    capacity: ticketType.capacity,
                    sold: 0,
                    isEnabled: Boolean(dateInventoryEnabled),
                },
            })

            await invalidateTicketTypeCache(ticketType.eventId)

            return NextResponse.json({
                success: true,
                data: inventory,
            })
        }

        const currentTicketType = await prisma.ticketType.findUnique({
            where: { id },
            select: {
                eventId: true,
                capacityByDate: true,
                validDays: true,
                event: {
                    select: {
                        category: true,
                        servilexSucursalCode: true,
                        startDate: true,
                        endDate: true,
                    },
                },
            },
        })

        if (!currentTicketType) {
            return NextResponse.json(
                { success: false, error: "Tipo de entrada no encontrado" },
                { status: 404 }
            )
        }

        const eventSucursalCode = normalizeOptionalCode(
            currentTicketType.event.servilexSucursalCode,
            "01"
        ) || "01"

        const data: {
            name?: string
            description?: string | null
            price?: number
            capacity?: number
            capacityByDate?: boolean
            isPackage?: boolean
            packageDaysCount?: number | null
            monthlyClassLimit?: number | null
            membershipDurationMonths?: number | null
            allowMultipleDailyScans?: boolean
            membershipScheduleKey?: string | null
            validDays?: Prisma.InputJsonValue
            sortOrder?: number
            isActive?: boolean
            originalPrice?: number | null
            benefits?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
            isFeatured?: boolean
            highlightLabel?: string | null
            accentColor?: string | null
            servilexEnabled?: boolean
            servilexIndicator?: string | null
            servilexSucursalCode?: string | null
            servilexServiceCode?: string | null
            servilexDisciplineCode?: string | null
            servilexScheduleCode?: string | null
            servilexPoolCode?: string | null
            servilexExtraConfig?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
            servilexServiceId?: string | null
            servilexBindingId?: string | null
        } = {}

        if (name !== undefined) data.name = name
        if (description !== undefined) {
            data.description = normalizeDescription(description) ?? null
        }
        if (price !== undefined) data.price = Number(price)
        if (capacity !== undefined) data.capacity = Number(capacity)
        const resolvedCapacityByDate =
            currentTicketType.event.category === "EVENTO"
                ? capacityByDate !== undefined
                    ? Boolean(capacityByDate)
                    : currentTicketType.capacityByDate
                : false
        if (capacityByDate !== undefined) data.capacityByDate = resolvedCapacityByDate
        if (isPackage !== undefined) data.isPackage = Boolean(isPackage)
        if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
        if (isActive !== undefined) data.isActive = Boolean(isActive)
        if (monthlyClassLimit !== undefined) data.monthlyClassLimit = normalizeMonthlyLimit(monthlyClassLimit)
        if (membershipDurationMonths !== undefined) data.membershipDurationMonths = normalizeDurationMonths(membershipDurationMonths)
        if (allowMultipleDailyScans !== undefined) data.allowMultipleDailyScans = Boolean(allowMultipleDailyScans)
        if (membershipScheduleKey !== undefined) data.membershipScheduleKey = normalizeScheduleKey(membershipScheduleKey, eventSucursalCode)
        if (originalPrice !== undefined) data.originalPrice = normalizeOptionalPrice(originalPrice)
        if (benefits !== undefined) data.benefits = normalizeBenefits(benefits) ?? Prisma.JsonNull
        if (isFeatured !== undefined) data.isFeatured = Boolean(isFeatured)
        if (highlightLabel !== undefined) data.highlightLabel = normalizeDescription(highlightLabel) ?? null
        if (accentColor !== undefined) data.accentColor = normalizeOptionalCode(accentColor)
        if (validDays !== undefined) data.validDays = normalizeValidDays(validDays)
        if (servilexEnabled !== undefined) data.servilexEnabled = Boolean(servilexEnabled)
        if (servilexSucursalCode !== undefined) data.servilexSucursalCode = eventSucursalCode
        if (servilexDisciplineCode !== undefined) data.servilexDisciplineCode = normalizeOptionalCode(servilexDisciplineCode)
        if (servilexScheduleCode !== undefined) data.servilexScheduleCode = normalizeOptionalCode(servilexScheduleCode)
        if (servilexPoolCode !== undefined) data.servilexPoolCode = normalizeOptionalCode(servilexPoolCode)
        if (servilexExtraConfig !== undefined) data.servilexExtraConfig = normalizeExtraConfig(servilexExtraConfig) ?? Prisma.JsonNull

        // Resolve servilex fields from catalog if serviceId provided
        if (servilexServiceId !== undefined) {
            const resolvedId = normalizeOptionalCode(servilexServiceId)
            if (resolvedId) {
                const catalogEntry = await prisma.servilexService.findUnique({
                    where: { id: resolvedId },
                })
                if (catalogEntry) {
                    data.servilexServiceId = resolvedId
                    data.servilexIndicator = catalogEntry.indicador
                    data.servilexServiceCode = catalogEntry.codigo
                } else {
                    data.servilexServiceId = null
                }
            } else {
                data.servilexServiceId = null
                if (servilexIndicator !== undefined) data.servilexIndicator = normalizeOptionalCode(servilexIndicator, "AC")
                if (servilexServiceCode !== undefined) data.servilexServiceCode = normalizeOptionalCode(servilexServiceCode)
            }
        } else {
            if (servilexIndicator !== undefined) data.servilexIndicator = normalizeOptionalCode(servilexIndicator, "AC")
            if (servilexServiceCode !== undefined) data.servilexServiceCode = normalizeOptionalCode(servilexServiceCode)
        }

        if (servilexBindingId !== undefined) {
            const resolvedBindingId = normalizeOptionalCode(servilexBindingId)
            if (resolvedBindingId) {
                const bindingEntry = await prisma.abioCatalogBinding.findUnique({
                    where: { id: resolvedBindingId },
                })
                if (bindingEntry) {
                    if (bindingEntry.sucursalCodigo !== eventSucursalCode) {
                        return NextResponse.json(
                            { success: false, error: "La configuracion ABIO no corresponde a la sede del evento" },
                            { status: 400 }
                        )
                    }
                    data.servilexBindingId = resolvedBindingId
                    data.servilexSucursalCode = eventSucursalCode
                    data.servilexServiceCode = bindingEntry.servicioCodigo
                    data.servilexDisciplineCode = bindingEntry.disciplinaCodigo
                    data.servilexScheduleCode = bindingEntry.horarioCodigo
                    data.servilexPoolCode = bindingEntry.piscinaCodigo

                    const effectiveIndicator =
                        data.servilexIndicator ??
                        normalizeOptionalCode(servilexIndicator, "AC") ??
                        "AC"
                    if (effectiveIndicator === "PN" || effectiveIndicator === "PA") {
                        const scheduleEntry = await prisma.abioCatalogSchedule.findFirst({
                            where: {
                                codigoEmp: bindingEntry.codigoEmp,
                                disciplinaCodigo: bindingEntry.disciplinaCodigo,
                                horarioCodigo: bindingEntry.horarioCodigo,
                                isActive: true,
                            },
                            select: {
                                horaInicio: true,
                                horaFin: true,
                                duracionHoras: true,
                            },
                        })
                        const currentExtraConfig = asExtraConfigRecord(servilexExtraConfig)
                        data.servilexExtraConfig = {
                            ...currentExtraConfig,
                            cantidad:
                                currentExtraConfig.cantidad !== undefined
                                    ? currentExtraConfig.cantidad
                                    : 1,
                            horaInicio:
                                currentExtraConfig.horaInicio ||
                                scheduleEntry?.horaInicio ||
                                "",
                            horaFin:
                                currentExtraConfig.horaFin ||
                                scheduleEntry?.horaFin ||
                                "",
                            duracion:
                                currentExtraConfig.duracion !== undefined
                                    ? currentExtraConfig.duracion
                                    : scheduleEntry?.duracionHoras
                                      ? Number(scheduleEntry.duracionHoras)
                                      : 1,
                        } as Prisma.InputJsonValue
                    }
                } else {
                    data.servilexBindingId = null
                }
            } else {
                data.servilexBindingId = null
            }
        }

        if (packageDaysCount !== undefined || isPackage !== undefined) {
            const packageDays = normalizePackageDaysCount(packageDaysCount)
            const packageEnabled = isPackage !== undefined ? Boolean(isPackage) : undefined
            data.packageDaysCount = packageEnabled === false ? null : packageDays
        }

        const effectiveValidDays = data.validDays ?? currentTicketType.validDays
        if (resolvedCapacityByDate && validDays !== undefined && dateCapacities === undefined) {
            throw new Error("Debes enviar el cupo de cada día válido")
        }
        const normalizedDateCapacities =
            resolvedCapacityByDate && dateCapacities !== undefined
                ? normalizeDateCapacities(
                      dateCapacities,
                      effectiveValidDays,
                      currentTicketType.event.startDate,
                      currentTicketType.event.endDate
                  )
                : null

        const ticketType = await prisma.$transaction(async (tx) => {
            if (normalizedDateCapacities) {
                const existing = await tx.ticketTypeDateInventory.findMany({
                    where: { ticketTypeId: id },
                    select: { date: true, sold: true },
                })
                const soldByDate = new Map(
                    existing.map((row) => [row.date.toISOString().slice(0, 10), row.sold])
                )
                for (const row of normalizedDateCapacities) {
                    const sold = soldByDate.get(row.dateKey) ?? 0
                    assertDateCapacityNotBelowSold(row.dateKey, row.capacity, sold)
                }
            }

            const updated = await tx.ticketType.update({
                where: { id },
                data,
            })

            if (normalizedDateCapacities) {
                for (const row of normalizedDateCapacities) {
                    await tx.ticketTypeDateInventory.upsert({
                        where: {
                            ticketTypeId_date: {
                                ticketTypeId: id,
                                date: row.date,
                            },
                        },
                        update: {
                            capacity: row.capacity,
                            isEnabled: row.isEnabled,
                        },
                        create: {
                            ticketTypeId: id,
                            date: row.date,
                            capacity: row.capacity,
                            sold: 0,
                            isEnabled: row.isEnabled,
                        },
                    })
                }
                await tx.ticketTypeDateInventory.updateMany({
                    where: {
                        ticketTypeId: id,
                        date: { notIn: normalizedDateCapacities.map((row) => row.date) },
                    },
                    data: { isEnabled: false },
                })
            }

            if (capacity !== undefined && isPoolFreeEventCategory(currentTicketType.event.category)) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE "ticket_type_date_inventories"
                    SET "capacity" = ${Number(capacity)},
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "ticketTypeId" = ${updated.id}
                `)
            }

            return tx.ticketType.findUniqueOrThrow({
                where: { id },
                include: { dateInventories: { orderBy: { date: "asc" } } },
            })
        })

        await invalidateTicketTypeCache(ticketType.eventId)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error updating ticket type:", error)
        return NextResponse.json(
            { success: false, error: getTicketTypeErrorMessage(error, "Error al actualizar tipo de entrada") },
            { status: 500 }
        )
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get("id")

        if (!id) {
            return NextResponse.json(
                { success: false, error: "ID requerido" },
                { status: 400 }
            )
        }

        const ticketType = await prisma.ticketType.findUnique({
            where: { id },
            select: { eventId: true },
        })

        if (!ticketType) {
            return NextResponse.json(
                { success: false, error: "Tipo de entrada no encontrado" },
                { status: 404 }
            )
        }

        const sold = await prisma.ticket.count({
            where: { ticketTypeId: id },
        })

        const orderItemCount = await prisma.orderItem.count({
            where: { ticketTypeId: id },
        })

        if (sold > 0 || orderItemCount > 0) {
            await prisma.ticketType.update({
                where: { id },
                data: { isActive: false },
            })

            await invalidateTicketTypeCache(ticketType.eventId)

            return NextResponse.json({
                success: true,
                message: `Tipo de entrada desactivado (tiene ${sold > 0 ? "ventas" : "ordenes asociadas"})`,
            })
        }

        await prisma.ticketType.delete({
            where: { id },
        })

        await invalidateTicketTypeCache(ticketType.eventId)

        return NextResponse.json({
            success: true,
            message: "Tipo de entrada eliminado",
        })
    } catch (error) {
        console.error("Error deleting ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al eliminar tipo de entrada" },
            { status: 500 }
        )
    }
}
