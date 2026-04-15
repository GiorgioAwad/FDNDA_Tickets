import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
import { buildTicketValidDaysPayload, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"
import { Prisma } from "@prisma/client"
import { parseDateOnly } from "@/lib/utils"

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
            isPackage,
            packageDaysCount,
            validDays,
            sortOrder,
            isActive,
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
        let resolvedSucursalCode = normalizeOptionalCode(servilexSucursalCode)
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
                resolvedSucursalCode = bindingEntry.sucursalCodigo
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
        const ticketType = await prisma.ticketType.create({
            data: {
                eventId,
                name,
                description: normalizeDescription(description),
                price: Number(price),
                capacity: Number(capacity),
                isPackage: Boolean(isPackage),
                packageDaysCount: Boolean(isPackage) ? packageDays : null,
                validDays: normalizeValidDays(validDays),
                sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
                isActive: isActive === undefined ? true : Boolean(isActive),
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
            },
        })

        await invalidateTicketTypeCache(event.id)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error creating ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al crear tipo de entrada" },
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
            isPackage,
            packageDaysCount,
            validDays,
            sortOrder,
            isActive,
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

        const data: {
            name?: string
            description?: string | null
            price?: number
            capacity?: number
            isPackage?: boolean
            packageDaysCount?: number | null
            validDays?: Prisma.InputJsonValue
            sortOrder?: number
            isActive?: boolean
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
        if (isPackage !== undefined) data.isPackage = Boolean(isPackage)
        if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
        if (isActive !== undefined) data.isActive = Boolean(isActive)
        if (validDays !== undefined) data.validDays = normalizeValidDays(validDays)
        if (servilexEnabled !== undefined) data.servilexEnabled = Boolean(servilexEnabled)
        if (servilexSucursalCode !== undefined) data.servilexSucursalCode = normalizeOptionalCode(servilexSucursalCode)
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
                    data.servilexBindingId = resolvedBindingId
                    data.servilexSucursalCode = bindingEntry.sucursalCodigo
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

        const ticketType = await prisma.ticketType.update({
            where: { id },
            data,
        })

        const event = await prisma.event.findUnique({
            where: { id: ticketType.eventId },
            select: {
                category: true,
            },
        })

        if (capacity !== undefined && isPoolFreeEventCategory(event?.category)) {
            await prisma.$executeRaw(Prisma.sql`
                UPDATE "ticket_type_date_inventories"
                SET "capacity" = ${Number(capacity)},
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "ticketTypeId" = ${ticketType.id}
            `)
        }

        await invalidateTicketTypeCache(ticketType.eventId)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error updating ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al actualizar tipo de entrada" },
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
