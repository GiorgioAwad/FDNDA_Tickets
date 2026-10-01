/**
 * Corrige el inicio de Mathyas a septiembre y elimina fechas legacy de julio.
 * Conserva los horarios de octubre/noviembre al reindexarlos desde septiembre.
 * Solo lectura por defecto; --apply escribe con locks, auditoria y verificacion.
 * Uso: node --env-file=.env.production --import tsx scripts/correct-mathyas-membership-start.ts [--apply]
 */
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { membershipChangeInclude, toChangeSnapshot } from "@/lib/membership-admin-snapshot"
import { lockMembershipTicket } from "@/lib/membership-change-apply"
import {
    formatScheduleSummary,
    getEffectiveMembershipSchedule,
    parseMembershipScheduleSelection,
} from "@/lib/membership-schedule"
import { getMembershipExpiry, getMembershipPeriod } from "@/lib/scan-helpers"
import { getTodayDateString } from "@/lib/qr"
import { parseDateOnly } from "@/lib/utils"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"
import { pickQrDateForTicket, ticketUsesPurchasedDates } from "@/lib/ticket-date-policy"

const TICKET_ID = "cmtj3gob4002u01mrjzxpkn19"
const ORDER_ID = "cmtj3go8w002s01mrisedwqzl"
const ITEM_ID = "cmtj3go9m002t01mrh9e0ygnm"
const TYPE_ID = "cmqto8hq5003901qed9smx1cw"
const ACTOR_ID = "cmlb2xsxw0000b4siyxznfo4a"
const SOURCE_START = "2026-07-01"
const TARGET_START = "2026-09-01"
const REASON = "Correccion solicitada: Mathyas inicia el 1 de septiembre de 2026. Se retiran fechas heredadas de julio y se conserva el calendario de horarios de octubre y noviembre."
const BASE_SESSIONS = ["2:17:00-18:00", "4:17:00-18:00", "6:11:00-12:00"]
const OCTOBER_SESSIONS = ["2:17:00-18:00", "4:17:00-18:00", "6:12:00-13:00"]
const NOVEMBER_SESSIONS = ["1:17:00-18:00", "3:17:00-18:00", "5:17:00-18:00"]
const APPLY = process.argv.includes("--apply")

const read = (client: typeof prisma | Prisma.TransactionClient) => client.ticket.findUniqueOrThrow({
    where: { id: TICKET_ID },
    include: { ...membershipChangeInclude, _count: { select: { scans: true } } },
})
type Record = Awaited<ReturnType<typeof read>>

function sessionKeys(value: unknown) {
    return (parseMembershipScheduleSelection(value)?.sessions ?? [])
        .map(session => `${session.weekday}:${session.start}-${session.end}`).sort()
}

function prepare(ticket: Record) {
    assert.equal(ticket.orderId, ORDER_ID)
    assert.equal(ticket.ticketTypeId, TYPE_ID)
    assert.equal(ticket.eventId, ticket.ticketType.eventId)
    assert.equal(ticket.attendeeDni, "77727393")
    assert.equal(ticket.status, "ACTIVE")
    assert.equal(ticket.order.status, "PAID")
    assert.equal(ticket.order.provider, "PRESENCIAL")
    assert.equal(ticket.ticketType.monthlyClassLimit, 12)
    assert.equal(ticket.ticketType.membershipDurationMonths, 6)
    assert.equal(ticket.event.servilexSucursalCode, "01")
    assert.equal(ticket.membershipFreeze, null)
    assert.equal(ticket._count.scans, 0, "Hay escaneos: revisar la historia antes de corregir el inicio")
    assert.deepEqual(ticket.entitlements, [], "Hay asistencias: no se deben borrar ni trasladar")
    const snapshot = toChangeSnapshot(ticket)
    assert.ok(snapshot)
    assert.equal(snapshot.orderItem.id, ITEM_ID)
    assert.equal(snapshot.orderItem.quantity, 1)
    assert.ok(Array.isArray(snapshot.orderItem.attendeeData))
    assert.equal(snapshot.orderItem.attendeeData.length, 1)
    const attendee = snapshot.orderItem.attendeeData[0] as Prisma.JsonObject
    assert.equal(attendee.dni, "77727393")
    assert.equal(attendee.membershipStartDate, TARGET_START)
    assert.deepEqual(sessionKeys(ticket.membershipSchedule), BASE_SESSIONS)
    assert.deepEqual(sessionKeys(attendee.membershipSchedule), BASE_SESSIONS)
    const start = ticket.membershipStartDate?.toISOString().slice(0, 10)
    assert.ok(start === SOURCE_START || start === TARGET_START, "El inicio ya cambio a otra fecha")
    const alreadyApplied = start === TARGET_START
    const rows = [...ticket.monthlySchedules].sort((a, b) => a.monthIndex - b.monthIndex)
    assert.deepEqual(rows.map(row => row.monthIndex), alreadyApplied ? [1, 2] : [3, 4])
    assert.deepEqual(sessionKeys(rows[0].selection), OCTOBER_SESSIONS)
    assert.deepEqual(sessionKeys(rows[1].selection), NOVEMBER_SESSIONS)
    const selections = normalizeScheduleSelections(attendee.scheduleSelections)
    assert.deepEqual(selections.map(selection => selection.date), alreadyApplied ? [] :
        [2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28].map(day => `2026-07-${String(day).padStart(2, "0")}`))
    assert.ok(selections.every(selection => selection.shift === null))
    const attendeeData = [{ ...attendee, membershipStartDate: TARGET_START, scheduleSelections: [] }]
    const targetRows = rows.map(row => ({
        ...row,
        monthIndex: alreadyApplied ? row.monthIndex : row.monthIndex - 2,
    }))
    const fingerprint = JSON.stringify({
        start, attendeeData: snapshot.orderItem.attendeeData,
        schedule: ticket.membershipSchedule, rows,
        status: ticket.status, orderStatus: ticket.order.status,
    })
    return { alreadyApplied, rows, targetRows, attendeeData, fingerprint }
}

function auditState(ticket: Record, start: string, rows: Record["monthlySchedules"], attendeeData: unknown) {
    const period = getMembershipPeriod(getTodayDateString(), parseDateOnly(start))
    const selection = getEffectiveMembershipSchedule(
        parseMembershipScheduleSelection(ticket.membershipSchedule),
        rows.map(row => ({ monthIndex: row.monthIndex, selection: parseMembershipScheduleSelection(row.selection) })),
        period?.index ?? 0,
    )
    return {
        eventId: ticket.eventId, ticketTypeId: ticket.ticketTypeId,
        ticketTypeName: ticket.ticketType.name, sucursalCode: ticket.event.servilexSucursalCode,
        sourceSold: ticket.ticketType.sold, targetSold: null,
        sessions: sessionKeys(selection), scheduleSummary: formatScheduleSummary(selection),
        membershipStartDate: start,
        membershipExpiry: getMembershipExpiry(parseDateOnly(start), 6),
        monthlySchedules: rows, attendeeData,
        monthlyNote: "Los horarios de octubre y noviembre conservan sus meses calendario.",
    }
}

async function main() {
    const ticket = await read(prisma)
    const preview = prepare(ticket)
    const before = auditState(ticket, ticket.membershipStartDate!.toISOString().slice(0, 10), preview.rows,
        ticket.order.orderItems.find(item => item.id === ITEM_ID)!.attendeeData)
    const after = auditState(ticket, TARGET_START, preview.targetRows, preview.attendeeData)
    console.log(JSON.stringify({
        mode: APPLY ? "apply" : "READ_ONLY", attendee: ticket.attendeeName,
        startBefore: before.membershipStartDate, startAfter: after.membershipStartDate,
        expiryExclusive: after.membershipExpiry,
        scheduleBefore: before.scheduleSummary, scheduleAfter: after.scheduleSummary,
        monthlyIndexes: { before: preview.rows.map(row => row.monthIndex), after: preview.targetRows.map(row => row.monthIndex) },
        removedLegacyDateCount: preview.alreadyApplied ? 0 : 12,
        alreadyApplied: preview.alreadyApplied,
    }, null, 2))
    if (!APPLY || preview.alreadyApplied) return

    await prisma.$transaction(async tx => {
        await lockMembershipTicket(tx, TICKET_ID)
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "order_items" WHERE "id" = ${ITEM_ID} FOR UPDATE`)
        const actor = await tx.user.findUniqueOrThrow({ where: { id: ACTOR_ID }, select: { role: true } })
        assert.equal(actor.role, "ADMIN")
        const freshTicket = await read(tx)
        const fresh = prepare(freshTicket)
        assert.equal(fresh.fingerprint, preview.fingerprint, "El carnet cambio despues de previsualizar")
        await tx.ticket.update({ where: { id: TICKET_ID }, data: { membershipStartDate: parseDateOnly(TARGET_START) } })
        await tx.orderItem.update({
            where: { id: ITEM_ID },
            data: { attendeeData: fresh.attendeeData as Prisma.InputJsonValue },
        })
        for (const row of fresh.rows) {
            await tx.membershipMonthlySchedule.update({
                where: { ticketId_monthIndex: { ticketId: TICKET_ID, monthIndex: row.monthIndex } },
                data: { monthIndex: row.monthIndex - 2 },
            })
        }
        await tx.membershipAdminChange.create({ data: {
            ticketId: TICKET_ID, actorId: ACTOR_ID, kind: "SCHEDULE", reason: REASON,
            before: before as unknown as Prisma.InputJsonValue,
            after: after as unknown as Prisma.InputJsonValue,
        } })
        assert.equal(prepare(await read(tx)).alreadyApplied, true)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    const verified = await read(prisma)
    assert.equal(prepare(verified).alreadyApplied, true)
    // Se comprueba tambien la politica publicada antes del fix general:
    // sin las fechas de julio, la web ya elige el QR de hoy para este carnet.
    const verifiedItem = verified.order.orderItems.find(item => item.id === ITEM_ID)!
    const selections = normalizeScheduleSelections((verifiedItem.attendeeData as Prisma.JsonObject[])[0].scheduleSelections)
    const today = getTodayDateString()
    const usesPurchasedDates = ticketUsesPurchasedDates({ eventCategory: verified.event.category, scheduleSelections: selections })
    assert.equal(usesPurchasedDates, false)
    assert.equal(pickQrDateForTicket({ today, scheduleSelections: selections, entitlements: verified.entitlements, usePurchasedDates: usesPurchasedDates }) ?? today, today)
    console.log(JSON.stringify({ applied: true, verifiedStart: TARGET_START, qrDate: today, auditRecorded: true }, null, 2))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
})
