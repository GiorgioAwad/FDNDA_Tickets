/**
 * Cambia el horario de una inscripción de ACADEMIA en las sedes donde el horario
 * ES el tipo de entrada (VMT `04`, Trujillo…), moviendo el carnet de un
 * `TicketType` a otro DENTRO DEL MISMO EVENTO.
 *
 * No confundir con las sedes que usan el modelo de horario semanal
 * (`scripts/set-membership-schedule.ts`, Campo de Marte `01` / VIDENA `03`):
 * ahí el horario vive en `Ticket.membershipSchedule` y el tipo de entrada es el
 * plan. En VMT no hay catálogo en `membership-schedule.ts`: cada franja es un
 * `TicketType` distinto ("LUN - MIE - VIE … 4PM A 5PM"), así que corregir el
 * horario = mover el carnet de tipo, con su cupo.
 *
 * Qué toca: `Ticket.ticketTypeId`, `OrderItem.ticketTypeId` y los contadores
 * `sold` de ambos tipos, en una transacción.
 * Qué NO toca: los `TicketEntitlement` (en estos paquetes salen del rango del
 * evento, no del horario, así que son idénticos en ambos tipos) ni el
 * comprobante ABIO ya emitido, que conserva su `horario` original — igual que en
 * `reassign-membership-sites.ts`.
 *
 * Consulta (por defecto):
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/change-academia-schedule.ts
 *
 * Aplicación:
 *   node --env-file=.env.production ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/change-academia-schedule.ts --apply
 */

type ScheduleChangeSpec = {
    label: string
    ticketId: string
    orderId: string
    orderItemId: string
    eventId: string
    sourceTicketTypeId: string
    targetTicketTypeId: string
    /** Identifica a la persona dentro de `attendeeData`. */
    matricula: string
    expectedPrice: number
    /** Nombres de los tipos; guardan contra un id mal copiado del listado. */
    expectedSourceName: string
    expectedTargetName: string
}

const CHANGES: ScheduleChangeSpec[] = [
    {
        // Compró Mar-Jue 4-5pm + sábado; pasa al grupo interdiario Lun-Mié-Vie
        // de la misma hora. Mismo precio (S/230), mismo paquete de 12 días.
        label: "jahazeel milenka Reyes Pérez",
        ticketId: "cmt1w53gt0asc01nrndbylqvf",
        orderId: "cmt1w4a1y0as601nrb4yckbuo",
        orderItemId: "cmt1w4a2o0as701nrg5umloym",
        eventId: "cmsqihgwf04sy01p8tjw289a9",
        sourceTicketTypeId: "664a9f7e-2671-4e9a-ace3-d58abafdc27d",
        targetTicketTypeId: "fdbdd9ec-ecea-4a1a-b0ee-fec9bb6c8acd",
        matricula: "0740347",
        expectedPrice: 230,
        expectedSourceName: "MAR - JUE - 4PM A 5PM / SÁB AM (5 a 17 AÑOS )",
        expectedTargetName: "LUN - MIE - VIE (5 A 17 AÑOS ) - 4PM A 5PM",
    },
]

const APPLY = process.argv.includes("--apply")

function fail(message: string): never {
    throw new Error(message)
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) fail(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

/** Discrepancias toleradas en cambios ya aplicados (ver `expectEqual`). */
const drift: string[] = []

/**
 * Como `assertEqual`, pero solo bloquea mientras quede algo que escribir: en un
 * cambio ya aplicado el dato pudo moverse después por vías legítimas y eso no
 * debe impedir procesar los pendientes.
 */
function expectEqual(actual: unknown, expected: unknown, message: string, pending: boolean): void {
    if (actual === expected) return
    if (pending) fail(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
    drift.push(`${message}: esperado ${String(expected)}, recibido ${String(actual)}`)
}

const TYPE_SELECT = {
    id: true,
    eventId: true,
    name: true,
    price: true,
    capacity: true,
    sold: true,
    isActive: true,
    isPackage: true,
    packageDaysCount: true,
    capacityByDate: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    allowMultipleDailyScans: true,
    validDays: true,
    servilexSucursalCode: true,
    servilexServiceCode: true,
    servilexDisciplineCode: true,
    servilexScheduleCode: true,
} as const

async function main() {
    const [{ prisma }, { Prisma }] = await Promise.all([
        import("@/lib/prisma"),
        import("@prisma/client"),
    ])

    const prepared: Array<{
        spec: ScheduleChangeSpec
        alreadyApplied: boolean
        before: Record<string, unknown>
    }> = []

    for (const spec of CHANGES) {
        const [ticket, orderItem, sourceType, targetType] = await Promise.all([
            prisma.ticket.findUnique({
                where: { id: spec.ticketId },
                include: {
                    order: {
                        include: {
                            invoices: {
                                select: {
                                    id: true,
                                    status: true,
                                    servilexGroupKey: true,
                                    invoiceNumber: true,
                                },
                            },
                        },
                    },
                    entitlements: { select: { date: true, status: true } },
                    monthlySchedules: { select: { id: true } },
                    scans: { select: { id: true, date: true, result: true } },
                },
            }),
            prisma.orderItem.findUnique({ where: { id: spec.orderItemId } }),
            prisma.ticketType.findUnique({ where: { id: spec.sourceTicketTypeId }, select: TYPE_SELECT }),
            prisma.ticketType.findUnique({ where: { id: spec.targetTicketTypeId }, select: TYPE_SELECT }),
        ])

        if (!ticket) fail(`${spec.label}: ticket no encontrado`)
        if (!orderItem) fail(`${spec.label}: OrderItem no encontrado`)
        if (!sourceType || !targetType) fail(`${spec.label}: tipo origen o destino no encontrado`)

        const isSourceState =
            ticket.ticketTypeId === spec.sourceTicketTypeId &&
            orderItem.ticketTypeId === spec.sourceTicketTypeId
        const isTargetState =
            ticket.ticketTypeId === spec.targetTicketTypeId &&
            orderItem.ticketTypeId === spec.targetTicketTypeId
        if (!isSourceState && !isTargetState) {
            fail(`${spec.label}: el carnet y el item de la orden no están ambos en el horario origen ni en el destino`)
        }
        const pending = !isTargetState

        assertEqual(ticket.orderId, spec.orderId, `${spec.label}: orden del ticket`)
        assertEqual(orderItem.orderId, spec.orderId, `${spec.label}: orden del item`)
        assertEqual(ticket.eventId, spec.eventId, `${spec.label}: evento del carnet`)
        assertEqual(sourceType.eventId, spec.eventId, `${spec.label}: evento del tipo origen`)
        assertEqual(targetType.eventId, spec.eventId, `${spec.label}: evento del tipo destino`)
        assertEqual(sourceType.name, spec.expectedSourceName, `${spec.label}: nombre del horario origen`)
        assertEqual(targetType.name, spec.expectedTargetName, `${spec.label}: nombre del horario destino`)
        assertEqual(targetType.isActive, true, `${spec.label}: el horario destino está desactivado`)

        // El horario destino tiene que ser el MISMO producto con otra franja: si
        // cambia el precio o la modalidad, esto no es una corrección de horario
        // sino otra venta, y hay que pasar por caja.
        expectEqual(Number(targetType.price), spec.expectedPrice, `${spec.label}: precio del horario destino`, pending)
        expectEqual(Number(sourceType.price), spec.expectedPrice, `${spec.label}: precio del horario origen`, pending)
        expectEqual(Number(orderItem.unitPrice), spec.expectedPrice, `${spec.label}: precio unitario del item`, pending)
        expectEqual(Number(orderItem.subtotal), spec.expectedPrice, `${spec.label}: subtotal del item`, pending)
        expectEqual(orderItem.quantity, 1, `${spec.label}: cantidad del item`, pending)
        expectEqual(ticket.status, "ACTIVE", `${spec.label}: estado del carnet`, pending)
        expectEqual(ticket.order.status, "PAID", `${spec.label}: estado de la orden`, pending)
        expectEqual(sourceType.isPackage, targetType.isPackage, `${spec.label}: modalidad equivalente`, pending)
        expectEqual(sourceType.packageDaysCount, targetType.packageDaysCount, `${spec.label}: días de paquete equivalentes`, pending)
        expectEqual(sourceType.capacityByDate, targetType.capacityByDate, `${spec.label}: cupo por fecha equivalente`, pending)
        expectEqual(sourceType.monthlyClassLimit, targetType.monthlyClassLimit, `${spec.label}: límite mensual equivalente`, pending)
        expectEqual(sourceType.membershipDurationMonths, targetType.membershipDurationMonths, `${spec.label}: duración equivalente`, pending)
        expectEqual(sourceType.allowMultipleDailyScans, targetType.allowMultipleDailyScans, `${spec.label}: doble asistencia equivalente`, pending)
        expectEqual(sourceType.servilexSucursalCode, targetType.servilexSucursalCode, `${spec.label}: sede ABIO equivalente`, pending)
        expectEqual(sourceType.servilexServiceCode, targetType.servilexServiceCode, `${spec.label}: servicio ABIO equivalente`, pending)
        expectEqual(sourceType.servilexDisciplineCode, targetType.servilexDisciplineCode, `${spec.label}: disciplina ABIO equivalente`, pending)

        // Esta sede no usa el modelo de horario semanal: si el carnet trae uno,
        // el horario que rige en la puerta es ese y no el nombre del tipo.
        if (ticket.membershipSchedule !== null) {
            fail(
                `${spec.label}: el carnet tiene horario semanal guardado; esa sede usa el modelo de ` +
                    `membership-schedule.ts, corregir con scripts/set-membership-schedule.ts`
            )
        }
        if (pending && ticket.monthlySchedules.length > 0) {
            fail(`${spec.label}: tiene cambios mensuales de horario; requiere revisión manual`)
        }

        if (!Array.isArray(orderItem.attendeeData) || orderItem.attendeeData.length !== 1) {
            fail(`${spec.label}: attendeeData debe contener exactamente una persona`)
        }
        const attendee = asRecord(orderItem.attendeeData[0])
        assertEqual(String(attendee.matricula ?? ""), spec.matricula, `${spec.label}: matrícula en attendeeData`)

        // Los entitlements se pre-generaron a partir del rango del evento
        // (`buildEntitlementDates`, rama de paquete sin fechas elegidas): son los
        // mismos en ambos tipos, así que moverse de horario no los invalida. Si
        // el comprador hubiera elegido fechas, sí habría que regenerarlos.
        const selections = Array.isArray(attendee.scheduleSelections) ? attendee.scheduleSelections : []
        if (pending && selections.length > 0) {
            fail(
                `${spec.label}: la compra trae ${selections.length} fecha(s) elegida(s); los entitlements ` +
                    `dependen del horario y habría que regenerarlos, no solo mover el tipo`
            )
        }

        const issuedInvoice = ticket.order.invoices.find(
            (invoice) =>
                invoice.status === "ISSUED" &&
                invoice.servilexGroupKey.toUpperCase().endsWith(`:MATRICULA:${spec.matricula}`)
        )

        if (isSourceState && sourceType.sold < 1) {
            fail(`${spec.label}: el contador sold del horario origen ya está en cero`)
        }
        if (isSourceState && targetType.capacity !== 0 && targetType.sold + 1 > targetType.capacity) {
            fail(`${spec.label}: el horario destino no tiene cupo (${targetType.sold}/${targetType.capacity})`)
        }

        prepared.push({
            spec,
            alreadyApplied: isTargetState,
            before: {
                estado: isTargetState ? "ya aplicado" : "pendiente",
                carnet: ticket.ticketCode,
                alumno: ticket.attendeeName,
                horarioActual: sourceType.name,
                horarioDestino: targetType.name,
                cupoOrigen: `${sourceType.sold}/${sourceType.capacity}`,
                cupoDestino: `${targetType.sold}/${targetType.capacity}`,
                escaneos: ticket.scans.length,
                entitlements: {
                    total: ticket.entitlements.length,
                    usados: ticket.entitlements.filter((e) => e.status !== "AVAILABLE").length,
                    desde: ticket.entitlements[0]?.date.toISOString().slice(0, 10) ?? null,
                    hasta: ticket.entitlements.at(-1)?.date.toISOString().slice(0, 10) ?? null,
                },
                boletaAbio: issuedInvoice
                    ? {
                          id: issuedInvoice.id,
                          numero: issuedInvoice.invoiceNumber,
                          // Se conserva tal cual: quedó emitida con el horario viejo.
                          horarioAbio: sourceType.servilexScheduleCode,
                      }
                    : null,
                horarioAbioDestino: targetType.servilexScheduleCode,
            },
        })
    }

    console.log(
        JSON.stringify({ mode: APPLY ? "apply" : "query", records: prepared.map((e) => e.before) }, null, 2)
    )

    if (drift.length > 0) {
        console.log("\nDatos que cambiaron después de aplicar (informativo, no bloquea):")
        for (const line of drift) console.log(`  · ${line}`)
        console.log("")
    }

    const pending = prepared.filter((entry) => !entry.alreadyApplied)
    if (!APPLY) {
        console.log(
            pending.length === 0
                ? "Consulta validada. Nada pendiente; no se realizó ninguna escritura."
                : `Consulta validada. Hay ${pending.length} cambio(s) pendiente(s); no se realizó ninguna escritura. Usa --apply para aplicarlos en una transacción.`
        )
        return
    }

    await prisma.$transaction(async (tx) => {
        for (const entry of prepared) {
            if (entry.alreadyApplied) continue
            const { spec } = entry

            const decremented = await tx.ticketType.updateMany({
                where: { id: spec.sourceTicketTypeId, eventId: spec.eventId, sold: { gt: 0 } },
                data: { sold: { decrement: 1 } },
            })
            if (decremented.count !== 1) fail(`${spec.label}: no se pudo liberar el cupo del horario origen`)

            const incremented = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "ticket_types"
                SET "sold" = "sold" + 1
                WHERE "id" = ${spec.targetTicketTypeId}
                  AND "eventId" = ${spec.eventId}
                  AND "isActive" = true
                  AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
                RETURNING "id"
            `)
            if (!incremented[0]) fail(`${spec.label}: no se pudo reservar el cupo del horario destino`)

            await tx.ticket.update({
                where: { id: spec.ticketId },
                data: { ticketTypeId: spec.targetTicketTypeId },
            })
            await tx.orderItem.update({
                where: { id: spec.orderItemId },
                data: { ticketTypeId: spec.targetTicketTypeId },
            })
        }
    })

    const { onEventUpdated } = await import("@/lib/cached-queries")
    await Promise.all(
        Array.from(new Set(CHANGES.map((spec) => spec.eventId))).map((eventId) => onEventUpdated(eventId))
    )

    const verification = await Promise.all(
        CHANGES.map(async (spec) => {
            const [ticket, item, sourceType, targetType] = await Promise.all([
                prisma.ticket.findUniqueOrThrow({ where: { id: spec.ticketId } }),
                prisma.orderItem.findUniqueOrThrow({ where: { id: spec.orderItemId } }),
                prisma.ticketType.findUniqueOrThrow({ where: { id: spec.sourceTicketTypeId } }),
                prisma.ticketType.findUniqueOrThrow({ where: { id: spec.targetTicketTypeId } }),
            ])
            assertEqual(ticket.ticketTypeId, spec.targetTicketTypeId, `${spec.label}: verificación del carnet`)
            assertEqual(item.ticketTypeId, spec.targetTicketTypeId, `${spec.label}: verificación del item`)
            return {
                person: spec.label,
                carnet: ticket.ticketCode,
                horario: targetType.name,
                cupoOrigen: `${sourceType.sold}/${sourceType.capacity}`,
                cupoDestino: `${targetType.sold}/${targetType.capacity}`,
            }
        })
    )

    console.log(JSON.stringify({ applied: true, verification }, null, 2))
    console.log(
        "Horario cambiado en el carnet y en la orden. La boleta ABIO conserva su horario original y no se tocó."
    )
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        try {
            const { prisma } = await import("@/lib/prisma")
            await prisma.$disconnect()
        } catch {
            // El error principal ya fue reportado; no ocultarlo por el cierre del pool.
        }
        // El adaptador Neon deja temporizadores vivos tras desconectar: este CLI
        // de una sola ejecución quedaría colgado sin el cierre explícito.
        process.exit(process.exitCode ?? 0)
    })
