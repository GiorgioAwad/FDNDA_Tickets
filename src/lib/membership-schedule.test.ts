import test from "node:test"
import assert from "node:assert/strict"
import {
    getMembershipScheduleProfile,
    getMembershipScheduleKeysForSucursal,
    validateMembershipScheduleSelection,
    parseMembershipScheduleSelection,
    matchMembershipSession,
    weekdayFromDateKey,
    formatSessionsDaysLabel,
    MEMBERSHIP_SCAN_GRACE_MINUTES,
    type MembershipScheduleSession,
} from "@/lib/membership-schedule"

// ── Lookup de perfiles ─────────────────────────────────────────────────────────

test("getMembershipScheduleProfile devuelve null para sede/clave inválida", () => {
    assert.equal(getMembershipScheduleProfile(null, "ADULTOS_BRONCE"), null)
    assert.equal(getMembershipScheduleProfile("01", null), null)
    assert.equal(getMembershipScheduleProfile("99", "ADULTOS_BRONCE"), null)
    assert.equal(getMembershipScheduleProfile("01", "NO_EXISTE"), null)
})

test("getMembershipScheduleKeysForSucursal lista las 4 claves por sede", () => {
    assert.deepEqual(getMembershipScheduleKeysForSucursal("01").sort(), [
        "ADULTOS_BRONCE",
        "ADULTOS_PLATA",
        "NINOS_BRONCE",
        "NINOS_PLATA",
    ])
    assert.deepEqual(getMembershipScheduleKeysForSucursal("99"), [])
})

test("BRONCE expone elegir frecuencia (LMV, MJS); PLATA frecuencia fija (LV)", () => {
    const bronce = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    assert.equal(bronce.planMode, "CHOOSE_FREQUENCY")
    assert.deepEqual(
        bronce.frequencies.map((f) => f.id),
        ["LMV", "MJS"]
    )
    const plata = getMembershipScheduleProfile("01", "ADULTOS_PLATA")!
    assert.equal(plata.planMode, "FIXED_FREQUENCY")
    assert.deepEqual(
        plata.frequencies.map((f) => f.id),
        ["LV"]
    )
})

// ── Validación + expansión a sesiones ──────────────────────────────────────────

test("LMV expande a 3 sesiones (Lun, Mié, Vie) con la misma hora", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    const result = validateMembershipScheduleSelection(profile, { frequency: "LMV", hours: { main: "09:00-10:00" } }, "01")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
        result.selection.sessions.map((s) => s.weekday).sort(),
        [1, 3, 5]
    )
    assert.ok(result.selection.sessions.every((s) => s.start === "09:00" && s.end === "10:00"))
})

test("MJS usa hora distinta para Mar/Jue y para Sábado", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    const result = validateMembershipScheduleSelection(
        profile,
        { frequency: "MJS", hours: { weekday: "09:00-10:00", saturday: "06:00-07:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    const byDay = new Map(result.selection.sessions.map((s) => [s.weekday, `${s.start}-${s.end}`]))
    assert.equal(byDay.get(2), "09:00-10:00") // Mar
    assert.equal(byDay.get(4), "09:00-10:00") // Jue
    assert.equal(byDay.get(6), "06:00-07:00") // Sáb (solo 6-7 / 7-8 en CM adultos)
})

test("PLATA (LV) expande a Lun-Vie con una sola hora", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_PLATA")!
    const result = validateMembershipScheduleSelection(profile, { frequency: "LV", hours: { main: "08:00-09:00" } }, "01")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
        result.selection.sessions.map((s) => s.weekday).sort(),
        [1, 2, 3, 4, 5]
    )
})

test("rechaza frecuencia ausente o no soportada", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    assert.equal(validateMembershipScheduleSelection(profile, { hours: {} }, "01").ok, false)
    assert.equal(validateMembershipScheduleSelection(profile, { frequency: "LV", hours: { main: "09:00-10:00" } }, "01").ok, false)
})

test("rechaza hora fuera del catálogo del grupo", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    // 3-4pm es franja de niños, no de adultos CM
    const r = validateMembershipScheduleSelection(profile, { frequency: "LMV", hours: { main: "15:00-16:00" } }, "01")
    assert.equal(r.ok, false)
})

test("rechaza MJS sin la hora del sábado", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    const r = validateMembershipScheduleSelection(profile, { frequency: "MJS", hours: { weekday: "09:00-10:00" } }, "01")
    assert.equal(r.ok, false)
})

test("VIDENA adultos M-J-S Mar/Jue acepta mañana y tarde", () => {
    const profile = getMembershipScheduleProfile("03", "ADULTOS_BRONCE")!
    const manana = validateMembershipScheduleSelection(
        profile,
        { frequency: "MJS", hours: { weekday: "07:00-08:00", saturday: "08:00-09:00" } },
        "03"
    )
    assert.equal(manana.ok, true)
    const tarde = validateMembershipScheduleSelection(
        profile,
        { frequency: "MJS", hours: { weekday: "16:00-17:00", saturday: "12:00-13:00" } },
        "03"
    )
    assert.equal(tarde.ok, true)
})

// ── Round-trip de la selección guardada ────────────────────────────────────────

test("parseMembershipScheduleSelection re-hidrata lo guardado", () => {
    const profile = getMembershipScheduleProfile("01", "ADULTOS_BRONCE")!
    const result = validateMembershipScheduleSelection(profile, { frequency: "MJS", hours: { weekday: "09:00-10:00", saturday: "06:00-07:00" } }, "01")
    assert.equal(result.ok, true)
    if (!result.ok) return
    const json = JSON.parse(JSON.stringify(result.selection))
    const parsed = parseMembershipScheduleSelection(json)
    assert.ok(parsed)
    assert.equal(parsed!.frequency, "MJS")
    assert.equal(parsed!.sessions.length, 3)
})

test("parseMembershipScheduleSelection descarta basura", () => {
    assert.equal(parseMembershipScheduleSelection(null), null)
    assert.equal(parseMembershipScheduleSelection({ sessions: [] }), null)
    assert.equal(parseMembershipScheduleSelection({ sessions: [{ weekday: 9, start: "x", end: "y" }] }), null)
})

// ── Enforcement del escáner ────────────────────────────────────────────────────

const SESSIONS: MembershipScheduleSession[] = [
    { weekday: 1, start: "09:00", end: "10:00" }, // Lun
    { weekday: 3, start: "09:00", end: "10:00" }, // Mié
    { weekday: 5, start: "09:00", end: "10:00" }, // Vie
]

test("match: día y hora correctos → ok", () => {
    const r = matchMembershipSession(SESSIONS, 1, "09:30")
    assert.equal(r.ok, true)
})

test("match: día equivocado → WRONG_DAY", () => {
    const r = matchMembershipSession(SESSIONS, 2, "09:30")
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.reason, "WRONG_DAY")
})

test("match: hora fuera de franja → WRONG_TIME", () => {
    const tooLate = matchMembershipSession(SESSIONS, 1, "10:30")
    assert.equal(tooLate.ok, false)
    if (tooLate.ok) return
    assert.equal(tooLate.reason, "WRONG_TIME")
})

test("match: respeta la tolerancia previa al inicio", () => {
    // 08:50 está dentro de la gracia (15 min antes de las 09:00)
    assert.equal(matchMembershipSession(SESSIONS, 1, "08:50").ok, true)
    // 08:40 está fuera de la gracia
    assert.equal(matchMembershipSession(SESSIONS, 1, "08:40").ok, false)
    assert.equal(MEMBERSHIP_SCAN_GRACE_MINUTES, 15)
})

test("match: hora ilegible no bloquea por franja (acepta por día)", () => {
    assert.equal(matchMembershipSession(SESSIONS, 1, "??:??").ok, true)
})

// ── Helpers de fecha / formato ──────────────────────────────────────────────────

test("weekdayFromDateKey: 2026-06-25 es jueves (4)", () => {
    assert.equal(weekdayFromDateKey("2026-06-25"), 4)
    assert.equal(weekdayFromDateKey("2026-06-27"), 6) // sábado
    assert.equal(weekdayFromDateKey("2026-06-28"), 0) // domingo
})

test("formatSessionsDaysLabel ordena Lun→Sáb", () => {
    assert.equal(formatSessionsDaysLabel(SESSIONS), "Lun, Mié, Vie")
})
