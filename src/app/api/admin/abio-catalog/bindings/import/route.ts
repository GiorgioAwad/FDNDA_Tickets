import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { buildAbioBindingCompositeKey, parseAbioBindingRows } from "@/lib/abio-bindings"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const rows = Array.isArray(body?.rows) ? body.rows : []
        const replaceAll = body?.replaceAll === true
        const config = getAbioCatalogConfig()
        const codigoEmp = String(body?.codigoEmp || config.codigoEmp).trim() || config.codigoEmp

        if (rows.length === 0) {
            return NextResponse.json({ error: "No se recibieron filas para importar" }, { status: 400 })
        }

        const parsedRows = parseAbioBindingRows({
            rows: rows as Array<Record<string, unknown>>,
            codigoEmp,
        })

        if (parsedRows.length === 0) {
            return NextResponse.json(
                { error: "No se pudo interpretar ninguna fila valida de la tabla de amarre" },
                { status: 400 }
            )
        }

        const run = await prisma.abioCatalogSyncRun.create({
            data: {
                resource: "bindings_import",
                status: "RUNNING",
                requestPayload: {
                    replaceAll,
                    rowCount: rows.length,
                    parsedCount: parsedRows.length,
                },
            },
        })

        const affectedSucursales = Array.from(new Set(parsedRows.map((row) => row.sucursalCodigo)))
        const importedKeys = new Set(parsedRows.map((row) => buildAbioBindingCompositeKey(row)))

        try {
            for (const row of parsedRows) {
                await prisma.abioCatalogBinding.upsert({
                    where: {
                        codigoEmp_sucursalCodigo_servicioCodigo_disciplinaCodigo_piscinaCodigo_horarioCodigo: {
                            codigoEmp: row.codigoEmp,
                            sucursalCodigo: row.sucursalCodigo,
                            servicioCodigo: row.servicioCodigo,
                            disciplinaCodigo: row.disciplinaCodigo,
                            piscinaCodigo: row.piscinaCodigo,
                            horarioCodigo: row.horarioCodigo,
                        },
                    },
                    update: {
                        numeroCupos: row.numeroCupos,
                        isActive: true,
                        source: "IMPORT",
                        rawPayload: row.raw as Prisma.InputJsonValue,
                        syncedAt: new Date(),
                    },
                    create: {
                        codigoEmp: row.codigoEmp,
                        sucursalCodigo: row.sucursalCodigo,
                        servicioCodigo: row.servicioCodigo,
                        disciplinaCodigo: row.disciplinaCodigo,
                        piscinaCodigo: row.piscinaCodigo,
                        horarioCodigo: row.horarioCodigo,
                        numeroCupos: row.numeroCupos,
                        isActive: true,
                        source: "IMPORT",
                        rawPayload: row.raw as Prisma.InputJsonValue,
                        syncedAt: new Date(),
                    },
                })
            }

            let deactivated = 0
            if (replaceAll && affectedSucursales.length > 0) {
                const existingBindings = await prisma.abioCatalogBinding.findMany({
                    where: {
                        codigoEmp,
                        sucursalCodigo: { in: affectedSucursales },
                        isActive: true,
                    },
                    select: {
                        id: true,
                        codigoEmp: true,
                        sucursalCodigo: true,
                        servicioCodigo: true,
                        disciplinaCodigo: true,
                        piscinaCodigo: true,
                        horarioCodigo: true,
                    },
                })

                const idsToDeactivate = existingBindings
                    .filter((row) => !importedKeys.has(buildAbioBindingCompositeKey(row)))
                    .map((row) => row.id)

                if (idsToDeactivate.length > 0) {
                    const updateResult = await prisma.abioCatalogBinding.updateMany({
                        where: {
                            id: { in: idsToDeactivate },
                        },
                        data: {
                            isActive: false,
                            syncedAt: new Date(),
                        },
                    })
                    deactivated = updateResult.count
                }
            }

            await prisma.abioCatalogSyncRun.update({
                where: { id: run.id },
                data: {
                    status: "SUCCESS",
                    importedCount: parsedRows.length,
                    deactivatedCount: deactivated,
                    responsePayload: {
                        affectedSucursales,
                    },
                    finishedAt: new Date(),
                },
            })

            return NextResponse.json({
                success: true,
                data: {
                    imported: parsedRows.length,
                    deactivated,
                    affectedSucursales,
                },
            })
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
    } catch (error) {
        console.error("Error importing ABIO bindings:", error)
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Error interno",
            },
            { status: 500 }
        )
    }
}
