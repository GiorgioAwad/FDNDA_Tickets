import { Prisma } from "@prisma/client"
import { parseDateOnly } from "@/lib/utils"

const reserveExistingDateInventory = async (
    tx: Prisma.TransactionClient,
    ticketTypeId: string,
    date: Date,
    quantity: number
) => {
    return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ticket_type_date_inventories"
        SET "sold" = "sold" + ${quantity},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "ticketTypeId" = ${ticketTypeId}
          AND "date" = ${date}
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
    }
) {
    for (const [dateKey, quantity] of input.reservations) {
        const dateValue = parseDateOnly(dateKey)
        const updated = await reserveExistingDateInventory(
            tx,
            input.ticketTypeId,
            dateValue,
            quantity
        )

        if (updated.length > 0) {
            continue
        }

        const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO "ticket_type_date_inventories"
                ("id", "ticketTypeId", "date", "capacity", "sold", "createdAt", "updatedAt")
            SELECT
                ${crypto.randomUUID()},
                ${input.ticketTypeId},
                ${dateValue},
                ${input.templateCapacity},
                ${quantity},
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            WHERE ${input.templateCapacity} = 0 OR ${quantity} <= ${input.templateCapacity}
            ON CONFLICT ("ticketTypeId", "date") DO NOTHING
            RETURNING "id"
        `)

        if (inserted.length > 0) {
            continue
        }

        const retried = await reserveExistingDateInventory(
            tx,
            input.ticketTypeId,
            dateValue,
            quantity
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
    }
) {
    for (const [dateKey, quantity] of input.reservations) {
        const dateValue = parseDateOnly(dateKey)
        await tx.$executeRaw(Prisma.sql`
            UPDATE "ticket_type_date_inventories"
            SET "sold" = GREATEST("sold" - ${quantity}, 0),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "ticketTypeId" = ${input.ticketTypeId}
              AND "date" = ${dateValue}
        `)
    }
}
