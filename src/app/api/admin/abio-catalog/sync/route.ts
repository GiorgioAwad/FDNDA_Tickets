import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
    fetchAbioDisciplines,
    fetchAbioSchedules,
    fetchAbioServices,
    getAbioCatalogConfig,
} from "@/lib/abio-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SyncSummary = {
    imported: number
    deactivated: number
}

const asCodeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
}

async function syncDisciplines(replaceMissing: boolean): Promise<SyncSummary> {
    const config = getAbioCatalogConfig()
    const run = await prisma.abioCatalogSyncRun.create({
        data: {
            resource: "disciplines",
            status: "RUNNING",
            requestPayload: { codigoEmp: config.codigoEmp },
        },
    })

    try {
        const result = await fetchAbioDisciplines({ config })
        if (!result.ok) {
            throw new Error(result.errorMessage || `HTTP ${result.status}`)
        }

        const importedRows = result.rows
        for (const row of importedRows) {
            await prisma.abioCatalogDiscipline.upsert({
                where: {
                    codigoEmp_disciplinaCodigo: {
                        codigoEmp: config.codigoEmp,
                        disciplinaCodigo: row.disciplinaCodigo,
                    },
                },
                update: {
                    disciplinaNombre: row.disciplinaNombre,
                    isActive: true,
                    rawPayload: row.raw,
                    syncedAt: new Date(),
                },
                create: {
                    codigoEmp: config.codigoEmp,
                    disciplinaCodigo: row.disciplinaCodigo,
                    disciplinaNombre: row.disciplinaNombre,
                    isActive: true,
                    rawPayload: row.raw,
                    syncedAt: new Date(),
                },
            })
        }

        let deactivated = 0
        if (replaceMissing) {
            const activeCodes = importedRows.map((row) => row.disciplinaCodigo)
            const resultUpdate = await prisma.abioCatalogDiscipline.updateMany({
                where: {
                    codigoEmp: config.codigoEmp,
                    isActive: true,
                    disciplinaCodigo: {
                        notIn: activeCodes.length > 0 ? activeCodes : ["__NO_MATCH__"],
                    },
                },
                data: {
                    isActive: false,
                    syncedAt: new Date(),
                },
            })
            deactivated = resultUpdate.count
        }

        await prisma.abioCatalogSyncRun.update({
            where: { id: run.id },
            data: {
                status: "SUCCESS",
                importedCount: importedRows.length,
                deactivatedCount: deactivated,
                responsePayload: result.rawResponse as object,
                finishedAt: new Date(),
            },
        })

        return { imported: importedRows.length, deactivated }
    } catch (error) {
        await prisma.abioCatalogSyncRun.update({
            where: { id: run.id },
            data: {
                status: "ERROR",
                errorMessage: error instanceof Error ? error.message : "Error desconocido",
                finishedAt: new Date(),
            },
        })
        throw error
    }
}

async function syncServices(input: {
    sucursales: string[]
    replaceMissing: boolean
}): Promise<Record<string, SyncSummary>> {
    const config = getAbioCatalogConfig()
    const summaries: Record<string, SyncSummary> = {}

    for (const sucursal of input.sucursales) {
        const run = await prisma.abioCatalogSyncRun.create({
            data: {
                resource: "services",
                status: "RUNNING",
                requestPayload: { codigoEmp: config.codigoEmp, sucursal },
            },
        })

        try {
            const result = await fetchAbioServices({ config, sucursal })
            if (!result.ok) {
                throw new Error(result.errorMessage || `HTTP ${result.status}`)
            }

            for (const row of result.rows) {
                await prisma.abioCatalogService.upsert({
                    where: {
                        codigoEmp_sucursalCodigo_servicioCodigo: {
                            codigoEmp: config.codigoEmp,
                            sucursalCodigo: sucursal,
                            servicioCodigo: row.servicioCodigo,
                        },
                    },
                    update: {
                        servicioDescripcion: row.servicioDescripcion,
                        isActive: true,
                        rawPayload: row.raw,
                        syncedAt: new Date(),
                    },
                    create: {
                        codigoEmp: config.codigoEmp,
                        sucursalCodigo: sucursal,
                        servicioCodigo: row.servicioCodigo,
                        servicioDescripcion: row.servicioDescripcion,
                        isActive: true,
                        rawPayload: row.raw,
                        syncedAt: new Date(),
                    },
                })
            }

            let deactivated = 0
            if (input.replaceMissing) {
                const activeCodes = result.rows.map((row) => row.servicioCodigo)
                const resultUpdate = await prisma.abioCatalogService.updateMany({
                    where: {
                        codigoEmp: config.codigoEmp,
                        sucursalCodigo: sucursal,
                        isActive: true,
                        servicioCodigo: {
                            notIn: activeCodes.length > 0 ? activeCodes : ["__NO_MATCH__"],
                        },
                    },
                    data: {
                        isActive: false,
                        syncedAt: new Date(),
                    },
                })
                deactivated = resultUpdate.count
            }

            await prisma.abioCatalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: "SUCCESS",
                    importedCount: result.rows.length,
                    deactivatedCount: deactivated,
                    responsePayload: result.rawResponse as object,
                    finishedAt: new Date(),
                },
            })

            summaries[sucursal] = { imported: result.rows.length, deactivated }
        } catch (error) {
            await prisma.abioCatalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: "ERROR",
                    errorMessage: error instanceof Error ? error.message : "Error desconocido",
                    finishedAt: new Date(),
                },
            })
            throw error
        }
    }

    return summaries
}

async function syncSchedules(input: {
    disciplinas: string[]
    replaceMissing: boolean
}): Promise<Record<string, SyncSummary>> {
    const config = getAbioCatalogConfig()
    const summaries: Record<string, SyncSummary> = {}

    for (const disciplina of input.disciplinas) {
        const run = await prisma.abioCatalogSyncRun.create({
            data: {
                resource: "schedules",
                status: "RUNNING",
                requestPayload: { codigoEmp: config.codigoEmp, disciplina },
            },
        })

        try {
            const result = await fetchAbioSchedules({ config, disciplina })
            if (!result.ok) {
                throw new Error(result.errorMessage || `HTTP ${result.status}`)
            }

            for (const row of result.rows) {
                await prisma.abioCatalogSchedule.upsert({
                    where: {
                        codigoEmp_disciplinaCodigo_horarioCodigo: {
                            codigoEmp: config.codigoEmp,
                            disciplinaCodigo: disciplina,
                            horarioCodigo: row.horarioCodigo,
                        },
                    },
                    update: {
                        diaDescripcion: row.diaDescripcion,
                        lunes: row.lunes || null,
                        martes: row.martes || null,
                        miercoles: row.miercoles || null,
                        jueves: row.jueves || null,
                        viernes: row.viernes || null,
                        sabado: row.sabado || null,
                        domingo: row.domingo || null,
                        horaInicio: row.horaInicio,
                        horaFin: row.horaFin,
                        duracionHoras: row.duracionHoras,
                        isActive: true,
                        rawPayload: row.raw,
                        syncedAt: new Date(),
                    },
                    create: {
                        codigoEmp: config.codigoEmp,
                        disciplinaCodigo: disciplina,
                        horarioCodigo: row.horarioCodigo,
                        diaDescripcion: row.diaDescripcion,
                        lunes: row.lunes || null,
                        martes: row.martes || null,
                        miercoles: row.miercoles || null,
                        jueves: row.jueves || null,
                        viernes: row.viernes || null,
                        sabado: row.sabado || null,
                        domingo: row.domingo || null,
                        horaInicio: row.horaInicio,
                        horaFin: row.horaFin,
                        duracionHoras: row.duracionHoras,
                        isActive: true,
                        rawPayload: row.raw,
                        syncedAt: new Date(),
                    },
                })
            }

            let deactivated = 0
            if (input.replaceMissing) {
                const activeCodes = result.rows.map((row) => row.horarioCodigo)
                const resultUpdate = await prisma.abioCatalogSchedule.updateMany({
                    where: {
                        codigoEmp: config.codigoEmp,
                        disciplinaCodigo: disciplina,
                        isActive: true,
                        horarioCodigo: {
                            notIn: activeCodes.length > 0 ? activeCodes : ["__NO_MATCH__"],
                        },
                    },
                    data: {
                        isActive: false,
                        syncedAt: new Date(),
                    },
                })
                deactivated = resultUpdate.count
            }

            await prisma.abioCatalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: "SUCCESS",
                    importedCount: result.rows.length,
                    deactivatedCount: deactivated,
                    responsePayload: result.rawResponse as object,
                    finishedAt: new Date(),
                },
            })

            summaries[disciplina] = { imported: result.rows.length, deactivated }
        } catch (error) {
            await prisma.abioCatalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: "ERROR",
                    errorMessage: error instanceof Error ? error.message : "Error desconocido",
                    finishedAt: new Date(),
                },
            })
            throw error
        }
    }

    return summaries
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json().catch(() => ({}))
        const resource = String(body?.resource || "all").trim().toLowerCase()
        const replaceMissing = body?.replaceMissing !== false
        const config = getAbioCatalogConfig()

        if (!config.token.trim()) {
            return NextResponse.json(
                { error: "SERVILEX_TOKEN no configurado para sync de catálogo" },
                { status: 400 }
            )
        }

        const disciplinesSummary: SyncSummary | Record<string, SyncSummary> | null =
            resource === "all" || resource === "disciplines"
                ? await syncDisciplines(replaceMissing)
                : null

        const requestedSucursales = asCodeList(body?.sucursales)
        const serviceSucursales =
            requestedSucursales.length > 0 ? requestedSucursales : config.defaultSucursales

        const servicesSummary =
            resource === "all" || resource === "services"
                ? await syncServices({ sucursales: serviceSucursales, replaceMissing })
                : null

        let disciplinas = asCodeList(body?.disciplinas)
        if (disciplinas.length === 0 && (resource === "all" || resource === "schedules")) {
            const storedDisciplines = await prisma.abioCatalogDiscipline.findMany({
                where: {
                    codigoEmp: config.codigoEmp,
                    isActive: true,
                },
                orderBy: { disciplinaCodigo: "asc" },
                select: { disciplinaCodigo: true },
            })
            disciplinas = storedDisciplines.map((item) => item.disciplinaCodigo)
        }

        const schedulesSummary =
            resource === "all" || resource === "schedules"
                ? await syncSchedules({ disciplinas, replaceMissing })
                : null

        return NextResponse.json({
            success: true,
            data: {
                disciplines: disciplinesSummary,
                services: servicesSummary,
                schedules: schedulesSummary,
            },
        })
    } catch (error) {
        console.error("Error syncing ABIO catalog:", error)
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Error interno",
            },
            { status: 500 }
        )
    }
}
