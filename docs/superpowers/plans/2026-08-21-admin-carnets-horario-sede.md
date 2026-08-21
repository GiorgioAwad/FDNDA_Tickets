# Gestion de horario y sede de carnets desde el admin — Plan de implementacion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin diagnostique un carnet de membresia y le corrija horario o sede desde el panel, con las mismas guardas que hoy protegen los scripts y dejando rastro auditable.

**Architecture:** Toda la logica de decision vive en dos modulos PUROS de `src/lib/` (sin Prisma ni env), testeados con `node:test` como el resto del proyecto. Las rutas de API leen un snapshot plano de la BD, se lo pasan al planificador, y ejecutan mecanicamente las escrituras que este devuelve — replanificando dentro de la transaccion antes de escribir. La UI es una ficha por carnet mas una vista de ocupacion por evento.

**Tech Stack:** Next.js App Router (rutas `nodejs`, `force-dynamic`), Prisma, React con `"use client"`, componentes de `src/components/ui/`, iconos `lucide-react`, tests con `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-carnets-horario-sede-design.md`

## Global Constraints

- Rama de trabajo: `feat/admin-carnets-horario-sede` (ya creada desde `origin/staging`).
- Rol requerido en toda ruta nueva: `UserRole.ADMIN`, con el patron ya usado en `src/app/api/admin/memberships/route.ts`: `async function requireAdmin() { const user = await getCurrentUser(); return user?.role === UserRole.ADMIN }` y respuesta `NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })`.
- Toda ruta de API nueva declara `export const dynamic = "force-dynamic"` y `export const runtime = "nodejs"`.
- Los modulos de `src/lib/` que contengan logica de decision son PUROS: no importan `@/lib/prisma`, no leen `process.env`, no llaman `new Date()` sin recibir la fecha por parametro. El dia de hoy siempre entra como parametro `today: string` en formato `"YYYY-MM-DD"`, calculado por el llamador con `getTodayDateString()` de `@/lib/qr` (que resuelve en `America/Lima`, no en UTC).
- Comentarios y textos de UI en espanol. Los mensajes de bloqueo se muestran al admin tal cual los devuelve el planificador.
- Formato del codigo existente: 4 espacios de indentacion, sin punto y coma final, comillas dobles.
- Los scripts `scripts/set-membership-schedule.ts`, `scripts/change-academia-schedule.ts` y `scripts/reassign-membership-sites.ts` NO se borran: siguen siendo la salida para los casos que el panel bloquea a proposito.
- Comando de tests: `npx tsx --test "src/lib/*.test.ts"`. Baseline al 2026-08-21: 167 tests en verde.
- Cada tarea termina con commit. Mensajes en espanol, en imperativo, con prefijo `feat:` / `test:` / `refactor:`.

---

### Task 1: Modelo de auditoria, migracion y script de tests

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_membership_admin_changes/migration.sql` (lo genera Prisma)
- Modify: `package.json`

**Interfaces:**
- Consumes: nada.
- Produces: modelo `MembershipAdminChange` y enum `MembershipChangeKind` disponibles en `@prisma/client`. Script `npm test`.

- [ ] **Step 1: Agregar el script de tests a `package.json`**

En el bloque `"scripts"`, despues de `"lint": "eslint",`, agregar:

```json
    "test": "tsx --test \"src/lib/*.test.ts\"",
```

- [ ] **Step 2: Verificar el baseline verde**

Run: `npm test`
Expected: `# pass 167`, `# fail 0`.

- [ ] **Step 3: Agregar el enum y el modelo al schema**

En `prisma/schema.prisma`, al final del archivo:

```prisma
// ==================== AUDITORIA DE CORRECCIONES DE MEMBRESIA ====================

enum MembershipChangeKind {
  SCHEDULE // horario semanal base (CM 01 / VIDENA 03)
  TRANSFER // movido de TicketType: mismo evento = horario VMT, otro = sede
}

// Rastro de las correcciones administrativas de horario/sede hechas desde el
// panel. onDelete: Restrict a proposito — el resto de relaciones de Ticket usan
// Cascade porque son estado vigente; esto es historia y no se borra.
model MembershipAdminChange {
  id        String               @id @default(cuid())
  ticketId  String
  actorId   String
  kind      MembershipChangeKind
  reason    String               @db.Text
  before    Json
  after     Json
  createdAt DateTime             @default(now())

  ticket Ticket @relation(fields: [ticketId], references: [id], onDelete: Restrict)
  actor  User   @relation(fields: [actorId], references: [id])

  @@index([ticketId, createdAt])
  @@map("membership_admin_changes")
}
```

- [ ] **Step 4: Declarar las relaciones inversas**

En `model Ticket`, junto a las otras relaciones (despues de la linea `membershipGuestPasses MembershipGuestPass[]`), agregar:

```prisma
  // Correcciones administrativas de horario/sede hechas desde el panel.
  adminChanges MembershipAdminChange[]
```

En `model User`, junto a sus relaciones, agregar:

```prisma
  membershipAdminChanges MembershipAdminChange[]
```

- [ ] **Step 5: Validar el schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`.

Si falla por relacion inversa faltante, el mensaje nombra el modelo — agregar el campo que pida y repetir.

- [ ] **Step 6: Generar la migracion**

Run: `npx prisma migrate dev --name membership_admin_changes --create-only`
Expected: crea `prisma/migrations/<timestamp>_membership_admin_changes/migration.sql`.

`--create-only` a proposito: se revisa el SQL antes de aplicarlo. Abrir el archivo y confirmar que crea el tipo `MembershipChangeKind`, la tabla `membership_admin_changes`, el indice `(ticketId, createdAt)` y las dos foreign keys — la de `ticketId` con `ON DELETE RESTRICT`.

- [ ] **Step 7: Aplicar la migracion en local y regenerar el cliente**

Run: `npx prisma migrate dev`
Expected: aplica la migracion y corre `prisma generate`.

- [ ] **Step 8: Confirmar que los tests siguen verdes**

Run: `npm test`
Expected: `# pass 167`, `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations package.json
git commit -m "feat(carnets): agrega modelo de auditoria de correcciones de membresia"
```

---

### Task 2: Modulo puro — snapshot y planificador de cambio de horario

**Files:**
- Create: `src/lib/membership-transfer.ts`
- Create: `src/lib/membership-transfer.test.ts`

**Interfaces:**
- Consumes: de `@/lib/membership-schedule`: `getMembershipScheduleProfile(sucursalCode, scheduleKey)`, `validateMembershipScheduleSelection(profile, input, sucursalCode)`, `parseMembershipScheduleSelection(value)`, `formatScheduleSummary(selection)`, y los tipos `MembershipScheduleInput`, `MembershipScheduleSelection`.
- Produces: los tipos `MembershipTicketTypeSnapshot`, `MembershipInvoiceSnapshot`, `MembershipChangeSnapshot`, `MembershipChangeIntent`, `MembershipChangeBlocker`, `MembershipChangeBlockerCode`, `MembershipChangeState`, `MembershipChangeWrites`, `MembershipChangePlan`; y las funciones `planMembershipChange(snapshot, intent)`, `buildMembershipChangeFingerprint(snapshot)`, `getAttendeeMatricula(attendeeData)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/membership-transfer.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
    planMembershipChange,
    buildMembershipChangeFingerprint,
    getAttendeeMatricula,
    type MembershipChangeSnapshot,
    type MembershipTicketTypeSnapshot,
} from "@/lib/membership-transfer"

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Horario BRONCE ninos L-M-V 15:00-16:00 en VIDENA (03). Coincide con el caso
// real de scripts/set-membership-schedule.ts.
const VIDENA_BRONCE_TYPE: MembershipTicketTypeSnapshot = {
    id: "tt-videna-bronce",
    eventId: "ev-videna",
    sucursalCode: "03",
    name: "MEMBRESIA SEMESTRAL BRONCE",
    price: 1090,
    capacity: 0,
    sold: 40,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: "BRONCE",
}

function baseSnapshot(overrides: Partial<MembershipChangeSnapshot> = {}): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-1",
            status: "ACTIVE",
            eventId: "ev-videna",
            ticketTypeId: "tt-videna-bronce",
            membershipSchedule: {
                profileKey: "BRONCE",
                sucursalCode: "03",
                category: "NINOS",
                categoryLabel: "Ninos",
                frequency: "LMV",
                frequencyLabel: "Lun - Mie - Vie",
                sessions: [
                    { weekday: 1, start: "16:00", end: "17:00" },
                    { weekday: 3, start: "16:00", end: "17:00" },
                    { weekday: 5, start: "16:00", end: "17:00" },
                ],
                groups: [
                    { id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5], start: "16:00", end: "17:00" },
                ],
            },
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-1",
            status: "PAID",
            provider: "IZIPAY",
            invoices: [
                {
                    id: "inv-1",
                    status: "ISSUED",
                    servilexGroupKey: "AC:03:matricula:2299469",
                    invoiceNumber: "B001-123",
                },
            ],
        },
        orderItem: {
            id: "oi-1",
            ticketTypeId: "tt-videna-bronce",
            attendeeData: [{ matricula: "2299469", name: "Aylin Oriana Lachira Panta" }],
        },
        sourceType: VIDENA_BRONCE_TYPE,
        ...overrides,
    }
}

// ── getAttendeeMatricula ──────────────────────────────────────────────────────

test("getAttendeeMatricula lee la matricula del unico asistente", () => {
    assert.equal(getAttendeeMatricula([{ matricula: "2299469" }]), "2299469")
})

test("getAttendeeMatricula devuelve null si hay mas de un asistente", () => {
    assert.equal(getAttendeeMatricula([{ matricula: "1" }, { matricula: "2" }]), null)
})

test("getAttendeeMatricula devuelve null si no es un arreglo", () => {
    assert.equal(getAttendeeMatricula({ matricula: "1" }), null)
})

test("getAttendeeMatricula devuelve null si el asistente no tiene matricula", () => {
    assert.equal(getAttendeeMatricula([{ name: "Sin matricula" }]), null)
})

// ── SCHEDULE: camino feliz ────────────────────────────────────────────────────

test("SCHEDULE cambia la hora del grupo y produce las sesiones nuevas", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "SCHEDULE")
    assert.deepEqual(plan.before.sessions, ["1:16:00-17:00", "3:16:00-17:00", "5:16:00-17:00"])
    assert.deepEqual(plan.after.sessions, ["1:15:00-16:00", "3:15:00-16:00", "5:15:00-16:00"])
})

test("SCHEDULE escribe el horario en el ticket y en el attendeeData", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    const selection = plan.writes.ticket.membershipSchedule
    assert.ok(selection)
    assert.equal(selection.sessions.length, 3)
    // La copia del checkout va en sincronia: editar solo una de las dos no
    // cambia nada en la puerta.
    const attendees = plan.writes.orderItem.attendeeData as Array<Record<string, unknown>>
    assert.equal(attendees.length, 1)
    assert.equal(attendees[0].matricula, "2299469")
    assert.deepEqual(attendees[0].membershipSchedule, selection)
    // SCHEDULE no mueve cupo ni tipo.
    assert.equal(plan.writes.soldDecrementTypeId, undefined)
    assert.equal(plan.writes.soldIncrementTypeId, undefined)
    assert.equal(plan.writes.ticket.ticketTypeId, undefined)
})

// ── SCHEDULE: bloqueos ────────────────────────────────────────────────────────

function blockerCodes(snapshot: MembershipChangeSnapshot) {
    const plan = planMembershipChange(snapshot, {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return []
    return plan.blockers.map((b) => b.code)
}

test("SCHEDULE bloquea si el carnet no esta ACTIVE", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.status = "CANCELLED"
    assert.ok(blockerCodes(snapshot).includes("TICKET_NOT_ACTIVE"))
})

test("SCHEDULE bloquea si la orden no esta PAID", () => {
    const snapshot = baseSnapshot()
    snapshot.order.status = "PENDING"
    assert.ok(blockerCodes(snapshot).includes("ORDER_NOT_PAID"))
})

test("SCHEDULE bloquea si el carnet tiene horarios mensuales definidos", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.monthlyScheduleCount = 2
    assert.ok(blockerCodes(snapshot).includes("HAS_MONTHLY_SCHEDULES"))
})

test("SCHEDULE bloquea si el attendeeData trae mas de una persona", () => {
    const snapshot = baseSnapshot()
    snapshot.orderItem.attendeeData = [{ matricula: "1" }, { matricula: "2" }]
    assert.ok(blockerCodes(snapshot).includes("ATTENDEE_DATA_INVALID"))
})

test("SCHEDULE bloquea en una sede sin catalogo de horarios", () => {
    const snapshot = baseSnapshot()
    snapshot.sourceType = { ...VIDENA_BRONCE_TYPE, sucursalCode: "04" }
    assert.ok(blockerCodes(snapshot).includes("NO_SCHEDULE_PROFILE"))
})

test("SCHEDULE bloquea si la hora elegida no existe en el catalogo", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "23:00-00:00" } },
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.ok(plan.blockers.some((b) => b.code === "SCHEDULE_INVALID"))
})

test("SCHEDULE acumula todos los bloqueos, no solo el primero", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.status = "EXPIRED"
    snapshot.order.status = "PENDING"
    const codes = blockerCodes(snapshot)
    assert.ok(codes.includes("TICKET_NOT_ACTIVE"))
    assert.ok(codes.includes("ORDER_NOT_PAID"))
})

// ── Fingerprint ───────────────────────────────────────────────────────────────

test("el fingerprint es estable para el mismo estado", () => {
    assert.equal(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(baseSnapshot())
    )
})

test("el fingerprint cambia si el horario cambia", () => {
    const moved = baseSnapshot()
    moved.ticket.membershipSchedule = {
        ...(moved.ticket.membershipSchedule as Record<string, unknown>),
        sessions: [{ weekday: 1, start: "07:00", end: "08:00" }],
        groups: [{ id: "main", label: "Lun", weekdays: [1], start: "07:00", end: "08:00" }],
    }
    assert.notEqual(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(moved)
    )
})

test("el fingerprint cambia si el contador sold del tipo origen cambia", () => {
    const sold = baseSnapshot()
    sold.sourceType = { ...VIDENA_BRONCE_TYPE, sold: 41 }
    assert.notEqual(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(sold)
    )
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx --test src/lib/membership-transfer.test.ts`
Expected: FAIL — `Cannot find module '@/lib/membership-transfer'`.

- [ ] **Step 3: Escribir la implementacion minima**

Crear `src/lib/membership-transfer.ts`:

```ts
/**
 * Planificador de correcciones administrativas de membresias: cambio de horario
 * semanal y movimiento de carnet entre TicketTypes (horario VMT / cambio de
 * sede).
 *
 * Modulo PURO (sin Prisma ni env): recibe un snapshot de datos planos y la
 * intencion, y devuelve un plan con bloqueos y escrituras. La ruta de API lee
 * el snapshot, planifica, y —al confirmar— vuelve a leer y replanificar DENTRO
 * de la transaccion antes de escribir. Ahi reviven los `assertEqual` de los
 * scripts que este modulo reemplaza: dejan de ser "esperado X, recibido Y" y
 * pasan a ser "este carnet cambio desde que abriste la pantalla".
 *
 * Reemplaza la logica de decision de:
 *   · scripts/set-membership-schedule.ts   (SCHEDULE)
 *   · scripts/change-academia-schedule.ts  (TRANSFER, mismo evento)
 *   · scripts/reassign-membership-sites.ts (TRANSFER, otro evento)
 */
import {
    formatScheduleSummary,
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    validateMembershipScheduleSelection,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface MembershipTicketTypeSnapshot {
    id: string
    eventId: string
    sucursalCode: string | null
    name: string
    price: number
    capacity: number
    sold: number
    isActive: boolean
    isPackage: boolean
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
}

export interface MembershipInvoiceSnapshot {
    id: string
    status: string
    servilexGroupKey: string
    invoiceNumber: string | null
}

export interface MembershipChangeSnapshot {
    ticket: {
        id: string
        status: string
        eventId: string
        ticketTypeId: string
        membershipSchedule: unknown
        /** Filas de MembershipMonthlySchedule. > 0 bloquea: mover la base dejaria
         *  esos meses apuntando a un catalogo que ya no aplica. */
        monthlyScheduleCount: number
    }
    order: {
        id: string
        status: string
        provider: string
        invoices: MembershipInvoiceSnapshot[]
    }
    orderItem: {
        id: string
        ticketTypeId: string
        attendeeData: unknown
    }
    sourceType: MembershipTicketTypeSnapshot
}

export type MembershipChangeIntent =
    | { kind: "SCHEDULE"; scheduleInput: MembershipScheduleInput }
    | {
          kind: "TRANSFER"
          targetType: MembershipTicketTypeSnapshot
          /** Requerido cuando el destino tiene catalogo y el horario actual no
           *  existe alla. Si se omite y el actual si existe, se conserva. */
          scheduleInput?: MembershipScheduleInput | null
      }

// ── Resultado ─────────────────────────────────────────────────────────────────

export type MembershipChangeBlockerCode =
    | "TICKET_NOT_ACTIVE"
    | "ORDER_NOT_PAID"
    | "ATTENDEE_DATA_INVALID"
    | "HAS_MONTHLY_SCHEDULES"
    | "NO_SCHEDULE_PROFILE"
    | "SCHEDULE_INVALID"
    | "SCHEDULE_REQUIRED"
    | "TARGET_SAME_AS_SOURCE"
    | "TARGET_INACTIVE"
    | "TARGET_FULL"
    | "SOURCE_SOLD_EMPTY"
    | "TARGET_NOT_EQUIVALENT"
    | "INVOICE_MISSING"
    | "ORDER_PROVIDER_MOCK"

export interface MembershipChangeBlocker {
    code: MembershipChangeBlockerCode
    /** Texto en espanol que la UI muestra tal cual. */
    message: string
}

export interface MembershipChangeState {
    eventId: string
    ticketTypeId: string
    ticketTypeName: string
    sucursalCode: string | null
    /** "1:15:00-16:00" por sesion, ordenado — forma comparable de un horario. */
    sessions: string[]
    scheduleSummary: string
    sourceSold: number
    targetSold: number | null
}

export interface MembershipChangeWrites {
    ticket: {
        eventId?: string
        ticketTypeId?: string
        membershipSchedule?: MembershipScheduleSelection
    }
    orderItem: {
        ticketTypeId?: string
        attendeeData?: unknown[]
    }
    soldDecrementTypeId?: string
    soldIncrementTypeId?: string
}

export type MembershipChangePlan =
    | { ok: false; blockers: MembershipChangeBlocker[] }
    | {
          ok: true
          kind: "SCHEDULE" | "TRANSFER"
          /** Etiqueta para la UI y el historial. */
          label: string
          before: MembershipChangeState
          after: MembershipChangeState
          writes: MembershipChangeWrites
          fingerprint: string
      }

// ── Helpers ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/**
 * Matricula del unico asistente del item. Es lo que liga el carnet con su
 * comprobante ABIO. Devuelve null si el item no trae exactamente una persona
 * con matricula — en los scripts esto va hardcodeado por caso.
 */
export function getAttendeeMatricula(attendeeData: unknown): string | null {
    if (!Array.isArray(attendeeData) || attendeeData.length !== 1) return null
    const matricula = asRecord(attendeeData[0]).matricula
    if (typeof matricula !== "string" && typeof matricula !== "number") return null
    const text = String(matricula).trim()
    return text.length > 0 ? text : null
}

function normalizeSessions(value: unknown): string[] {
    const sessions = parseMembershipScheduleSelection(value)?.sessions ?? []
    return sessions.map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

function sessionKeys(selection: MembershipScheduleSelection | null): string[] {
    return (selection?.sessions ?? []).map((s) => `${s.weekday}:${s.start}-${s.end}`).sort()
}

/**
 * Huella del estado que el plan da por cierto. La ruta compara la huella de la
 * vista previa con la recalculada dentro de la transaccion: si difieren, el
 * carnet cambio entremedio y se aborta en vez de escribir.
 */
export function buildMembershipChangeFingerprint(snapshot: MembershipChangeSnapshot): string {
    return JSON.stringify({
        t: snapshot.ticket.status,
        e: snapshot.ticket.eventId,
        tt: snapshot.ticket.ticketTypeId,
        s: normalizeSessions(snapshot.ticket.membershipSchedule),
        m: snapshot.ticket.monthlyScheduleCount,
        o: snapshot.order.status,
        p: snapshot.order.provider,
        oi: snapshot.orderItem.ticketTypeId,
        sold: snapshot.sourceType.sold,
    })
}

function commonBlockers(snapshot: MembershipChangeSnapshot): MembershipChangeBlocker[] {
    const blockers: MembershipChangeBlocker[] = []
    if (snapshot.ticket.status !== "ACTIVE") {
        blockers.push({
            code: "TICKET_NOT_ACTIVE",
            message: `El carnet esta ${snapshot.ticket.status}, no ACTIVE.`,
        })
    }
    if (snapshot.order.status !== "PAID") {
        blockers.push({
            code: "ORDER_NOT_PAID",
            message: `La orden esta ${snapshot.order.status}, no PAID.`,
        })
    }
    if (snapshot.ticket.monthlyScheduleCount > 0) {
        blockers.push({
            code: "HAS_MONTHLY_SCHEDULES",
            message:
                "El carnet tiene horarios definidos por mes. Cambiar el horario base dejaria esos meses apuntando a un catalogo que ya no aplica: requiere revision manual por script.",
        })
    }
    if (getAttendeeMatricula(snapshot.orderItem.attendeeData) === null) {
        blockers.push({
            code: "ATTENDEE_DATA_INVALID",
            message:
                "El item de la orden no trae exactamente una persona con matricula. Sin matricula no se puede ligar el carnet con su comprobante.",
        })
    }
    return blockers
}

function buildState(
    type: MembershipTicketTypeSnapshot,
    selection: MembershipScheduleSelection | null,
    sessions: string[],
    sourceSold: number,
    targetSold: number | null
): MembershipChangeState {
    return {
        eventId: type.eventId,
        ticketTypeId: type.id,
        ticketTypeName: type.name,
        sucursalCode: type.sucursalCode,
        sessions,
        scheduleSummary: formatScheduleSummary(selection),
        sourceSold,
        targetSold,
    }
}

// ── Planificador ──────────────────────────────────────────────────────────────

export function planMembershipChange(
    snapshot: MembershipChangeSnapshot,
    intent: MembershipChangeIntent
): MembershipChangePlan {
    if (intent.kind === "SCHEDULE") return planScheduleChange(snapshot, intent.scheduleInput)
    return planTransfer(snapshot, intent.targetType, intent.scheduleInput ?? null)
}

function planScheduleChange(
    snapshot: MembershipChangeSnapshot,
    scheduleInput: MembershipScheduleInput
): MembershipChangePlan {
    const blockers = commonBlockers(snapshot)
    const { sourceType } = snapshot

    const profile = getMembershipScheduleProfile(
        sourceType.sucursalCode,
        sourceType.membershipScheduleKey
    )
    if (!profile) {
        blockers.push({
            code: "NO_SCHEDULE_PROFILE",
            message:
                "Esta sede no tiene catalogo de horarios semanales. Si el horario es el tipo de entrada (VMT), usa el cambio de tipo.",
        })
        return { ok: false, blockers }
    }

    const result = validateMembershipScheduleSelection(
        profile,
        scheduleInput,
        sourceType.sucursalCode ?? ""
    )
    if (!result.ok) {
        blockers.push({ code: "SCHEDULE_INVALID", message: result.error })
        return { ok: false, blockers }
    }
    if (blockers.length > 0) return { ok: false, blockers }

    const beforeSelection = parseMembershipScheduleSelection(snapshot.ticket.membershipSchedule)
    const attendee = asRecord((snapshot.orderItem.attendeeData as unknown[])[0])

    return {
        ok: true,
        kind: "SCHEDULE",
        label: "Cambio de horario semanal",
        before: buildState(
            sourceType,
            beforeSelection,
            normalizeSessions(snapshot.ticket.membershipSchedule),
            sourceType.sold,
            null
        ),
        after: buildState(sourceType, result.selection, sessionKeys(result.selection), sourceType.sold, null),
        writes: {
            ticket: { membershipSchedule: result.selection },
            // Las dos escrituras van juntas: Ticket.membershipSchedule es lo que
            // valida el escaner, OrderItem.attendeeData es el snapshot del
            // checkout. Editar solo el segundo no cambia nada en la puerta.
            orderItem: {
                attendeeData: [{ ...attendee, membershipSchedule: result.selection }],
            },
        },
        fingerprint: buildMembershipChangeFingerprint(snapshot),
    }
}

// Andamio: la Task 3 lo reemplaza por la implementacion real. Lanza a
// proposito en vez de devolver un plan vacio — un `{ ok: false, blockers: [] }`
// se veria en la UI como "no se puede, sin motivo" y podria pasar inadvertido
// si la Task 3 nunca aterriza.
function planTransfer(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot,
    scheduleInput: MembershipScheduleInput | null
): MembershipChangePlan {
    void snapshot
    void targetType
    void scheduleInput
    throw new Error("planTransfer aun no esta implementado")
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx tsx --test src/lib/membership-transfer.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Confirmar que no rompi nada**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-transfer.ts src/lib/membership-transfer.test.ts
git commit -m "feat(carnets): agrega planificador puro de cambio de horario"
```

---

### Task 3: Modulo puro — planificador de movimiento entre TicketTypes

**Files:**
- Modify: `src/lib/membership-transfer.ts` (reemplaza el `planTransfer` provisional)
- Modify: `src/lib/membership-transfer.test.ts` (agrega la seccion TRANSFER)

**Interfaces:**
- Consumes: todo lo definido en Task 2, mas `getAcMatriculaFromGroupKey(groupKey)` de `@/lib/servilex-invoice-guard`.
- Produces: `planMembershipChange` con `kind: "TRANSFER"` funcional. Sin firmas nuevas.

- [ ] **Step 1: Escribir los tests que fallan**

Primero, agregar el import del tipo de entrada del selector al inicio de `src/lib/membership-transfer.test.ts`, debajo del import existente:

```ts
import type { MembershipScheduleInput } from "@/lib/membership-schedule"
```

Luego agregar al final del mismo archivo:

```ts
// ── TRANSFER ──────────────────────────────────────────────────────────────────

// Campo de Marte (01), PLATA L-V. Equivalente en todo salvo la sede: es el
// destino valido de un carnet PLATA de VIDENA.
const CDM_PLATA_TYPE: MembershipTicketTypeSnapshot = {
    id: "tt-cdm-plata",
    eventId: "ev-cdm",
    sucursalCode: "01",
    name: "MEMBRESIA SEMESTRAL PLATA",
    price: 1240,
    capacity: 0,
    sold: 10,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 20,
    membershipDurationMonths: 6,
    membershipScheduleKey: "PLATA",
}

const VIDENA_PLATA_TYPE: MembershipTicketTypeSnapshot = {
    ...CDM_PLATA_TYPE,
    id: "tt-videna-plata",
    eventId: "ev-videna",
    sucursalCode: "03",
    sold: 25,
}

/** Caso Jose Vasquez: compro VIDENA, asiste en CDM; L-V 7-8am existe en ambas. */
function plataSnapshot(): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-2",
            status: "ACTIVE",
            eventId: "ev-videna",
            ticketTypeId: "tt-videna-plata",
            membershipSchedule: {
                profileKey: "PLATA",
                sucursalCode: "03",
                category: "ADULTOS",
                categoryLabel: "Adultos",
                frequency: "LV",
                frequencyLabel: "Lun a Vie",
                sessions: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "07:00", end: "08:00" })),
                groups: [
                    { id: "main", label: "Lun a Vie", weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "08:00" },
                ],
            },
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-2",
            status: "PAID",
            provider: "IZIPAY",
            invoices: [
                {
                    id: "inv-2",
                    status: "ISSUED",
                    servilexGroupKey: "AC:03:matricula:7300631",
                    invoiceNumber: "B001-999",
                },
            ],
        },
        orderItem: {
            id: "oi-2",
            ticketTypeId: "tt-videna-plata",
            attendeeData: [{ matricula: "7300631", name: "Jose Francisco Vasquez Hiyo" }],
        },
        sourceType: VIDENA_PLATA_TYPE,
    }
}

function transferPlan(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot = CDM_PLATA_TYPE,
    scheduleInput: MembershipScheduleInput | null = null
) {
    return planMembershipChange(snapshot, { kind: "TRANSFER", targetType, scheduleInput })
}

function transferBlockers(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot = CDM_PLATA_TYPE
) {
    const plan = transferPlan(snapshot, targetType)
    assert.equal(plan.ok, false)
    if (plan.ok) return []
    return plan.blockers.map((b) => b.code)
}

test("TRANSFER entre eventos mueve tipo, evento y cupo", () => {
    const plan = transferPlan(plataSnapshot())
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "TRANSFER")
    assert.equal(plan.label, "Cambio de sede")
    assert.equal(plan.writes.ticket.eventId, "ev-cdm")
    assert.equal(plan.writes.ticket.ticketTypeId, "tt-cdm-plata")
    assert.equal(plan.writes.orderItem.ticketTypeId, "tt-cdm-plata")
    assert.equal(plan.writes.soldDecrementTypeId, "tt-videna-plata")
    assert.equal(plan.writes.soldIncrementTypeId, "tt-cdm-plata")
})

test("TRANSFER reescribe el horario con la sucursal destino", () => {
    const plan = transferPlan(plataSnapshot())
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    // Mismas horas, pero la seleccion queda sellada con la sede nueva.
    assert.equal(plan.writes.ticket.membershipSchedule?.sucursalCode, "01")
    assert.deepEqual(plan.after.sessions, [
        "1:07:00-08:00",
        "2:07:00-08:00",
        "3:07:00-08:00",
        "4:07:00-08:00",
        "5:07:00-08:00",
    ])
})

test("TRANSFER exige horario nuevo si el actual no existe en la sede destino", () => {
    const snapshot = plataSnapshot()
    // 20:00-21:00 no esta en el catalogo PLATA de ninguna sede.
    snapshot.ticket.membershipSchedule = {
        profileKey: "PLATA",
        sucursalCode: "03",
        category: "ADULTOS",
        categoryLabel: "Adultos",
        frequency: "LV",
        frequencyLabel: "Lun a Vie",
        sessions: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "20:00", end: "21:00" })),
        groups: [
            { id: "main", label: "Lun a Vie", weekdays: [1, 2, 3, 4, 5], start: "20:00", end: "21:00" },
        ],
    }
    assert.ok(transferBlockers(snapshot).includes("SCHEDULE_REQUIRED"))
})

test("TRANSFER acepta el horario nuevo cuando se indica", () => {
    const snapshot = plataSnapshot()
    const plan = transferPlan(snapshot, CDM_PLATA_TYPE, {
        category: "ADULTOS",
        frequency: "LV",
        hours: { main: "08:00-09:00" },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.deepEqual(plan.after.sessions, [
        "1:08:00-09:00",
        "2:08:00-09:00",
        "3:08:00-09:00",
        "4:08:00-09:00",
        "5:08:00-09:00",
    ])
})

test("TRANSFER bloquea si el destino cuesta distinto", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, price: 890 }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino tiene otro cupo mensual de clases", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, monthlyClassLimit: 12 }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino dura distinto", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), {
            ...CDM_PLATA_TYPE,
            membershipDurationMonths: 12,
        }).includes("TARGET_NOT_EQUIVALENT")
    )
})

test("TRANSFER bloquea si el destino es paquete y el origen no", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, isPackage: true }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino es de otro plan", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), {
            ...CDM_PLATA_TYPE,
            membershipScheduleKey: "BRONCE",
        }).includes("TARGET_NOT_EQUIVALENT")
    )
})

test("TRANSFER bloquea si el destino esta inactivo", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, isActive: false }).includes(
            "TARGET_INACTIVE"
        )
    )
})

test("TRANSFER bloquea si el destino esta lleno", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, capacity: 10, sold: 10 }).includes(
            "TARGET_FULL"
        )
    )
})

test("TRANSFER permite capacity 0 (sin tope) aunque sold sea alto", () => {
    const plan = transferPlan(plataSnapshot(), { ...CDM_PLATA_TYPE, capacity: 0, sold: 9999 })
    assert.equal(plan.ok, true)
})

test("TRANSFER bloquea si el contador sold del origen ya esta en cero", () => {
    const snapshot = plataSnapshot()
    snapshot.sourceType = { ...VIDENA_PLATA_TYPE, sold: 0 }
    assert.ok(transferBlockers(snapshot).includes("SOURCE_SOLD_EMPTY"))
})

test("TRANSFER bloquea si el destino es el mismo tipo que el origen", () => {
    assert.ok(transferBlockers(plataSnapshot(), VIDENA_PLATA_TYPE).includes("TARGET_SAME_AS_SOURCE"))
})

// ── Comprobante segun el origen de la venta ───────────────────────────────────

test("IZIPAY sin boleta emitida de la matricula bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = []
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("IZIPAY con boleta de OTRA matricula bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = [
        { id: "inv-x", status: "ISSUED", servilexGroupKey: "AC:03:matricula:0000001", invoiceNumber: "B001-1" },
    ]
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("IZIPAY con boleta no emitida bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = [
        { id: "inv-y", status: "PENDING", servilexGroupKey: "AC:03:matricula:7300631", invoiceNumber: null },
    ]
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("PRESENCIAL no consulta comprobantes: en venta presencial no se emite boleta", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "PRESENCIAL"
    snapshot.order.invoices = []
    const plan = transferPlan(snapshot)
    assert.equal(plan.ok, true)
})

test("COURTESY no consulta comprobantes", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "COURTESY"
    snapshot.order.invoices = []
    const plan = transferPlan(snapshot)
    assert.equal(plan.ok, true)
})

test("MOCK bloquea: viene del incidente de pagos simulados en produccion", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "MOCK"
    assert.ok(transferBlockers(snapshot).includes("ORDER_PROVIDER_MOCK"))
})

test("un provider desconocido exige boleta, como IZIPAY", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "PASARELA_NUEVA"
    snapshot.order.invoices = []
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

// ── TRANSFER dentro del mismo evento (VMT) ────────────────────────────────────

const VMT_LMV_4PM: MembershipTicketTypeSnapshot = {
    id: "tt-vmt-lmv-4pm",
    eventId: "ev-vmt",
    sucursalCode: "04",
    name: "LUN - MIE - VIE 4PM A 5PM",
    price: 700,
    capacity: 30,
    sold: 12,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: null,
}

const VMT_MJS_5PM: MembershipTicketTypeSnapshot = {
    ...VMT_LMV_4PM,
    id: "tt-vmt-mjs-5pm",
    name: "MAR - JUE - SAB 5PM A 6PM",
    sold: 8,
}

function vmtSnapshot(): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-3",
            status: "ACTIVE",
            eventId: "ev-vmt",
            ticketTypeId: "tt-vmt-lmv-4pm",
            membershipSchedule: null,
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-3",
            status: "PAID",
            provider: "PRESENCIAL",
            invoices: [],
        },
        orderItem: {
            id: "oi-3",
            ticketTypeId: "tt-vmt-lmv-4pm",
            attendeeData: [{ matricula: "9001122", name: "Alumno VMT" }],
        },
        sourceType: VMT_LMV_4PM,
    }
}

test("TRANSFER dentro del mismo evento se etiqueta como cambio de horario", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.label, "Cambio de horario (la franja es el tipo de entrada)")
    assert.equal(plan.writes.ticket.ticketTypeId, "tt-vmt-mjs-5pm")
    // Mismo evento: no se reescribe eventId.
    assert.equal(plan.writes.ticket.eventId, undefined)
    assert.equal(plan.writes.soldDecrementTypeId, "tt-vmt-lmv-4pm")
    assert.equal(plan.writes.soldIncrementTypeId, "tt-vmt-mjs-5pm")
})

test("TRANSFER en sede sin catalogo no toca membershipSchedule", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.writes.ticket.membershipSchedule, undefined)
    assert.equal(plan.writes.orderItem.attendeeData, undefined)
})

test("TRANSFER refleja los contadores sold de origen y destino en el plan", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.before.sourceSold, 12)
    assert.equal(plan.before.targetSold, 8)
    assert.equal(plan.after.sourceSold, 11)
    assert.equal(plan.after.targetSold, 9)
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx tsx --test src/lib/membership-transfer.test.ts`
Expected: FAIL — los tests de TRANSFER lanzan `planTransfer aun no esta implementado`. Los 16 de la Task 2 siguen pasando.

- [ ] **Step 3: Implementar `planTransfer`**

En `src/lib/membership-transfer.ts`, agregar el import:

```ts
import { getAcMatriculaFromGroupKey } from "@/lib/servilex-invoice-guard"
```

Y reemplazar la funcion `planTransfer` provisional por:

```ts
/**
 * Providers cuyas ordenes NO generan comprobante: la venta se cobro fuera de la
 * web y no se emite boleta. Lista explicita a proposito — agregar una pasarela
 * nueva debe ser anadir una fila aqui, no descubrir el hueco en produccion.
 */
const PROVIDERS_SIN_BOLETA = new Set(["PRESENCIAL", "COURTESY"])

/** Providers que bloquean cualquier correccion. */
const PROVIDERS_BLOQUEADOS = new Set(["MOCK"])

function invoiceBlockers(snapshot: MembershipChangeSnapshot): MembershipChangeBlocker[] {
    const provider = snapshot.order.provider.trim().toUpperCase()

    if (PROVIDERS_BLOQUEADOS.has(provider)) {
        return [
            {
                code: "ORDER_PROVIDER_MOCK",
                message:
                    "La orden es de pagos simulados (MOCK) en produccion. Esa entrada se anula, no se le reasigna sede.",
            },
        ]
    }
    // Venta presencial o cortesia: no se emite boleta. No se consulta nada.
    if (PROVIDERS_SIN_BOLETA.has(provider)) return []

    const matricula = getAttendeeMatricula(snapshot.orderItem.attendeeData)
    if (matricula === null) return [] // ya lo reporta ATTENDEE_DATA_INVALID

    const issued = snapshot.order.invoices.some(
        (invoice) =>
            invoice.status === "ISSUED" &&
            getAcMatriculaFromGroupKey(invoice.servilexGroupKey) === matricula.toUpperCase()
    )
    if (issued) return []

    return [
        {
            code: "INVOICE_MISSING",
            message: `No se encontro boleta emitida para la matricula ${matricula}. Una orden pagada sin boleta significa que la emision ABIO fallo o la matricula no cuadra: eso se arregla antes de mover la sede.`,
        },
    ]
}

/** Campos en los que el tipo destino debe ser identico para no tocar la boleta. */
function equivalenceBlockers(
    source: MembershipTicketTypeSnapshot,
    target: MembershipTicketTypeSnapshot
): MembershipChangeBlocker[] {
    const diffs: string[] = []
    if (source.price !== target.price) diffs.push(`precio (${source.price} vs ${target.price})`)
    if (source.monthlyClassLimit !== target.monthlyClassLimit) {
        diffs.push(`clases al mes (${source.monthlyClassLimit} vs ${target.monthlyClassLimit})`)
    }
    if (source.membershipDurationMonths !== target.membershipDurationMonths) {
        diffs.push(
            `duracion (${source.membershipDurationMonths} vs ${target.membershipDurationMonths})`
        )
    }
    if (source.isPackage !== target.isPackage) diffs.push("modalidad de paquete")
    if (source.membershipScheduleKey !== target.membershipScheduleKey) {
        diffs.push(`plan (${source.membershipScheduleKey} vs ${target.membershipScheduleKey})`)
    }
    if (diffs.length === 0) return []
    return [
        {
            code: "TARGET_NOT_EQUIVALENT",
            message: `El tipo destino no es equivalente al origen en: ${diffs.join(", ")}. La orden y la boleta no se tocan, asi que el destino tiene que valer exactamente lo mismo.`,
        },
    ]
}

function planTransfer(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot,
    scheduleInput: MembershipScheduleInput | null
): MembershipChangePlan {
    const { sourceType } = snapshot
    const blockers = [...commonBlockers(snapshot), ...invoiceBlockers(snapshot)]

    if (targetType.id === sourceType.id) {
        blockers.push({
            code: "TARGET_SAME_AS_SOURCE",
            message: "El tipo destino es el mismo que el actual.",
        })
        return { ok: false, blockers }
    }

    blockers.push(...equivalenceBlockers(sourceType, targetType))

    if (!targetType.isActive) {
        blockers.push({ code: "TARGET_INACTIVE", message: "El tipo destino esta desactivado." })
    }
    if (targetType.capacity !== 0 && targetType.sold + 1 > targetType.capacity) {
        blockers.push({
            code: "TARGET_FULL",
            message: `El tipo destino no tiene cupo: ${targetType.sold} vendidos de ${targetType.capacity}.`,
        })
    }
    if (sourceType.sold < 1) {
        blockers.push({
            code: "SOURCE_SOLD_EMPTY",
            message: "El contador de vendidos del tipo origen ya esta en cero; descontar lo dejaria negativo.",
        })
    }

    // Horario: solo aplica si la sede destino tiene catalogo. En VMT la franja
    // ES el tipo, asi que no hay nada que reescribir.
    const targetProfile = getMembershipScheduleProfile(
        targetType.sucursalCode,
        targetType.membershipScheduleKey
    )
    const beforeSelection = parseMembershipScheduleSelection(snapshot.ticket.membershipSchedule)
    let afterSelection: MembershipScheduleSelection | null = null

    if (targetProfile) {
        const input =
            scheduleInput ??
            (beforeSelection
                ? {
                      category: beforeSelection.category,
                      frequency: beforeSelection.frequency,
                      hours: Object.fromEntries(
                          beforeSelection.groups.map((g) => [g.id, `${g.start}-${g.end}`])
                      ),
                  }
                : null)
        const result = validateMembershipScheduleSelection(
            targetProfile,
            input,
            targetType.sucursalCode ?? ""
        )
        if (!result.ok) {
            blockers.push({
                code: scheduleInput ? "SCHEDULE_INVALID" : "SCHEDULE_REQUIRED",
                message: scheduleInput
                    ? result.error
                    : `El horario actual no existe en el catalogo de la sede destino (${result.error}). Elige uno nuevo para completar el cambio.`,
            })
        } else {
            afterSelection = result.selection
        }
    }

    if (blockers.length > 0) return { ok: false, blockers }

    const sameEvent = sourceType.eventId === targetType.eventId
    const writes: MembershipChangeWrites = {
        ticket: { ticketTypeId: targetType.id },
        orderItem: { ticketTypeId: targetType.id },
        soldDecrementTypeId: sourceType.id,
        soldIncrementTypeId: targetType.id,
    }
    if (!sameEvent) writes.ticket.eventId = targetType.eventId
    if (afterSelection) {
        writes.ticket.membershipSchedule = afterSelection
        const attendee = asRecord((snapshot.orderItem.attendeeData as unknown[])[0])
        writes.orderItem.attendeeData = [{ ...attendee, membershipSchedule: afterSelection }]
    }

    return {
        ok: true,
        kind: "TRANSFER",
        label: sameEvent ? "Cambio de horario (la franja es el tipo de entrada)" : "Cambio de sede",
        before: buildState(
            sourceType,
            beforeSelection,
            normalizeSessions(snapshot.ticket.membershipSchedule),
            sourceType.sold,
            targetType.sold
        ),
        after: buildState(
            targetType,
            afterSelection ?? beforeSelection,
            sessionKeys(afterSelection ?? beforeSelection),
            sourceType.sold - 1,
            targetType.sold + 1
        ),
        writes,
        fingerprint: buildMembershipChangeFingerprint(snapshot),
    }
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx tsx --test src/lib/membership-transfer.test.ts`
Expected: PASS, 40 tests.

Si `TRANSFER reescribe el horario con la sucursal destino` falla, revisar que las horas `07:00-08:00` esten en el catalogo PLATA de CDM: `grep -n "CM_ADULT_HOURS" src/lib/membership-schedule.ts` y confirmar la franja. Ajustar la hora del fixture a una que si exista en ambas sedes, no la implementacion.

- [ ] **Step 5: Confirmar que no rompi nada**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-transfer.ts src/lib/membership-transfer.test.ts
git commit -m "feat(carnets): agrega planificador de movimiento entre tipos de entrada"
```

---

### Task 4: Modulo puro — ocupacion por franja

**Files:**
- Create: `src/lib/membership-occupancy.ts`
- Create: `src/lib/membership-occupancy.test.ts`

**Interfaces:**
- Consumes: de `@/lib/membership-schedule`: `getEffectiveMembershipSchedule`, `parseMembershipScheduleSelection`, `formatTime12h`, y los tipos `MembershipScheduleProfile`, `MembershipScheduleSelection`. De `@/lib/scan-helpers`: nada (el modulo recibe ya calculado el `monthIndex` de cada carnet, para no arrastrar la dependencia).
- Produces: los tipos `OccupancyTicketSnapshot`, `OccupancySlotRow`, `OccupancyDayLoadCell`, `OccupancyPlanRow`, `MembershipOccupancy`; y la funcion `buildMembershipOccupancy(input)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/membership-occupancy.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { buildMembershipOccupancy, type OccupancyTicketSnapshot } from "@/lib/membership-occupancy"

const BASE_LMV_4PM = {
    profileKey: "BRONCE",
    sucursalCode: "03",
    category: "NINOS" as const,
    categoryLabel: "Ninos",
    frequency: "LMV" as const,
    frequencyLabel: "Lun - Mie - Vie",
    sessions: [1, 3, 5].map((weekday) => ({ weekday: weekday as 1 | 3 | 5, start: "16:00", end: "17:00" })),
    groups: [{ id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5] as const, start: "16:00", end: "17:00" }],
}

const BASE_LMV_3PM = {
    ...BASE_LMV_4PM,
    sessions: [1, 3, 5].map((weekday) => ({ weekday: weekday as 1 | 3 | 5, start: "15:00", end: "16:00" })),
    groups: [{ id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5] as const, start: "15:00", end: "16:00" }],
}

function ticket(overrides: Partial<OccupancyTicketSnapshot> = {}): OccupancyTicketSnapshot {
    return {
        id: "tk-1",
        ticketTypeId: "tt-bronce",
        ticketTypeName: "MEMBRESIA SEMESTRAL BRONCE",
        planKey: "BRONCE",
        baseSchedule: BASE_LMV_4PM,
        monthlySchedules: [],
        monthIndex: 0,
        counts: true,
        ...overrides,
    }
}

test("cuenta una sesion por dia de la franja elegida", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket()],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    const row = occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")
    assert.ok(row)
    assert.equal(row.enrolled, 1)
    assert.equal(occupancy.slots.filter((s) => s.enrolled > 0).length, 3)
})

test("usa el horario efectivo del mes, no el del checkout", () => {
    const moved = ticket({
        monthlySchedules: [{ monthIndex: 2, selection: BASE_LMV_3PM }],
        monthIndex: 3,
    })
    const occupancy = buildMembershipOccupancy({
        tickets: [moved],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "15:00")?.enrolled, 1)
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")?.enrolled, undefined)
})

test("un cambio mensual posterior al mes en curso todavia no aplica", () => {
    const future = ticket({
        monthlySchedules: [{ monthIndex: 5, selection: BASE_LMV_3PM }],
        monthIndex: 3,
    })
    const occupancy = buildMembershipOccupancy({
        tickets: [future],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")?.enrolled, 1)
})

test("un carnet marcado como no contable se excluye", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket({ counts: false })],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.length, 0)
})

test("la carga por dia y hora suma todos los planes", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [
            ticket({ id: "a" }),
            ticket({ id: "b", planKey: "PLATA", ticketTypeId: "tt-plata", ticketTypeName: "PLATA" }),
        ],
        planTotals: [
            { ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 },
            { ticketTypeId: "tt-plata", name: "PLATA", capacity: 100, sold: 1 },
        ],
    })
    const cell = occupancy.dayLoad.find((c) => c.weekday === 1 && c.start === "16:00")
    assert.equal(cell?.total, 2)
    // Pero en la matriz por franja siguen separados por plan.
    assert.equal(occupancy.slots.filter((s) => s.weekday === 1 && s.start === "16:00").length, 2)
})

test("los totales por plan salen del capacity y sold del tipo", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 80, sold: 55 }],
    })
    assert.deepEqual(occupancy.planTotals, [
        { ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 80, sold: 55, available: 25 },
    ])
})

test("capacity 0 se reporta como sin tope", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [],
        planTotals: [{ ticketTypeId: "tt-x", name: "X", capacity: 0, sold: 12 }],
    })
    assert.equal(occupancy.planTotals[0].available, null)
})

test("un carnet sin horario semanal cuenta solo en su plan (caso VMT)", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket({ baseSchedule: null, planKey: null })],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "LUN - MIE - VIE 4PM", capacity: 30, sold: 1 }],
    })
    assert.equal(occupancy.slots.length, 0)
    assert.equal(occupancy.dayLoad.length, 0)
    assert.equal(occupancy.planTotals[0].sold, 1)
})

test("las franjas salen ordenadas por dia y hora", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket()],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    const keys = occupancy.slots.map((s) => `${s.weekday}:${s.start}`)
    assert.deepEqual(keys, [...keys].sort())
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx --test src/lib/membership-occupancy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/membership-occupancy'`.

- [ ] **Step 3: Escribir la implementacion**

Crear `src/lib/membership-occupancy.ts`:

```ts
/**
 * Ocupacion por franja horaria de las membresias de un evento.
 *
 * Responde "cuanta gente hay en cada franja" usando el horario EFECTIVO del mes
 * en curso: aplica los cambios mensuales (MembershipMonthlySchedule), no solo el
 * elegido en el checkout. Es lo que alimenta la vista /admin/membresias/cupos y
 * el selector de horario de la ficha, para no mandar a nadie a una franja llena.
 *
 * Modulo PURO: el llamador resuelve que carnets cuentan (ACTIVE, orden PAID,
 * vigentes hoy y no congelados) y en que `monthIndex` esta cada uno; aqui solo
 * se agrega.
 *
 * OJO: esto MUESTRA ocupacion, no la limita. El unico tope que se hace cumplir
 * en la venta es el global del TicketType (capacity / sold).
 */
import {
    formatTime12h,
    getEffectiveMembershipSchedule,
    parseMembershipScheduleSelection,
    type MembershipScheduleSelection,
    type Weekday,
} from "@/lib/membership-schedule"

export interface OccupancyTicketSnapshot {
    id: string
    ticketTypeId: string
    ticketTypeName: string
    /** membershipScheduleKey del tipo. null en sedes sin catalogo (VMT). */
    planKey: string | null
    baseSchedule: unknown
    monthlySchedules: Array<{ monthIndex: number; selection: unknown }>
    /** Indice del mes en curso de ESE carnet (getMembershipPeriod().index). */
    monthIndex: number
    /** El llamador decide: ACTIVE, orden PAID, vigente hoy, no congelado. */
    counts: boolean
}

export interface OccupancyPlanTotalInput {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
}

export interface OccupancySlotRow {
    ticketTypeId: string
    ticketTypeName: string
    planKey: string | null
    category: string
    categoryLabel: string
    frequency: string
    frequencyLabel: string
    weekday: Weekday
    start: string
    end: string
    label: string
    enrolled: number
}

export interface OccupancyDayLoadCell {
    weekday: Weekday
    start: string
    end: string
    label: string
    total: number
}

export interface OccupancyPlanRow {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
    /** null = sin tope (capacity 0). */
    available: number | null
}

export interface MembershipOccupancy {
    slots: OccupancySlotRow[]
    dayLoad: OccupancyDayLoadCell[]
    planTotals: OccupancyPlanRow[]
}

function slotLabel(start: string, end: string): string {
    return `${formatTime12h(start)} - ${formatTime12h(end)}`
}

function effectiveSelection(
    ticket: OccupancyTicketSnapshot
): MembershipScheduleSelection | null {
    const base = parseMembershipScheduleSelection(ticket.baseSchedule)
    const overrides = ticket.monthlySchedules.map((row) => ({
        monthIndex: row.monthIndex,
        selection: parseMembershipScheduleSelection(row.selection),
    }))
    return getEffectiveMembershipSchedule(base, overrides, ticket.monthIndex)
}

export function buildMembershipOccupancy(input: {
    tickets: OccupancyTicketSnapshot[]
    planTotals: OccupancyPlanTotalInput[]
}): MembershipOccupancy {
    const slots = new Map<string, OccupancySlotRow>()
    const dayLoad = new Map<string, OccupancyDayLoadCell>()

    for (const ticket of input.tickets) {
        if (!ticket.counts) continue
        const selection = effectiveSelection(ticket)
        if (!selection) continue

        for (const session of selection.sessions) {
            const slotKey = [
                ticket.ticketTypeId,
                selection.category,
                selection.frequency,
                session.weekday,
                session.start,
                session.end,
            ].join("|")
            const existing = slots.get(slotKey)
            if (existing) {
                existing.enrolled += 1
            } else {
                slots.set(slotKey, {
                    ticketTypeId: ticket.ticketTypeId,
                    ticketTypeName: ticket.ticketTypeName,
                    planKey: ticket.planKey,
                    category: selection.category,
                    categoryLabel: selection.categoryLabel,
                    frequency: selection.frequency,
                    frequencyLabel: selection.frequencyLabel,
                    weekday: session.weekday,
                    start: session.start,
                    end: session.end,
                    label: slotLabel(session.start, session.end),
                    enrolled: 1,
                })
            }

            const loadKey = `${session.weekday}|${session.start}|${session.end}`
            const cell = dayLoad.get(loadKey)
            if (cell) {
                cell.total += 1
            } else {
                dayLoad.set(loadKey, {
                    weekday: session.weekday,
                    start: session.start,
                    end: session.end,
                    label: slotLabel(session.start, session.end),
                    total: 1,
                })
            }
        }
    }

    const byDayThenHour = (a: { weekday: number; start: string }, b: { weekday: number; start: string }) =>
        a.weekday - b.weekday || a.start.localeCompare(b.start)

    return {
        slots: [...slots.values()].sort(
            (a, b) => byDayThenHour(a, b) || a.ticketTypeName.localeCompare(b.ticketTypeName)
        ),
        dayLoad: [...dayLoad.values()].sort(byDayThenHour),
        planTotals: input.planTotals.map((plan) => ({
            ...plan,
            available: plan.capacity === 0 ? null : Math.max(plan.capacity - plan.sold, 0),
        })),
    }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx tsx --test src/lib/membership-occupancy.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Confirmar el suite completo**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-occupancy.ts src/lib/membership-occupancy.test.ts
git commit -m "feat(carnets): agrega calculo puro de ocupacion por franja"
```

---

### Task 5: API — ficha del carnet

**Files:**
- Create: `src/app/api/admin/memberships/[ticketId]/route.ts`
- Create: `src/lib/membership-admin-snapshot.ts`

**Interfaces:**
- Consumes: `planMembershipChange` no se usa aqui; si `MembershipChangeSnapshot` y `MembershipTicketTypeSnapshot` de `@/lib/membership-transfer`. De `@/lib/scan-helpers`: `getMembershipAccessStatus`, `getEffectiveScheduleSelection`, `buildAttendanceSummary`, `getMembershipExpiry`, `getMembershipAnchor`, `getMembershipPeriod`, `getMembershipFreezeRanges`. De `@/lib/qr`: `getTodayDateString`, `formatDateUTC`. De `@/lib/membership-schedule`: `getMembershipScheduleProfile`, `scheduleSelectionToInput`, `formatScheduleSummary`.
- Produces: `src/lib/membership-admin-snapshot.ts` exporta `membershipChangeInclude` (objeto `Prisma.TicketInclude`), `toChangeSnapshot(ticket)` y `toTicketTypeSnapshot(ticketType)`, reutilizados por las Tasks 6 y 7. La ruta `GET` devuelve `{ success: true, data: MembershipDetail }`.

- [ ] **Step 1: Crear el modulo que traduce Prisma a snapshot**

Crear `src/lib/membership-admin-snapshot.ts`:

```ts
/**
 * Puente entre Prisma y los modulos puros de correccion de membresias.
 *
 * Vive aparte de las rutas porque las tres (ficha, horario, transfer) leen
 * EXACTAMENTE la misma forma: si el include y el mapeo divergen, la vista previa
 * y la escritura dejarian de mirar lo mismo.
 */
import { Prisma } from "@prisma/client"

import type {
    MembershipChangeSnapshot,
    MembershipTicketTypeSnapshot,
} from "@/lib/membership-transfer"

export const ticketTypeSnapshotSelect = {
    id: true,
    eventId: true,
    name: true,
    price: true,
    capacity: true,
    sold: true,
    isActive: true,
    isPackage: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    event: { select: { id: true, title: true, servilexSucursalCode: true } },
} satisfies Prisma.TicketTypeSelect

export type TicketTypeSnapshotRecord = Prisma.TicketTypeGetPayload<{
    select: typeof ticketTypeSnapshotSelect
}>

export const membershipChangeInclude = {
    ticketType: { select: ticketTypeSnapshotSelect },
    event: { select: { id: true, title: true, servilexSucursalCode: true, startDate: true, endDate: true, membershipStartFixed: true } },
    order: {
        select: {
            id: true,
            status: true,
            provider: true,
            totalAmount: true,
            buyerName: true,
            buyerDocNumber: true,
            items: {
                select: { id: true, ticketTypeId: true, attendeeData: true, quantity: true, unitPrice: true },
            },
            invoices: {
                select: { id: true, status: true, servilexGroupKey: true, invoiceNumber: true },
            },
        },
    },
    monthlySchedules: { select: { monthIndex: true, selection: true } },
    membershipFreeze: { select: { month: true, startDate: true, endDate: true } },
    entitlements: { select: { date: true, status: true, shift: true } },
    user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TicketInclude

export type MembershipChangeRecord = Prisma.TicketGetPayload<{
    include: typeof membershipChangeInclude
}>

export function toTicketTypeSnapshot(
    record: TicketTypeSnapshotRecord
): MembershipTicketTypeSnapshot {
    return {
        id: record.id,
        eventId: record.eventId,
        sucursalCode: record.event.servilexSucursalCode,
        name: record.name,
        price: Number(record.price),
        capacity: record.capacity,
        sold: record.sold,
        isActive: record.isActive,
        isPackage: record.isPackage,
        monthlyClassLimit: record.monthlyClassLimit,
        membershipDurationMonths: record.membershipDurationMonths,
        membershipScheduleKey: record.membershipScheduleKey,
    }
}

/**
 * El OrderItem del carnet. Una orden puede traer varios items; el del carnet es
 * el que apunta a su mismo ticketTypeId. Devuelve null si no se puede
 * identificar sin ambiguedad — el planificador lo reportara como bloqueo.
 */
export function findMembershipOrderItem(record: MembershipChangeRecord) {
    const matches = record.order.items.filter((item) => item.ticketTypeId === record.ticketTypeId)
    return matches.length === 1 ? matches[0] : null
}

export function toChangeSnapshot(record: MembershipChangeRecord): MembershipChangeSnapshot | null {
    const orderItem = findMembershipOrderItem(record)
    if (!orderItem) return null
    return {
        ticket: {
            id: record.id,
            status: record.status,
            eventId: record.eventId,
            ticketTypeId: record.ticketTypeId,
            membershipSchedule: record.membershipSchedule,
            monthlyScheduleCount: record.monthlySchedules.length,
        },
        order: {
            id: record.order.id,
            status: record.order.status,
            provider: record.order.provider,
            invoices: record.order.invoices.map((invoice) => ({
                id: invoice.id,
                status: invoice.status,
                servilexGroupKey: invoice.servilexGroupKey,
                invoiceNumber: invoice.invoiceNumber,
            })),
        },
        orderItem: {
            id: orderItem.id,
            ticketTypeId: orderItem.ticketTypeId,
            attendeeData: orderItem.attendeeData,
        },
        sourceType: toTicketTypeSnapshot(record.ticketType),
    }
}
```

- [ ] **Step 2: Escribir la ruta**

Crear `src/app/api/admin/memberships/[ticketId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import {
    membershipChangeInclude,
    ticketTypeSnapshotSelect,
    toChangeSnapshot,
    toTicketTypeSnapshot,
} from "@/lib/membership-admin-snapshot"
import {
    formatScheduleSummary,
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    scheduleSelectionToInput,
} from "@/lib/membership-schedule"
import { getAttendeeMatricula } from "@/lib/membership-transfer"
import { prisma } from "@/lib/prisma"
import { formatDateUTC, getTodayDateString } from "@/lib/qr"
import {
    buildAttendanceSummary,
    getEffectiveScheduleSelection,
    getMembershipAccessStatus,
    getMembershipAnchor,
    getMembershipPeriod,
} from "@/lib/scan-helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN
}

/** Providers cuya venta no emite boleta (ver membership-transfer.ts). */
const PROVIDERS_SIN_BOLETA = new Set(["PRESENCIAL", "COURTESY"])

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params

        const record = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: membershipChangeInclude,
        })
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }

        const today = getTodayDateString()

        // El diagnostico corre la MISMA logica que la puerta: lo que se ve aqui
        // es lo que le pasa al alumno al escanear.
        const scanTicket = {
            id: record.id,
            orderId: record.orderId,
            ticketTypeId: record.ticketTypeId,
            ticketCode: record.ticketCode,
            attendeeName: record.attendeeName,
            attendeeDni: record.attendeeDni,
            status: record.status,
            eventId: record.eventId,
            membershipStartDate: record.membershipStartDate,
            membershipSchedule: record.membershipSchedule,
            monthlySchedules: record.monthlySchedules,
            membershipFreeze: record.membershipFreeze,
            event: {
                title: record.event.title,
                startDate: record.event.startDate,
                endDate: record.event.endDate,
                membershipStartFixed: record.event.membershipStartFixed,
            },
            ticketType: {
                name: record.ticketType.name,
                isPackage: record.ticketType.isPackage,
                packageDaysCount: null,
                monthlyClassLimit: record.ticketType.monthlyClassLimit,
                membershipDurationMonths: record.ticketType.membershipDurationMonths,
                membershipScheduleKey: record.ticketType.membershipScheduleKey,
                validDays: null,
            },
            entitlements: record.entitlements,
        } as Parameters<typeof getMembershipAccessStatus>[0]

        const access = getMembershipAccessStatus(scanTicket, today)
        const attendance = buildAttendanceSummary(scanTicket, today)
        const anchor = getMembershipAnchor(scanTicket)
        const period = anchor ? getMembershipPeriod(today, anchor) : null
        const effective = getEffectiveScheduleSelection(scanTicket, today)
        const sucursalCode = record.ticketType.event.servilexSucursalCode
        const profile = getMembershipScheduleProfile(
            sucursalCode,
            record.ticketType.membershipScheduleKey
        )

        const snapshot = toChangeSnapshot(record)
        const matricula = snapshot ? getAttendeeMatricula(snapshot.orderItem.attendeeData) : null
        const provider = record.order.provider.trim().toUpperCase()
        const issuedInvoice = record.order.invoices.find((invoice) => invoice.status === "ISSUED")

        // Destinos posibles: mismo evento (franja = tipo, VMT) y otros eventos
        // de membresia (cambio de sede). La equivalencia la valida el
        // planificador; aqui se listan candidatos para que la UI no ofrezca
        // basura.
        const candidateTypes = await prisma.ticketType.findMany({
            where: {
                id: { not: record.ticketTypeId },
                isActive: true,
                monthlyClassLimit: record.ticketType.monthlyClassLimit,
                membershipDurationMonths: record.ticketType.membershipDurationMonths,
                isPackage: record.ticketType.isPackage,
                membershipScheduleKey: record.ticketType.membershipScheduleKey,
                price: record.ticketType.price,
            },
            select: ticketTypeSnapshotSelect,
            orderBy: [{ event: { title: "asc" } }, { name: "asc" }],
        })

        const history = await prisma.membershipAdminChange.findMany({
            where: { ticketId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                kind: true,
                reason: true,
                before: true,
                after: true,
                createdAt: true,
                actor: { select: { name: true, email: true } },
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                ticket: {
                    id: record.id,
                    ticketCode: record.ticketCode,
                    status: record.status,
                    attendeeName: record.attendeeName,
                    attendeeDni: record.attendeeDni,
                    matricula,
                    membershipStartDate: record.membershipStartDate
                        ? formatDateUTC(record.membershipStartDate)
                        : null,
                    user: record.user,
                },
                event: {
                    id: record.event.id,
                    title: record.event.title,
                    sucursalCode,
                },
                ticketType: toTicketTypeSnapshot(record.ticketType),
                order: {
                    id: record.order.id,
                    status: record.order.status,
                    provider: record.order.provider,
                    totalAmount: Number(record.order.totalAmount),
                    buyerName: record.order.buyerName,
                    // En venta presencial y cortesia NO se emite boleta: se
                    // informa como dato plano, nunca como comprobante faltante.
                    invoicing: PROVIDERS_SIN_BOLETA.has(provider)
                        ? { kind: "sin_boleta" as const, label: "Venta presencial · sin boleta" }
                        : {
                              kind: "boleta" as const,
                              invoiceNumber: issuedInvoice?.invoiceNumber ?? null,
                          },
                },
                diagnosis: {
                    today,
                    accessStatus: access.status,
                    startStr: access.startStr,
                    expiryStr: access.expiryStr,
                    frozenMonth: record.membershipFreeze?.month ?? null,
                    monthIndex: period?.index ?? null,
                    periodStart: period?.startStr ?? null,
                    periodEnd: period?.endStr ?? null,
                    attendance,
                    effectiveSchedule: effective,
                    effectiveScheduleSummary: formatScheduleSummary(effective),
                    baseScheduleSummary: formatScheduleSummary(
                        parseMembershipScheduleSelection(record.membershipSchedule)
                    ),
                    monthlyScheduleCount: record.monthlySchedules.length,
                },
                scheduleProfile: profile,
                currentScheduleInput: scheduleSelectionToInput(
                    parseMembershipScheduleSelection(record.membershipSchedule)
                ),
                candidateTypes: candidateTypes.map((type) => ({
                    ...toTicketTypeSnapshot(type),
                    eventTitle: type.event.title,
                    sameEvent: type.eventId === record.eventId,
                })),
                history,
            },
        })
    } catch (error) {
        console.error("Error al cargar la ficha de membresia:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores en los archivos nuevos.

Si `getEffectiveScheduleSelection` no acepta la forma de `scanTicket`, comparar con su firma: `grep -n "getEffectiveScheduleSelection" -A8 src/lib/scan-helpers.ts` y ajustar el objeto, no el helper.

- [ ] **Step 4: Probar la ruta a mano**

Run: `npm run dev` en una terminal. Con sesion de admin en el navegador, abrir:
`http://localhost:3000/api/admin/memberships/<un-ticketId-de-membresia>`

Expected: JSON con `success: true` y los bloques `ticket`, `diagnosis`, `scheduleProfile`, `candidateTypes`, `history: []`.

Para obtener un `ticketId` de prueba: `npx tsx --env-file=.env scripts/tmp-list-ticket-types.ts` o una consulta directa a la BD de desarrollo.

- [ ] **Step 5: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-admin-snapshot.ts src/app/api/admin/memberships/\[ticketId\]/route.ts
git commit -m "feat(carnets): agrega API de ficha de membresia con diagnostico"
```

---

### Task 6: API — cambio de horario con vista previa y auditoria

**Files:**
- Create: `src/app/api/admin/memberships/[ticketId]/schedule/route.ts`
- Create: `src/lib/membership-change-apply.ts`

**Interfaces:**
- Consumes: `planMembershipChange`, `buildMembershipChangeFingerprint`, tipos de `@/lib/membership-transfer`; `membershipChangeInclude`, `toChangeSnapshot` de `@/lib/membership-admin-snapshot`.
- Produces: `src/lib/membership-change-apply.ts` exporta `applyMembershipChange(tx, args)`, reutilizado por la Task 7. `POST` acepta `{ selection, reason, preview? }`.

- [ ] **Step 1: Escribir el ejecutor de escrituras**

Crear `src/lib/membership-change-apply.ts`:

```ts
/**
 * Ejecuta las escrituras de un plan de correccion de membresia dentro de una
 * transaccion, y deja el rastro en MembershipAdminChange.
 *
 * El plan ya viene validado y REPLANIFICADO dentro de la transaccion por el
 * llamador; aqui no se decide nada, solo se escribe.
 */
import { Prisma, type MembershipChangeKind } from "@prisma/client"

import type { MembershipChangePlan } from "@/lib/membership-transfer"

type Tx = Prisma.TransactionClient

export async function applyMembershipChange(
    tx: Tx,
    args: {
        plan: Extract<MembershipChangePlan, { ok: true }>
        ticketId: string
        orderItemId: string
        actorId: string
        reason: string
    }
) {
    const { plan, ticketId, orderItemId, actorId, reason } = args
    const { writes } = plan

    // El cupo se mueve con guardas en el propio UPDATE: si otro proceso vendio
    // el ultimo lugar entremedio, la fila no se actualiza y se aborta.
    if (writes.soldDecrementTypeId) {
        const decremented = await tx.ticketType.updateMany({
            where: { id: writes.soldDecrementTypeId, sold: { gt: 0 } },
            data: { sold: { decrement: 1 } },
        })
        if (decremented.count !== 1) {
            throw new Error("No se pudo descontar el cupo del tipo origen; el carnet no se movio.")
        }
    }
    if (writes.soldIncrementTypeId) {
        const incremented = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "ticket_types"
            SET "sold" = "sold" + 1
            WHERE "id" = ${writes.soldIncrementTypeId}
              AND "isActive" = true
              AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
            RETURNING "id"
        `)
        if (!incremented[0]) {
            throw new Error("No se pudo reservar el cupo del tipo destino; el carnet no se movio.")
        }
    }

    const ticketData: Prisma.TicketUpdateInput = {}
    if (writes.ticket.eventId) ticketData.event = { connect: { id: writes.ticket.eventId } }
    if (writes.ticket.ticketTypeId) {
        ticketData.ticketType = { connect: { id: writes.ticket.ticketTypeId } }
    }
    if (writes.ticket.membershipSchedule) {
        ticketData.membershipSchedule =
            writes.ticket.membershipSchedule as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(ticketData).length > 0) {
        await tx.ticket.update({ where: { id: ticketId }, data: ticketData })
    }

    const itemData: Prisma.OrderItemUpdateInput = {}
    if (writes.orderItem.ticketTypeId) {
        itemData.ticketType = { connect: { id: writes.orderItem.ticketTypeId } }
    }
    if (writes.orderItem.attendeeData) {
        itemData.attendeeData = writes.orderItem.attendeeData as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(itemData).length > 0) {
        await tx.orderItem.update({ where: { id: orderItemId }, data: itemData })
    }

    await tx.membershipAdminChange.create({
        data: {
            ticketId,
            actorId,
            kind: plan.kind as MembershipChangeKind,
            reason,
            before: plan.before as unknown as Prisma.InputJsonValue,
            after: plan.after as unknown as Prisma.InputJsonValue,
        },
    })
}
```

- [ ] **Step 2: Escribir la ruta**

Crear `src/app/api/admin/memberships/[ticketId]/schedule/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { membershipChangeInclude, toChangeSnapshot } from "@/lib/membership-admin-snapshot"
import { applyMembershipChange } from "@/lib/membership-change-apply"
import { planMembershipChange } from "@/lib/membership-transfer"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SNAPSHOT_MISSING =
    "No se pudo identificar el item de la orden que corresponde a este carnet."

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (user?.role !== UserRole.ADMIN) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params
        const body = (await request.json()) as {
            selection?: { category?: string; frequency?: string; hours?: Record<string, string> }
            reason?: string
            preview?: boolean
        }

        const reason = body.reason?.trim() ?? ""
        const isPreview = body.preview === true
        if (!isPreview && reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (minimo 5 caracteres)." },
                { status: 400 }
            )
        }

        const record = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: membershipChangeInclude,
        })
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }
        const snapshot = toChangeSnapshot(record)
        if (!snapshot) {
            return NextResponse.json({ success: false, error: SNAPSHOT_MISSING }, { status: 409 })
        }

        const plan = planMembershipChange(snapshot, {
            kind: "SCHEDULE",
            scheduleInput: body.selection ?? {},
        })
        if (!plan.ok) {
            return NextResponse.json({ success: false, blockers: plan.blockers }, { status: 409 })
        }
        if (isPreview) {
            return NextResponse.json({ success: true, data: { plan } })
        }

        // Replanificar dentro de la transaccion: si el carnet cambio desde que
        // el admin vio la vista previa, se aborta en vez de escribir.
        await prisma.$transaction(async (tx) => {
            const fresh = await tx.ticket.findUnique({
                where: { id: ticketId },
                include: membershipChangeInclude,
            })
            const freshSnapshot = fresh ? toChangeSnapshot(fresh) : null
            if (!freshSnapshot) throw new Error(SNAPSHOT_MISSING)

            const freshPlan = planMembershipChange(freshSnapshot, {
                kind: "SCHEDULE",
                scheduleInput: body.selection ?? {},
            })
            if (!freshPlan.ok) {
                throw new Error(freshPlan.blockers.map((b) => b.message).join(" "))
            }
            if (freshPlan.fingerprint !== plan.fingerprint) {
                throw new Error(
                    "El carnet cambio desde que abriste la pantalla. Recarga y vuelve a revisar antes de aplicar."
                )
            }

            await applyMembershipChange(tx, {
                plan: freshPlan,
                ticketId,
                orderItemId: freshSnapshot.orderItem.id,
                actorId: user.id,
                reason,
            })
        })

        return NextResponse.json({ success: true, data: { plan } })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error interno"
        console.error("Error al cambiar el horario de la membresia:", error)
        return NextResponse.json({ success: false, error: message }, { status: 409 })
    }
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Si `user.id` no existe en el tipo de `getCurrentUser()`, revisar su retorno con `grep -n "export async function getCurrentUser" -A15 src/lib/auth.ts` y usar el campo que corresponda.

- [ ] **Step 4: Probar vista previa y aplicacion contra la BD de desarrollo**

Con `npm run dev` y sesion de admin, desde la consola del navegador:

```js
// Vista previa: no escribe.
await fetch("/api/admin/memberships/<ticketId>/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview: true, selection: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } } }),
}).then((r) => r.json())
```

Expected: `success: true` con `data.plan.before.sessions` y `data.plan.after.sessions` distintos.

Repetir sin `preview` y con `reason: "prueba local"`. Expected: `success: true`. Verificar en la BD que `tickets.membershipSchedule` y `order_items.attendeeData` quedaron con el mismo horario, y que hay una fila en `membership_admin_changes`.

- [ ] **Step 5: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/membership-change-apply.ts src/app/api/admin/memberships/\[ticketId\]/schedule/route.ts
git commit -m "feat(carnets): agrega API de cambio de horario con vista previa y auditoria"
```

---

### Task 7: API — movimiento entre tipos (horario VMT y cambio de sede)

**Files:**
- Create: `src/app/api/admin/memberships/[ticketId]/transfer/route.ts`

**Interfaces:**
- Consumes: `applyMembershipChange` de Task 6; `planMembershipChange`, `toTicketTypeSnapshot`, `ticketTypeSnapshotSelect`, `membershipChangeInclude`, `toChangeSnapshot`.
- Produces: `POST` acepta `{ targetTicketTypeId, selection?, reason, preview? }`.

- [ ] **Step 1: Escribir la ruta**

Crear `src/app/api/admin/memberships/[ticketId]/transfer/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import {
    membershipChangeInclude,
    ticketTypeSnapshotSelect,
    toChangeSnapshot,
    toTicketTypeSnapshot,
} from "@/lib/membership-admin-snapshot"
import { applyMembershipChange } from "@/lib/membership-change-apply"
import { planMembershipChange, type MembershipChangeIntent } from "@/lib/membership-transfer"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SNAPSHOT_MISSING =
    "No se pudo identificar el item de la orden que corresponde a este carnet."

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (user?.role !== UserRole.ADMIN) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params
        const body = (await request.json()) as {
            targetTicketTypeId?: string
            selection?: { category?: string; frequency?: string; hours?: Record<string, string> }
            reason?: string
            preview?: boolean
        }

        const targetTicketTypeId = body.targetTicketTypeId?.trim() ?? ""
        if (!targetTicketTypeId) {
            return NextResponse.json(
                { success: false, error: "Indica el tipo de entrada destino." },
                { status: 400 }
            )
        }
        const reason = body.reason?.trim() ?? ""
        const isPreview = body.preview === true
        if (!isPreview && reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (minimo 5 caracteres)." },
                { status: 400 }
            )
        }

        const [record, targetRecord] = await Promise.all([
            prisma.ticket.findUnique({ where: { id: ticketId }, include: membershipChangeInclude }),
            prisma.ticketType.findUnique({
                where: { id: targetTicketTypeId },
                select: ticketTypeSnapshotSelect,
            }),
        ])
        if (!record) {
            return NextResponse.json({ success: false, error: "Carnet no encontrado" }, { status: 404 })
        }
        if (!targetRecord) {
            return NextResponse.json(
                { success: false, error: "Tipo de entrada destino no encontrado" },
                { status: 404 }
            )
        }
        const snapshot = toChangeSnapshot(record)
        if (!snapshot) {
            return NextResponse.json({ success: false, error: SNAPSHOT_MISSING }, { status: 409 })
        }

        const intent: MembershipChangeIntent = {
            kind: "TRANSFER",
            targetType: toTicketTypeSnapshot(targetRecord),
            scheduleInput: body.selection ?? null,
        }

        const plan = planMembershipChange(snapshot, intent)
        if (!plan.ok) {
            return NextResponse.json({ success: false, blockers: plan.blockers }, { status: 409 })
        }
        if (isPreview) {
            return NextResponse.json({ success: true, data: { plan } })
        }

        await prisma.$transaction(async (tx) => {
            const [fresh, freshTarget] = await Promise.all([
                tx.ticket.findUnique({ where: { id: ticketId }, include: membershipChangeInclude }),
                tx.ticketType.findUnique({
                    where: { id: targetTicketTypeId },
                    select: ticketTypeSnapshotSelect,
                }),
            ])
            const freshSnapshot = fresh ? toChangeSnapshot(fresh) : null
            if (!freshSnapshot || !freshTarget) throw new Error(SNAPSHOT_MISSING)

            const freshPlan = planMembershipChange(freshSnapshot, {
                ...intent,
                targetType: toTicketTypeSnapshot(freshTarget),
            })
            if (!freshPlan.ok) {
                throw new Error(freshPlan.blockers.map((b) => b.message).join(" "))
            }
            if (freshPlan.fingerprint !== plan.fingerprint) {
                throw new Error(
                    "El carnet cambio desde que abriste la pantalla. Recarga y vuelve a revisar antes de aplicar."
                )
            }

            await applyMembershipChange(tx, {
                plan: freshPlan,
                ticketId,
                orderItemId: freshSnapshot.orderItem.id,
                actorId: user.id,
                reason,
            })
        })

        return NextResponse.json({ success: true, data: { plan } })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error interno"
        console.error("Error al mover el carnet de tipo:", error)
        return NextResponse.json({ success: false, error: message }, { status: 409 })
    }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Probar contra la BD de desarrollo**

Con `npm run dev` y sesion de admin, en la consola del navegador, primero vista previa contra un tipo destino equivalente. Expected: `data.plan.label` = `"Cambio de sede"` (o el de horario VMT si es el mismo evento), y `before.targetSold` / `after.targetSold` con diferencia de 1.

Luego aplicar con `reason`. Verificar en la BD:
- `tickets.eventId` y `tickets.ticketTypeId` movidos.
- `order_items.ticketTypeId` movido.
- `ticket_types.sold` del origen −1 y del destino +1.
- `orders.totalAmount` y las filas de `invoices` **sin cambios**.
- una fila nueva en `membership_admin_changes` con `kind = 'TRANSFER'`.

- [ ] **Step 4: Probar que un destino no equivalente se rechaza**

Repetir la vista previa apuntando a un tipo con otro precio.
Expected: HTTP 409 con `blockers` conteniendo `TARGET_NOT_EQUIVALENT` y el mensaje nombrando la diferencia.

- [ ] **Step 5: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/memberships/\[ticketId\]/transfer/route.ts
git commit -m "feat(carnets): agrega API de cambio de sede y horario por tipo de entrada"
```

---

### Task 8: API — ocupacion por evento

**Files:**
- Create: `src/app/api/admin/membership-occupancy/route.ts`

**Interfaces:**
- Consumes: `buildMembershipOccupancy`, `type OccupancyTicketSnapshot` de `@/lib/membership-occupancy`; de `@/lib/scan-helpers`: `getMembershipAccessStatus`, `getMembershipAnchor`, `getMembershipPeriod`; de `@/lib/qr`: `getTodayDateString`.
- Produces: `GET ?eventId=` devuelve `{ success: true, data: { event, occupancy } }`. Sin `eventId`, devuelve la lista de eventos de membresia elegibles en `data.events`.

- [ ] **Step 1: Escribir la ruta**

Crear `src/app/api/admin/membership-occupancy/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { OrderStatus, TicketStatus, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { buildMembershipOccupancy, type OccupancyTicketSnapshot } from "@/lib/membership-occupancy"
import { prisma } from "@/lib/prisma"
import { getTodayDateString } from "@/lib/qr"
import {
    getMembershipAccessStatus,
    getMembershipAnchor,
    getMembershipPeriod,
} from "@/lib/scan-helpers"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN
}

export async function GET(request: NextRequest) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? ""

        // Eventos que venden membresias: al menos un tipo con cupo mensual y
        // duracion fija. Sirve para poblar el selector.
        const events = await prisma.event.findMany({
            where: {
                ticketTypes: {
                    some: { monthlyClassLimit: { gt: 0 }, membershipDurationMonths: { gt: 0 } },
                },
            },
            select: { id: true, title: true, servilexSucursalCode: true },
            orderBy: { startDate: "desc" },
        })

        if (!eventId) {
            return NextResponse.json({ success: true, data: { events, occupancy: null, event: null } })
        }
        const event = events.find((candidate) => candidate.id === eventId)
        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento de membresias no encontrado" },
                { status: 404 }
            )
        }

        const today = getTodayDateString()

        const [tickets, types] = await Promise.all([
            prisma.ticket.findMany({
                where: {
                    eventId,
                    status: TicketStatus.ACTIVE,
                    order: { status: OrderStatus.PAID },
                    ticketType: {
                        monthlyClassLimit: { gt: 0 },
                        membershipDurationMonths: { gt: 0 },
                    },
                },
                select: {
                    id: true,
                    ticketTypeId: true,
                    membershipStartDate: true,
                    membershipSchedule: true,
                    monthlySchedules: { select: { monthIndex: true, selection: true } },
                    membershipFreeze: { select: { month: true, startDate: true, endDate: true } },
                    event: {
                        select: { title: true, startDate: true, endDate: true, membershipStartFixed: true },
                    },
                    ticketType: {
                        select: {
                            name: true,
                            isPackage: true,
                            monthlyClassLimit: true,
                            membershipDurationMonths: true,
                            membershipScheduleKey: true,
                        },
                    },
                },
            }),
            prisma.ticketType.findMany({
                where: {
                    eventId,
                    monthlyClassLimit: { gt: 0 },
                    membershipDurationMonths: { gt: 0 },
                },
                select: { id: true, name: true, capacity: true, sold: true },
                orderBy: { name: "asc" },
            }),
        ])

        const snapshots: OccupancyTicketSnapshot[] = tickets.map((ticket) => {
            const scanTicket = {
                id: ticket.id,
                orderId: "",
                ticketTypeId: ticket.ticketTypeId,
                ticketCode: "",
                attendeeName: null,
                attendeeDni: null,
                status: "ACTIVE" as const,
                eventId,
                membershipStartDate: ticket.membershipStartDate,
                membershipSchedule: ticket.membershipSchedule,
                monthlySchedules: ticket.monthlySchedules,
                membershipFreeze: ticket.membershipFreeze,
                event: {
                    title: ticket.event.title,
                    startDate: ticket.event.startDate,
                    endDate: ticket.event.endDate,
                    membershipStartFixed: ticket.event.membershipStartFixed,
                },
                ticketType: {
                    name: ticket.ticketType.name,
                    isPackage: ticket.ticketType.isPackage,
                    packageDaysCount: null,
                    monthlyClassLimit: ticket.ticketType.monthlyClassLimit,
                    membershipDurationMonths: ticket.ticketType.membershipDurationMonths,
                    membershipScheduleKey: ticket.ticketType.membershipScheduleKey,
                    validDays: null,
                },
                entitlements: [],
            } as Parameters<typeof getMembershipAccessStatus>[0]

            const anchor = getMembershipAnchor(scanTicket)
            const period = anchor ? getMembershipPeriod(today, anchor) : null

            return {
                id: ticket.id,
                ticketTypeId: ticket.ticketTypeId,
                ticketTypeName: ticket.ticketType.name,
                planKey: ticket.ticketType.membershipScheduleKey,
                baseSchedule: ticket.membershipSchedule,
                monthlySchedules: ticket.monthlySchedules,
                monthIndex: period?.index ?? 0,
                // Solo cuenta quien de verdad puede entrar hoy: descarta los que
                // aun no inician, los vencidos y los congelados este mes.
                counts: getMembershipAccessStatus(scanTicket, today).status === "OK",
            }
        })

        const occupancy = buildMembershipOccupancy({
            tickets: snapshots,
            planTotals: types.map((type) => ({
                ticketTypeId: type.id,
                name: type.name,
                capacity: type.capacity,
                sold: type.sold,
            })),
        })

        return NextResponse.json({ success: true, data: { events, event, occupancy, today } })
    } catch (error) {
        console.error("Error al calcular la ocupacion de membresias:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Contrastar contra el script existente**

Run: `npx tsx --tsconfig tsconfig.json scripts/report-cupos-horarios-membresias.ts --sucursal 03 --out ../cupos-control.xlsx`

Luego abrir `GET /api/admin/membership-occupancy?eventId=<evento-videna>` y comparar los totales por franja de la hoja "Carga por dia y hora" contra `data.occupancy.dayLoad`.

Expected: coinciden. Si difieren, la causa mas probable es el filtro de vigencia: el script puede contar carnets que aun no inician. Anotar la diferencia y confirmar cual criterio es el correcto antes de tocar codigo — el de esta ruta ("quien puede entrar hoy") es el que se decidio en el spec.

- [ ] **Step 4: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/membership-occupancy/route.ts
git commit -m "feat(carnets): agrega API de ocupacion por franja y evento"
```

---

### Task 9: UI — ficha del carnet, datos y diagnostico

**Files:**
- Create: `src/app/admin/membresias/[ticketId]/page.tsx`
- Create: `src/app/admin/membresias/[ticketId]/types.ts`
- Modify: `src/app/admin/membresias/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/memberships/[ticketId]`.
- Produces: `types.ts` exporta la interfaz `MembershipDetail` que describe el payload de la ficha; la Task 10 la extiende con los tipos del plan.

- [ ] **Step 1: Declarar los tipos del payload**

Crear `src/app/admin/membresias/[ticketId]/types.ts`:

```ts
export interface DetailTicketType {
    id: string
    eventId: string
    sucursalCode: string | null
    name: string
    price: number
    capacity: number
    sold: number
    isActive: boolean
    isPackage: boolean
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
}

export interface DetailCandidateType extends DetailTicketType {
    eventTitle: string
    sameEvent: boolean
}

export interface DetailHistoryRow {
    id: string
    kind: "SCHEDULE" | "TRANSFER"
    reason: string
    before: { scheduleSummary: string; ticketTypeName: string; sucursalCode: string | null }
    after: { scheduleSummary: string; ticketTypeName: string; sucursalCode: string | null }
    createdAt: string
    actor: { name: string | null; email: string }
}

export interface MembershipDetail {
    ticket: {
        id: string
        ticketCode: string
        status: "ACTIVE" | "CANCELLED" | "EXPIRED"
        attendeeName: string | null
        attendeeDni: string | null
        matricula: string | null
        membershipStartDate: string | null
        user: { id: string; name: string | null; email: string }
    }
    event: { id: string; title: string; sucursalCode: string | null }
    ticketType: DetailTicketType
    order: {
        id: string
        status: string
        provider: string
        totalAmount: number
        buyerName: string | null
        invoicing:
            | { kind: "sin_boleta"; label: string }
            | { kind: "boleta"; invoiceNumber: string | null }
    }
    diagnosis: {
        today: string
        accessStatus: "OK" | "NOT_STARTED" | "EXPIRED" | "BLACKOUT" | "FROZEN" | "NOT_APPLICABLE"
        startStr: string
        expiryStr: string
        frozenMonth: string | null
        monthIndex: number | null
        periodStart: string | null
        periodEnd: string | null
        attendance: { total: number; used: number; remaining: number }
        effectiveScheduleSummary: string
        baseScheduleSummary: string
        monthlyScheduleCount: number
    }
    scheduleProfile: ScheduleProfile | null
    currentScheduleInput: { category: string | null; frequency: string | null; hours: Record<string, string> }
    candidateTypes: DetailCandidateType[]
    history: DetailHistoryRow[]
}

export interface ScheduleProfile {
    key: string
    label: string
    planMode: "CHOOSE_FREQUENCY" | "FIXED_FREQUENCY"
    categories: Array<{
        id: "ADULTOS" | "NINOS"
        label: string
        frequencies: Array<{
            id: string
            label: string
            dayGroups: Array<{
                id: string
                label: string
                weekdays: number[]
                hours: Array<{ start: string; end: string }>
            }>
        }>
    }>
}
```

- [ ] **Step 2: Escribir la pagina con los bloques de lectura**

Crear `src/app/admin/membresias/[ticketId]/page.tsx`. Sigue el estilo de `src/app/admin/membresias/page.tsx`: `"use client"`, `Card`/`Badge`/`Button` de `@/components/ui/`, iconos de `lucide-react`, `cn` de `@/lib/utils`.

```tsx
"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, CalendarClock, History, MapPin, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MembershipDetail } from "./types"

const ACCESS_LABEL: Record<MembershipDetail["diagnosis"]["accessStatus"], string> = {
    OK: "QR activo",
    NOT_STARTED: "Aun no inicia",
    EXPIRED: "Vencida",
    BLACKOUT: "Mes sin actividad",
    FROZEN: "Congelada",
    NOT_APPLICABLE: "Sin vigencia fija",
}

const ACCESS_TONE: Record<MembershipDetail["diagnosis"]["accessStatus"], string> = {
    OK: "bg-emerald-100 text-emerald-800",
    NOT_STARTED: "bg-amber-100 text-amber-800",
    EXPIRED: "bg-red-100 text-red-800",
    BLACKOUT: "bg-slate-100 text-slate-700",
    FROZEN: "bg-sky-100 text-sky-800",
    NOT_APPLICABLE: "bg-slate-100 text-slate-700",
}

export default function MembershipDetailPage({
    params,
}: {
    params: Promise<{ ticketId: string }>
}) {
    const { ticketId } = use(params)
    const [detail, setDetail] = useState<MembershipDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await fetch(`/api/admin/memberships/${ticketId}`, { cache: "no-store" })
            const payload = await response.json()
            if (!payload.success) throw new Error(payload.error ?? "No se pudo cargar el carnet")
            setDetail(payload.data as MembershipDetail)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error desconocido")
        } finally {
            setLoading(false)
        }
    }, [ticketId])

    useEffect(() => {
        void load()
    }, [load])

    if (loading) return <div className="p-6 text-sm text-slate-500">Cargando carnet…</div>
    if (error) {
        return (
            <div className="p-6">
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            </div>
        )
    }
    if (!detail) return null

    const { ticket, event, ticketType, order, diagnosis, history } = detail

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <Link
                    href="/admin/membresias"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver a membresias
                </Link>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Actualizar
                </Button>
            </div>

            {/* 1. Quien es y que compro */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        {ticket.attendeeName ?? ticket.user.name ?? "Sin nombre"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Codigo" value={ticket.ticketCode} />
                    <Field label="DNI" value={ticket.attendeeDni ?? "—"} />
                    <Field label="Matricula" value={ticket.matricula ?? "—"} />
                    <Field label="Evento" value={`${event.title} (sede ${event.sucursalCode ?? "—"})`} />
                    <Field label="Plan" value={ticketType.name} />
                    <Field
                        label="Duracion"
                        value={
                            ticketType.membershipDurationMonths
                                ? `${ticketType.membershipDurationMonths} meses`
                                : "—"
                        }
                    />
                    <Field label="Inicio" value={ticket.membershipStartDate ?? "—"} />
                    <Field
                        label="Origen"
                        value={
                            order.invoicing.kind === "sin_boleta"
                                ? order.invoicing.label
                                : `Web · boleta ${order.invoicing.invoiceNumber ?? "pendiente"}`
                        }
                    />
                    <Field label="Total" value={`S/ ${order.totalAmount.toFixed(2)}`} />
                </CardContent>
            </Card>

            {/* 2. Que ve el alumno hoy */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5" />
                        Que ve el alumno hoy ({diagnosis.today})
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <div>
                        <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${ACCESS_TONE[diagnosis.accessStatus]}`}
                        >
                            {ACCESS_LABEL[diagnosis.accessStatus]}
                        </span>
                        {diagnosis.frozenMonth ? (
                            <span className="ml-2 text-slate-600">Congelada en {diagnosis.frozenMonth}</span>
                        ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label="Vigencia" value={`${diagnosis.startStr} → ${diagnosis.expiryStr}`} />
                        <Field
                            label="Mes en curso"
                            value={
                                diagnosis.periodStart
                                    ? `#${(diagnosis.monthIndex ?? 0) + 1} · ${diagnosis.periodStart} → ${diagnosis.periodEnd}`
                                    : "—"
                            }
                        />
                        <Field
                            label="Clases del mes"
                            value={`${diagnosis.attendance.used} de ${diagnosis.attendance.total} (quedan ${diagnosis.attendance.remaining})`}
                        />
                        <Field
                            label="Horario efectivo del mes"
                            value={diagnosis.effectiveScheduleSummary}
                        />
                        <Field label="Horario base (checkout)" value={diagnosis.baseScheduleSummary} />
                        <Field
                            label="Cambios de horario por mes"
                            value={
                                diagnosis.monthlyScheduleCount > 0
                                    ? `${diagnosis.monthlyScheduleCount} definidos`
                                    : "ninguno"
                            }
                        />
                    </div>
                    {diagnosis.monthlyScheduleCount > 0 ? (
                        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                            Este carnet tiene horarios definidos por mes. Mientras los tenga, el panel no
                            deja cambiar el horario base ni la sede: hay que resolverlo por script.
                        </p>
                    ) : null}
                </CardContent>
            </Card>

            {/* 3. Acciones — se agrega en la Task 10 */}

            {/* 4. Historial */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" />
                        Historial de correcciones
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {history.length === 0 ? (
                        <p className="text-sm text-slate-500">Sin correcciones registradas.</p>
                    ) : (
                        <ul className="space-y-3 text-sm">
                            {history.map((row) => (
                                <li key={row.id} className="rounded-lg border border-slate-200 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                            {row.kind === "SCHEDULE" ? "Horario" : "Tipo / sede"}
                                        </Badge>
                                        <span className="text-slate-500">
                                            {new Date(row.createdAt).toLocaleString("es-PE")} ·{" "}
                                            {row.actor.name ?? row.actor.email}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-slate-700">
                                        {row.before.ticketTypeName} · {row.before.scheduleSummary}
                                        {" → "}
                                        {row.after.ticketTypeName} · {row.after.scheduleSummary}
                                    </p>
                                    <p className="mt-1 text-slate-500">Motivo: {row.reason}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-0.5 text-slate-900">{value}</p>
        </div>
    )
}
```

- [ ] **Step 3: Enlazar desde la tabla**

En `src/app/admin/membresias/page.tsx`, dentro de la fila de cada membresia (cerca de donde se renderiza `compactCode(membership.ticketCode)`), envolver el codigo en un enlace:

```tsx
<Link
    href={`/admin/membresias/${membership.id}`}
    className="font-mono text-sm text-blue-600 hover:underline"
>
    {compactCode(membership.ticketCode)}
</Link>
```

Agregar el import `import Link from "next/link"` al inicio del archivo, junto a los otros imports.

- [ ] **Step 4: Verificar que compila y se ve**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Con `npm run dev`, entrar a `/admin/membresias`, hacer clic en el codigo de un carnet de membresia, y confirmar: los tres bloques se pintan, el estado de acceso coincide con lo que muestra el carnet del alumno en `mi-cuenta/entradas`, y el historial dice "Sin correcciones registradas".

- [ ] **Step 5: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/membresias
git commit -m "feat(carnets): agrega ficha de membresia con diagnostico e historial"
```

---

### Task 10: UI — acciones de horario y sede con vista previa

**Files:**
- Modify: `src/app/admin/membresias/[ticketId]/page.tsx`
- Create: `src/app/admin/membresias/[ticketId]/ScheduleActions.tsx`

**Interfaces:**
- Consumes: `MembershipDetail`, `ScheduleProfile`, `DetailCandidateType` de `./types`; `POST /api/admin/memberships/[ticketId]/schedule` y `/transfer`; `GET /api/admin/membership-occupancy?eventId=`.
- Produces: componente `ScheduleActions({ detail, onApplied })`.

- [ ] **Step 1: Escribir el componente de acciones**

Crear `src/app/admin/membresias/[ticketId]/ScheduleActions.tsx`:

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock, Repeat } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { DetailCandidateType, MembershipDetail } from "./types"

interface Blocker {
    code: string
    message: string
}

interface PlanState {
    label: string
    before: { ticketTypeName: string; sucursalCode: string | null; scheduleSummary: string; sourceSold: number; targetSold: number | null }
    after: { ticketTypeName: string; sucursalCode: string | null; scheduleSummary: string; sourceSold: number; targetSold: number | null }
}

type Mode = "schedule" | "transfer"

export function ScheduleActions({
    detail,
    onApplied,
}: {
    detail: MembershipDetail
    onApplied: () => void
}) {
    const hasProfile = detail.scheduleProfile !== null
    const [mode, setMode] = useState<Mode>(hasProfile ? "schedule" : "transfer")
    const [category, setCategory] = useState(detail.currentScheduleInput.category ?? "")
    const [frequency, setFrequency] = useState(detail.currentScheduleInput.frequency ?? "")
    const [hours, setHours] = useState<Record<string, string>>(detail.currentScheduleInput.hours)
    const [targetTypeId, setTargetTypeId] = useState("")
    const [reason, setReason] = useState("")
    const [plan, setPlan] = useState<PlanState | null>(null)
    const [blockers, setBlockers] = useState<Blocker[]>([])
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [occupancy, setOccupancy] = useState<Record<string, number>>({})

    // Ocupacion de la sede que se esta mirando, para no mandar a nadie a una
    // franja llena. Clave: "weekday|start-end".
    const occupancyEventId = useMemo(() => {
        if (mode === "schedule") return detail.event.id
        return detail.candidateTypes.find((t) => t.id === targetTypeId)?.eventId ?? ""
    }, [mode, targetTypeId, detail])

    useEffect(() => {
        if (!occupancyEventId) return
        let cancelled = false
        void (async () => {
            const response = await fetch(
                `/api/admin/membership-occupancy?eventId=${occupancyEventId}`,
                { cache: "no-store" }
            )
            const payload = await response.json()
            if (cancelled || !payload.success || !payload.data.occupancy) return
            const map: Record<string, number> = {}
            for (const cell of payload.data.occupancy.dayLoad) {
                map[`${cell.weekday}|${cell.start}-${cell.end}`] = cell.total
            }
            setOccupancy(map)
        })()
        return () => {
            cancelled = true
        }
    }, [occupancyEventId])

    const activeProfile = detail.scheduleProfile
    const activeCategory = activeProfile?.categories.find((c) => c.id === category) ?? null
    const activeFrequency = activeCategory?.frequencies.find((f) => f.id === frequency) ?? null

    const reset = () => {
        setPlan(null)
        setBlockers([])
        setError(null)
    }

    const endpoint =
        mode === "schedule"
            ? `/api/admin/memberships/${detail.ticket.id}/schedule`
            : `/api/admin/memberships/${detail.ticket.id}/transfer`

    const body = (preview: boolean) =>
        mode === "schedule"
            ? { preview, reason, selection: { category, frequency, hours } }
            : {
                  preview,
                  reason,
                  targetTicketTypeId: targetTypeId,
                  selection: category && frequency ? { category, frequency, hours } : undefined,
              }

    const send = async (preview: boolean) => {
        setBusy(true)
        reset()
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body(preview)),
            })
            const payload = await response.json()
            if (!payload.success) {
                if (Array.isArray(payload.blockers)) setBlockers(payload.blockers)
                else setError(payload.error ?? "No se pudo completar la operacion")
                return
            }
            if (preview) {
                setPlan(payload.data.plan as PlanState)
            } else {
                onApplied()
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error de red")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Repeat className="h-5 w-5" />
                    Corregir horario o sede
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <div className="flex gap-2">
                    {hasProfile ? (
                        <Button
                            variant={mode === "schedule" ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                                setMode("schedule")
                                reset()
                            }}
                        >
                            Horario semanal
                        </Button>
                    ) : null}
                    <Button
                        variant={mode === "transfer" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setMode("transfer")
                            reset()
                        }}
                    >
                        {hasProfile ? "Cambiar de sede" : "Cambiar de horario (tipo de entrada)"}
                    </Button>
                </div>

                {mode === "transfer" ? (
                    <label className="block">
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                            Tipo de entrada destino
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={targetTypeId}
                            onChange={(e) => {
                                setTargetTypeId(e.target.value)
                                reset()
                            }}
                        >
                            <option value="">Selecciona…</option>
                            {detail.candidateTypes.map((type: DetailCandidateType) => (
                                <option key={type.id} value={type.id}>
                                    {type.sameEvent ? "" : `${type.eventTitle} · `}
                                    {type.name} ({type.sold}
                                    {type.capacity > 0 ? `/${type.capacity}` : ""} vendidos)
                                </option>
                            ))}
                        </select>
                        {detail.candidateTypes.length === 0 ? (
                            <p className="mt-1 text-slate-500">
                                No hay tipos equivalentes disponibles (mismo precio, duracion, cupo mensual
                                y plan).
                            </p>
                        ) : null}
                    </label>
                ) : null}

                {activeProfile ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Categoria</span>
                            <select
                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                value={category}
                                onChange={(e) => {
                                    setCategory(e.target.value)
                                    setFrequency("")
                                    setHours({})
                                    reset()
                                }}
                            >
                                <option value="">Selecciona…</option>
                                {activeProfile.categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Frecuencia</span>
                            <select
                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                value={frequency}
                                disabled={!activeCategory}
                                onChange={(e) => {
                                    setFrequency(e.target.value)
                                    setHours({})
                                    reset()
                                }}
                            >
                                <option value="">Selecciona…</option>
                                {activeCategory?.frequencies.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {activeFrequency?.dayGroups.map((group) => (
                            <label key={group.id} className="block">
                                <span className="text-xs uppercase tracking-wide text-slate-500">
                                    <Clock className="mr-1 inline h-3 w-3" />
                                    {group.label}
                                </span>
                                <select
                                    className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                    value={hours[group.id] ?? ""}
                                    onChange={(e) => {
                                        setHours({ ...hours, [group.id]: e.target.value })
                                        reset()
                                    }}
                                >
                                    <option value="">Selecciona…</option>
                                    {group.hours.map((hour) => {
                                        const value = `${hour.start}-${hour.end}`
                                        const load = occupancy[`${group.weekdays[0]}|${value}`] ?? 0
                                        return (
                                            <option key={value} value={value}>
                                                {hour.start} - {hour.end} · {load} en la franja
                                            </option>
                                        )
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                ) : null}

                <label className="block">
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                        Motivo (queda en el historial)
                    </span>
                    <Input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Ej. compro CDM por error, asiste en VIDENA"
                        className="mt-1"
                    />
                </label>

                {blockers.length > 0 ? (
                    <div className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800">
                        <p className="flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            No se puede aplicar
                        </p>
                        <ul className="list-inside list-disc space-y-1">
                            {blockers.map((blocker) => (
                                <li key={blocker.code}>{blocker.message}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {error ? <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p> : null}

                {plan ? (
                    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <p className="font-medium text-emerald-900">{plan.label}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <PlanColumn title="Antes" state={plan.before} />
                            <PlanColumn title="Despues" state={plan.after} />
                        </div>
                    </div>
                ) : null}

                <div className="flex gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => void send(true)}>
                        Previsualizar
                    </Button>
                    <Button
                        disabled={busy || plan === null || reason.trim().length < 5}
                        onClick={() => void send(false)}
                    >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Aplicar cambio
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

function PlanColumn({ title, state }: { title: string; state: PlanState["before"] }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wide text-emerald-700">{title}</p>
            <p className="text-slate-900">{state.ticketTypeName}</p>
            <p className="text-slate-600">Sede {state.sucursalCode ?? "—"}</p>
            <p className="text-slate-600">{state.scheduleSummary}</p>
            <p className="text-slate-500">
                Vendidos origen {state.sourceSold}
                {state.targetSold !== null ? ` · destino ${state.targetSold}` : ""}
            </p>
        </div>
    )
}
```

- [ ] **Step 2: Montarlo en la ficha**

En `src/app/admin/membresias/[ticketId]/page.tsx`, agregar el import:

```tsx
import { ScheduleActions } from "./ScheduleActions"
```

Y reemplazar el comentario `{/* 3. Acciones — se agrega en la Task 10 */}` por:

```tsx
<ScheduleActions detail={detail} onApplied={() => void load()} />
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Probar el flujo completo en el navegador**

Con `npm run dev`, en la ficha de un carnet de VIDENA o Campo de Marte:

1. Cambiar la hora, dar **Previsualizar**. Expected: aparece el antes/despues con las sesiones distintas.
2. Intentar **Aplicar** sin motivo. Expected: el boton esta deshabilitado.
3. Escribir motivo y aplicar. Expected: la ficha se recarga, el horario efectivo cambio, y el historial muestra la fila nueva con el motivo.
4. En un carnet que tenga `MembershipMonthlySchedule`, previsualizar. Expected: bloque rojo con el mensaje sobre horarios por mes, sin boton habilitado.
5. Cambiar de sede a un tipo equivalente y aplicar. Expected: la ficha muestra el evento nuevo, y `ticket_types.sold` cambio en ambos lados.

- [ ] **Step 5: Confirmar el suite**

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/membresias/\[ticketId\]
git commit -m "feat(carnets): agrega acciones de horario y sede con vista previa"
```

---

### Task 11: UI — ocupacion por evento

**Files:**
- Create: `src/app/admin/membresias/cupos/page.tsx`
- Modify: `src/app/admin/membresias/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/membership-occupancy`.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Escribir la pagina**

Crear `src/app/admin/membresias/cupos/page.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, BarChart3 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const WEEKDAY_LABEL: Record<number, string> = {
    0: "Domingo",
    1: "Lunes",
    2: "Martes",
    3: "Miercoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sabado",
}

interface SlotRow {
    ticketTypeName: string
    categoryLabel: string
    frequencyLabel: string
    weekday: number
    label: string
    enrolled: number
}

interface DayLoadCell {
    weekday: number
    label: string
    total: number
}

interface PlanRow {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
    available: number | null
}

export default function MembershipOccupancyPage() {
    const [events, setEvents] = useState<Array<{ id: string; title: string }>>([])
    const [eventId, setEventId] = useState("")
    const [slots, setSlots] = useState<SlotRow[]>([])
    const [dayLoad, setDayLoad] = useState<DayLoadCell[]>([])
    const [planTotals, setPlanTotals] = useState<PlanRow[]>([])
    const [loading, setLoading] = useState(false)

    const load = useCallback(async (id: string) => {
        setLoading(true)
        try {
            const query = id ? `?eventId=${id}` : ""
            const response = await fetch(`/api/admin/membership-occupancy${query}`, {
                cache: "no-store",
            })
            const payload = await response.json()
            if (!payload.success) return
            setEvents(payload.data.events)
            setSlots(payload.data.occupancy?.slots ?? [])
            setDayLoad(payload.data.occupancy?.dayLoad ?? [])
            setPlanTotals(payload.data.occupancy?.planTotals ?? [])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load(eventId)
    }, [eventId, load])

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <Link
                    href="/admin/membresias"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver a membresias
                </Link>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Ocupacion por franja
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <select
                        className="w-full max-w-lg rounded-md border border-slate-300 p-2"
                        value={eventId}
                        onChange={(e) => setEventId(e.target.value)}
                    >
                        <option value="">Selecciona un evento…</option>
                        {events.map((event) => (
                            <option key={event.id} value={event.id}>
                                {event.title}
                            </option>
                        ))}
                    </select>
                    <p className="text-slate-500">
                        Cuenta los carnets que pueden entrar hoy, con el horario efectivo del mes en
                        curso. Es informativo: el unico cupo que se hace cumplir en la venta es el
                        global del tipo de entrada.
                    </p>
                </CardContent>
            </Card>

            {loading ? <p className="text-sm text-slate-500">Calculando…</p> : null}

            {planTotals.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Cupo por plan</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table
                            head={["Plan", "Vendidos", "Cupo", "Disponible"]}
                            rows={planTotals.map((plan) => [
                                plan.name,
                                String(plan.sold),
                                plan.capacity === 0 ? "sin tope" : String(plan.capacity),
                                plan.available === null ? "sin tope" : String(plan.available),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}

            {dayLoad.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Carga por dia y hora (todos los planes)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table
                            head={["Dia", "Franja", "Alumnos"]}
                            rows={dayLoad.map((cell) => [
                                WEEKDAY_LABEL[cell.weekday] ?? String(cell.weekday),
                                cell.label,
                                String(cell.total),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}

            {slots.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Detalle por plan, frecuencia y franja</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table
                            head={["Plan", "Categoria", "Frecuencia", "Dia", "Franja", "Inscritos"]}
                            rows={slots.map((slot) => [
                                slot.ticketTypeName,
                                slot.categoryLabel,
                                slot.frequencyLabel,
                                WEEKDAY_LABEL[slot.weekday] ?? String(slot.weekday),
                                slot.label,
                                String(slot.enrolled),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}
        </div>
    )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead>
                    <tr className="border-b border-slate-200">
                        {head.map((cell) => (
                            <th key={cell} className="py-2 pr-4 text-xs uppercase tracking-wide text-slate-500">
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="border-b border-slate-100">
                            {row.map((cell, cellIndex) => (
                                <td key={cellIndex} className="py-2 pr-4 text-slate-800">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
```

- [ ] **Step 2: Enlazar desde la lista de membresias**

En `src/app/admin/membresias/page.tsx`, junto al boton de actualizar (cerca de `onClick={loadMemberships}`), agregar:

```tsx
<Link
    href="/admin/membresias/cupos"
    className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
>
    Ocupacion por franja
</Link>
```

- [ ] **Step 3: Verificar que compila y se ve**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Con `npm run dev`, entrar a `/admin/membresias/cupos`, elegir el evento de VIDENA, y confirmar que las tres tablas se pintan con numeros coherentes con lo que muestra `/admin/membresias`.

- [ ] **Step 4: Correr el lint**

Run: `npm run lint`
Expected: sin errores nuevos en los archivos de esta rama.

- [ ] **Step 5: Confirmar el suite completo y el build**

Run: `npm test`
Expected: `# fail 0`.

Run: `npm run build`
Expected: build exitoso. Es la verificacion que importa: las rutas nuevas se compilan como dinamicas y las paginas nuevas como cliente.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/membresias
git commit -m "feat(carnets): agrega vista de ocupacion por franja y evento"
```

---

## Despues del plan

No pushear ni desplegar sin confirmarlo con Giorgio. Cuando toque:

1. `git push origin feat/admin-carnets-horario-sede`.
2. Merge a `origin/staging` primero; a `origin/main` despues. Nunca a Vercel.
3. En el VPS: `prisma migrate deploy` **antes** de `docker compose up -d app`. La imagen se construye en GitHub Actions, nunca en el VPS.
