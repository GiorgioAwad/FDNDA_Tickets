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
    getEffectiveMembershipSchedule,
    scheduleSelectionToInput,
    formatScheduleSummary,
    MEMBERSHIP_SCAN_GRACE_MINUTES,
    type MembershipScheduleSession,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"

// ── Lookup de perfiles ─────────────────────────────────────────────────────────

test("getMembershipScheduleProfile devuelve null para sede/clave inválida", () => {
    assert.equal(getMembershipScheduleProfile(null, "BRONCE"), null)
    assert.equal(getMembershipScheduleProfile("01", null), null)
    assert.equal(getMembershipScheduleProfile("99", "BRONCE"), null)
    assert.equal(getMembershipScheduleProfile("01", "NO_EXISTE"), null)
})

test("getMembershipScheduleKeysForSucursal lista los planes (BRONCE, PLATA, BRONCE_2X)", () => {
    assert.deepEqual(getMembershipScheduleKeysForSucursal("01").sort(), ["BRONCE", "BRONCE_2X", "PLATA"])
    assert.deepEqual(getMembershipScheduleKeysForSucursal("03").sort(), ["BRONCE", "BRONCE_2X", "PLATA"])
    assert.deepEqual(getMembershipScheduleKeysForSucursal("99"), [])
})

test("claves legacy (categoría+plan) siguen resolviendo al plan", () => {
    assert.equal(getMembershipScheduleProfile("01", "ADULTOS_BRONCE")?.key, "BRONCE")
    assert.equal(getMembershipScheduleProfile("01", "NINOS_PLATA")?.key, "PLATA")
})

test("BRONCE elige frecuencia y tiene ambas categorías; PLATA es fija (LV)", () => {
    const bronce = getMembershipScheduleProfile("01", "BRONCE")!
    assert.equal(bronce.planMode, "CHOOSE_FREQUENCY")
    assert.deepEqual(
        bronce.categories.map((c) => c.id).sort(),
        ["ADULTOS", "NINOS"]
    )
    const adultBronce = bronce.categories.find((c) => c.id === "ADULTOS")!
    assert.deepEqual(
        adultBronce.frequencies.map((f) => f.id),
        ["LMV", "MJS"]
    )
    const plata = getMembershipScheduleProfile("01", "PLATA")!
    assert.equal(plata.planMode, "FIXED_FREQUENCY")
    const adultPlata = plata.categories.find((c) => c.id === "ADULTOS")!
    assert.deepEqual(
        adultPlata.frequencies.map((f) => f.id),
        ["LV"]
    )
})

// ── Validación + expansión a sesiones ──────────────────────────────────────────

test("rechaza sin categoría", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    const r = validateMembershipScheduleSelection(profile, { frequency: "LMV", hours: { main: "09:00-10:00" } }, "01")
    assert.equal(r.ok, false)
})

test("adultos LMV expande a 3 sesiones (Lun, Mié, Vie) con la misma hora", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "LMV", hours: { main: "09:00-10:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.selection.category, "ADULTOS")
    assert.deepEqual(
        result.selection.sessions.map((s) => s.weekday).sort(),
        [1, 3, 5]
    )
    assert.ok(result.selection.sessions.every((s) => s.start === "09:00" && s.end === "10:00"))
})

test("adultos MJS usa hora distinta para Mar/Jue y para Sábado", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJS", hours: { weekday: "09:00-10:00", saturday: "06:00-07:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    const byDay = new Map(result.selection.sessions.map((s) => [s.weekday, `${s.start}-${s.end}`]))
    assert.equal(byDay.get(2), "09:00-10:00") // Mar
    assert.equal(byDay.get(4), "09:00-10:00") // Jue
    assert.equal(byDay.get(6), "06:00-07:00") // Sáb (solo 6-7 / 7-8 en CM adultos)
})

test("niños CM tienen franjas de tarde distintas a adultos", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    // 3-4pm es válido para niños, no para adultos
    assert.equal(
        validateMembershipScheduleSelection(profile, { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } }, "01").ok,
        true
    )
    assert.equal(
        validateMembershipScheduleSelection(profile, { category: "ADULTOS", frequency: "LMV", hours: { main: "15:00-16:00" } }, "01").ok,
        false
    )
})

test("PLATA (LV) expande a Lun-Vie con una sola hora", () => {
    const profile = getMembershipScheduleProfile("01", "PLATA")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "LV", hours: { main: "08:00-09:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
        result.selection.sessions.map((s) => s.weekday).sort(),
        [1, 2, 3, 4, 5]
    )
})

test("rechaza frecuencia ausente o no soportada por la categoría", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    assert.equal(validateMembershipScheduleSelection(profile, { category: "ADULTOS", hours: {} }, "01").ok, false)
    assert.equal(
        validateMembershipScheduleSelection(profile, { category: "ADULTOS", frequency: "LV", hours: { main: "09:00-10:00" } }, "01").ok,
        false
    )
})

test("rechaza MJS sin la hora del sábado", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    const r = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJS", hours: { weekday: "09:00-10:00" } },
        "01"
    )
    assert.equal(r.ok, false)
})

test("VIDENA adultos M-J-S: Mar/Jue son horas de adulto y el sábado es 6–8am", () => {
    const profile = getMembershipScheduleProfile("03", "BRONCE")!
    // Mar/Jue por la mañana + sábado 6–8am → válido.
    const ok = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJS", hours: { weekday: "07:00-08:00", saturday: "06:00-07:00" } },
        "03"
    )
    assert.equal(ok.ok, true)
    // La tarde (3–7pm) es franja de niños: rechazada para adultos.
    const tarde = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJS", hours: { weekday: "16:00-17:00", saturday: "06:00-07:00" } },
        "03"
    )
    assert.equal(tarde.ok, false)
    // El sábado de niños (8am–1pm) no aplica a adultos.
    const satKids = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJS", hours: { weekday: "07:00-08:00", saturday: "08:00-09:00" } },
        "03"
    )
    assert.equal(satKids.ok, false)
})

test("VIDENA niños M-J-S: tarde Mar/Jue (3–7pm) + sábado 8am–1pm", () => {
    const profile = getMembershipScheduleProfile("03", "BRONCE")!
    const ok = validateMembershipScheduleSelection(
        profile,
        { category: "NINOS", frequency: "MJS", hours: { weekday: "16:00-17:00", saturday: "12:00-13:00" } },
        "03"
    )
    assert.equal(ok.ok, true)
    // El sábado de adultos (6–8am) no aplica a niños.
    const satAdult = validateMembershipScheduleSelection(
        profile,
        { category: "NINOS", frequency: "MJS", hours: { weekday: "16:00-17:00", saturday: "06:00-07:00" } },
        "03"
    )
    assert.equal(satAdult.ok, false)
})

// ── BRONCE 2x (martes y jueves, frecuencia fija) ───────────────────────────────

test("BRONCE_2X es frecuencia fija (MJ) con ambas categorías en ambas sedes", () => {
    for (const sede of ["01", "03"]) {
        const profile = getMembershipScheduleProfile(sede, "BRONCE_2X")!
        assert.ok(profile, `BRONCE_2X debe existir en sede ${sede}`)
        assert.equal(profile.planMode, "FIXED_FREQUENCY")
        assert.deepEqual(profile.categories.map((c) => c.id).sort(), ["ADULTOS", "NINOS"])
        for (const cat of profile.categories) {
            assert.deepEqual(cat.frequencies.map((f) => f.id), ["MJ"])
        }
    }
})

test("BRONCE_2X adultos expande solo a Mar y Jue con la misma hora", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE_2X")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJ", hours: { main: "09:00-10:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
        result.selection.sessions.map((s) => s.weekday).sort(),
        [2, 4]
    )
    assert.ok(result.selection.sessions.every((s) => s.start === "09:00" && s.end === "10:00"))
})

test("BRONCE_2X reusa las horas Mar/Jue del interdiario y rechaza horas fuera del catálogo", () => {
    // VIDENA adultos Mar/Jue: 07:00-08:00 (mañana) es válido (igual que MJS weekday).
    const vid = getMembershipScheduleProfile("03", "BRONCE_2X")!
    assert.equal(
        validateMembershipScheduleSelection(vid, { category: "ADULTOS", frequency: "MJ", hours: { main: "07:00-08:00" } }, "03").ok,
        true
    )
    // VIDENA adultos: 16:00-17:00 es franja de niños (tarde) → rechazo.
    assert.equal(
        validateMembershipScheduleSelection(vid, { category: "ADULTOS", frequency: "MJ", hours: { main: "16:00-17:00" } }, "03").ok,
        false
    )
    // CM adultos: 15:00-16:00 NO está en su catálogo (es franja de niños) → rechazo.
    const cm = getMembershipScheduleProfile("01", "BRONCE_2X")!
    assert.equal(
        validateMembershipScheduleSelection(cm, { category: "ADULTOS", frequency: "MJ", hours: { main: "15:00-16:00" } }, "01").ok,
        false
    )
})

test("BRONCE_2X: el escáner solo acepta martes y jueves", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE_2X")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "ADULTOS", frequency: "MJ", hours: { main: "09:00-10:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    const sessions = result.selection.sessions
    // Martes (2) y Jueves (4) dentro de la franja → ok.
    assert.equal(matchMembershipSession(sessions, 2, "09:30").ok, true)
    assert.equal(matchMembershipSession(sessions, 4, "09:30").ok, true)
    // Resto de días → WRONG_DAY.
    for (const wd of [1, 3, 5, 6, 0]) {
        const m = matchMembershipSession(sessions, wd, "09:30")
        assert.equal(m.ok, false)
        if (!m.ok) assert.equal(m.reason, "WRONG_DAY")
    }
    // Martes fuera de hora → WRONG_TIME.
    const late = matchMembershipSession(sessions, 2, "12:00")
    assert.equal(late.ok, false)
    if (!late.ok) assert.equal(late.reason, "WRONG_TIME")
})

// ── Round-trip de la selección guardada ────────────────────────────────────────

test("parseMembershipScheduleSelection re-hidrata lo guardado (con categoría)", () => {
    const profile = getMembershipScheduleProfile("01", "BRONCE")!
    const result = validateMembershipScheduleSelection(
        profile,
        { category: "NINOS", frequency: "MJS", hours: { weekday: "15:00-16:00", saturday: "08:00-09:00" } },
        "01"
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    const json = JSON.parse(JSON.stringify(result.selection))
    const parsed = parseMembershipScheduleSelection(json)
    assert.ok(parsed)
    assert.equal(parsed!.category, "NINOS")
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
    assert.equal(matchMembershipSession(SESSIONS, 1, "09:30").ok, true)
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
    assert.equal(matchMembershipSession(SESSIONS, 1, "08:50").ok, true)
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

// ── Horario efectivo por mes (cambio mensual) ──────────────────────────────────

const makeSel = (tag: string): MembershipScheduleSelection => ({
    profileKey: tag,
    sucursalCode: "01",
    category: "ADULTOS",
    categoryLabel: "Adultos",
    frequency: "LMV",
    frequencyLabel: tag,
    sessions: [{ weekday: 1, start: "07:00", end: "08:00" }],
    groups: [{ id: "g1", label: "L-M-V", weekdays: [1, 3, 5], start: "07:00", end: "08:00" }],
})

test("efectivo: sin overrides devuelve el base en cualquier mes", () => {
    const base = makeSel("base")
    assert.equal(getEffectiveMembershipSchedule(base, [], 0)?.profileKey, "base")
    assert.equal(getEffectiveMembershipSchedule(base, [], 7)?.profileKey, "base")
})

test("efectivo: override en mes 2 rige 2 y 3, no 0 ni 1 (hereda el anterior)", () => {
    const base = makeSel("base")
    const ov = [{ monthIndex: 2, selection: makeSel("m2") }]
    assert.equal(getEffectiveMembershipSchedule(base, ov, 0)?.profileKey, "base")
    assert.equal(getEffectiveMembershipSchedule(base, ov, 1)?.profileKey, "base")
    assert.equal(getEffectiveMembershipSchedule(base, ov, 2)?.profileKey, "m2")
    assert.equal(getEffectiveMembershipSchedule(base, ov, 3)?.profileKey, "m2")
})

test("efectivo: con varios cambios toma el más reciente ≤ mes", () => {
    const base = makeSel("base")
    const ov = [
        { monthIndex: 4, selection: makeSel("m4") },
        { monthIndex: 2, selection: makeSel("m2") },
    ]
    assert.equal(getEffectiveMembershipSchedule(base, ov, 3)?.profileKey, "m2")
    assert.equal(getEffectiveMembershipSchedule(base, ov, 4)?.profileKey, "m4")
    assert.equal(getEffectiveMembershipSchedule(base, ov, 12)?.profileKey, "m4")
})

test("efectivo: override con selección null se ignora (hereda)", () => {
    const base = makeSel("base")
    const ov = [{ monthIndex: 2, selection: null }]
    assert.equal(getEffectiveMembershipSchedule(base, ov, 3)?.profileKey, "base")
})

test("efectivo: base null y sin overrides devuelve null", () => {
    assert.equal(getEffectiveMembershipSchedule(null, [], 0), null)
})

test("scheduleSelectionToInput mapea categoría/frecuencia/horas", () => {
    const input = scheduleSelectionToInput(makeSel("x"))
    assert.equal(input.category, "ADULTOS")
    assert.equal(input.frequency, "LMV")
    assert.equal(input.hours?.["g1"], "07:00-08:00")
})

test("formatScheduleSummary incluye la frecuencia y la franja", () => {
    const s = formatScheduleSummary(makeSel("Interdiario"))
    assert.match(s, /Interdiario/)
    assert.match(s, /7:00/)
    assert.equal(formatScheduleSummary(null), "—")
})
