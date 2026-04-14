import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = request.nextUrl
        const config = getAbioCatalogConfig()
        const sucursalCodigo = String(searchParams.get("sucursal") || "").trim()
        const servicioCodigo = String(searchParams.get("servicio") || "").trim()
        const disciplinaCodigo = String(searchParams.get("disciplina") || "").trim()
        const horarioCodigo = String(searchParams.get("horario") || "").trim()
        const piscinaCodigo = String(searchParams.get("piscina") || "").trim()

        const bindings = await prisma.abioCatalogBinding.findMany({
            where: {
                codigoEmp: config.codigoEmp,
                isActive: true,
                ...(sucursalCodigo ? { sucursalCodigo } : {}),
                ...(servicioCodigo ? { servicioCodigo } : {}),
                ...(disciplinaCodigo ? { disciplinaCodigo } : {}),
                ...(horarioCodigo ? { horarioCodigo } : {}),
                ...(piscinaCodigo ? { piscinaCodigo } : {}),
            },
            orderBy: [
                { sucursalCodigo: "asc" },
                { servicioCodigo: "asc" },
                { disciplinaCodigo: "asc" },
                { horarioCodigo: "asc" },
                { piscinaCodigo: "asc" },
            ],
            take: 300,
        })

        const serviceKeys = bindings.map((binding) => ({
            codigoEmp: binding.codigoEmp,
            sucursalCodigo: binding.sucursalCodigo,
            servicioCodigo: binding.servicioCodigo,
        }))
        const disciplineKeys = bindings.map((binding) => ({
            codigoEmp: binding.codigoEmp,
            disciplinaCodigo: binding.disciplinaCodigo,
        }))
        const scheduleKeys = bindings.map((binding) => ({
            codigoEmp: binding.codigoEmp,
            disciplinaCodigo: binding.disciplinaCodigo,
            horarioCodigo: binding.horarioCodigo,
        }))

        const [services, disciplines, schedules] = await Promise.all([
            serviceKeys.length
                ? prisma.abioCatalogService.findMany({
                      where: {
                          OR: serviceKeys,
                      },
                  })
                : Promise.resolve([]),
            disciplineKeys.length
                ? prisma.abioCatalogDiscipline.findMany({
                      where: {
                          OR: disciplineKeys,
                      },
                  })
                : Promise.resolve([]),
            scheduleKeys.length
                ? prisma.abioCatalogSchedule.findMany({
                      where: {
                          OR: scheduleKeys,
                      },
                  })
                : Promise.resolve([]),
        ])

        const serviceMap = new Map(
            services.map((item) => [
                `${item.codigoEmp}|${item.sucursalCodigo}|${item.servicioCodigo}`,
                item,
            ])
        )
        const disciplineMap = new Map(
            disciplines.map((item) => [
                `${item.codigoEmp}|${item.disciplinaCodigo}`,
                item,
            ])
        )
        const scheduleMap = new Map(
            schedules.map((item) => [
                `${item.codigoEmp}|${item.disciplinaCodigo}|${item.horarioCodigo}`,
                item,
            ])
        )

        return NextResponse.json({
            data: bindings.map((binding) => {
                const service = serviceMap.get(
                    `${binding.codigoEmp}|${binding.sucursalCodigo}|${binding.servicioCodigo}`
                )
                const discipline = disciplineMap.get(
                    `${binding.codigoEmp}|${binding.disciplinaCodigo}`
                )
                const schedule = scheduleMap.get(
                    `${binding.codigoEmp}|${binding.disciplinaCodigo}|${binding.horarioCodigo}`
                )

                return {
                    ...binding,
                    serviceDescription: service?.servicioDescripcion || null,
                    disciplineName: discipline?.disciplinaNombre || null,
                    scheduleDescription: schedule?.diaDescripcion || null,
                    horaInicio: schedule?.horaInicio || null,
                    horaFin: schedule?.horaFin || null,
                    duracionHoras:
                        typeof schedule?.duracionHoras === "object" &&
                        schedule?.duracionHoras !== null &&
                        "toNumber" in schedule.duracionHoras
                            ? schedule.duracionHoras.toNumber()
                            : schedule?.duracionHoras ?? null,
                }
            }),
        })
    } catch (error) {
        console.error("Error fetching ABIO bindings:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
