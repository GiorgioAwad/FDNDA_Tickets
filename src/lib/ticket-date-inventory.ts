import { Prisma } from "@prisma/client"
import { parseDateOnly } from "@/lib/utils"

export function assertDateCapacityNotBelowSold(
    dateKey: string,
    capacity: number,
    sold: number
): void {
    if (capacity > 0 && capacity < sold) {
        throw new Error(
            `El cupo de ${dateKey} no puede ser menor que lo ya vendido (${sold})`
        )
    }
}

const reserveExistingDateInventory = async (
    tx: Prisma.TransactionClient,
    ticketTypeId: string,
    date: Date,
    quantity: number,
    allowOverCapacity = false
) => {
    if (allowOverCapacity) {
        return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "ticket_type_date_inventories"
            SET "sold" = "sold" + ${quantity},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "ticketTypeId" = ${ticketTypeId}
              AND "date" = ${date}
              AND "isEnabled" = true
            RETURNING "id"
        `)
    }
    return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ticket_type_date_inventories"
        SET "sold" = "sold" + ${quantity},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "ticketTypeId" = ${ticketTypeId}
          AND "date" = ${date}
          AND "isEnabled" = true
          AND ("capacity" = 0 OR "sold" + ${quantity} <= "capacity")
        RETURNING "id"
    `)
}

export async function reserveTicketTypeDateInventory(
    tx: Prisma.TransactionClient,
    input: {
        ticketTypeId: string
        templateCapacity: number
        reservations: Map<string, number>
        ticketLabel: string
        requireConfigured?: boolean
        /** Excepción administrativa: ignora el límite, nunca una fecha cerrada. */
        allowOverCapacity?: boolean
    }
) {
    for (const [dateKey, quantity] of input.reservations) {
        const dateValue = parseDateOnly(dateKey)
        const updated = await reserveExistingDateInventory(
            tx,
            input.ticketTypeId,
            dateValue,
            quantity,
            input.allowOverCapacity === true
        )

        if (updated.length > 0) {
            continue
        }

        const inserted = input.requireConfigured
            ? []
            : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO "ticket_type_date_inventories"
                ("id", "ticketTypeId", "date", "capacity", "sold", "isEnabled", "createdAt", "updatedAt")
            SELECT
                ${crypto.randomUUID()},
                ${input.ticketTypeId},
                ${dateValue},
                ${input.templateCapacity},
                ${quantity},
                true,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            WHERE ${input.templateCapacity} = 0 OR ${quantity} <= ${input.templateCapacity}
            ON CONFLICT ("ticketTypeId", "date") DO NOTHING
            RETURNING "id"
        `)

        if (inserted.length > 0) {
            continue
        }

        const retried = input.requireConfigured
            ? []
            : await reserveExistingDateInventory(
                  tx,
                  input.ticketTypeId,
                  dateValue,
                  quantity,
                  input.allowOverCapacity === true
              )

        if (retried.length === 0) {
            throw new Error(
                `No hay cupos disponibles para "${input.ticketLabel}" el ${dateKey}`
            )
        }
    }
}

export async function releaseTicketTypeDateInventory(
    tx: Prisma.TransactionClient,
    input: {
        ticketTypeId: string
        reservations: Map<string, number>
        /** En correcciones administrativas, una reserva ausente debe abortar. */
        requireExisting?: boolean
    }
) {
    for (const [dateKey, quantity] of input.reservations) {
        const dateValue = parseDateOnly(dateKey)
        if (input.requireExisting) {
            const released = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "ticket_type_date_inventories"
                SET "sold" = "sold" - ${quantity},
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "ticketTypeId" = ${input.ticketTypeId}
                  AND "date" = ${dateValue}
                  AND "sold" >= ${quantity}
                RETURNING "id"
            `)
            if (released.length === 0) {
                throw new Error(
                    `No se pudo liberar el cupo de origen para el ${dateKey}`
                )
            }
            continue
        }
        await tx.$executeRaw(Prisma.sql`
            UPDATE "ticket_type_date_inventories"
            SET "sold" = GREATEST("sold" - ${quantity}, 0),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "ticketTypeId" = ${input.ticketTypeId}
              AND "date" = ${dateValue}
        `)
    }
}
