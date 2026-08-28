# Panel de emision de carnets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin emita un carnet desde `/admin/carnets` a un usuario ya registrado, eligiendo evento, tipo de entrada y horario, con las mismas guardas que hoy protegen a `scripts/issue-presential-carnets.ts`.

**Architecture:** La logica de emision sale del script a dos modulos de dominio: `carnet-issuance-rules.ts` (puro, testeable sin base de datos) y `carnet-issuance.ts` (carga de BD + transaccion). El panel y el script quedan como adaptadores del mismo nucleo. La auditoria vive en `Order.providerResponse` para no requerir migracion de Prisma.

**Tech Stack:** Next.js 15 App Router, React 19 client components, Prisma, TypeScript, `node:test` via `tsx`, Tailwind.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-08-27-panel-emision-carnets-design.md`.
- Rama de trabajo: `feat/panel-emision-carnets` (ya creada, con el spec commiteado).
- **Cero migraciones de Prisma.** Ningun task modifica `prisma/schema.prisma`.
- **No se toca `reserveTicketTypeDateInventory()`** en `src/lib/ticket-date-inventory.ts`: corre en el checkout de produccion.
- **No se toca `fulfillPaidOrder()`**. El panel nunca dispara Servilex/ABIO.
- Los tests corren con `npm test`, que ejecuta `tsx --test "src/lib/*.test.ts"`. Un test que necesite base de datos **no** entra ahi: la logica testeable debe recibir los datos ya cargados.
- Todos los mensajes de error hacia el usuario van en espanol.
- Todas las rutas API nuevas exigen `hasRole(user.role, "ADMIN")`.
- El monto por defecto es `0` y **nunca** se emite comprobante.
- Commits en espanol, con el prefijo del repo (`feat(carnets):`, `refactor(lib):`).

---

### Task 1: Extraer `buildEntitlementDates` a un modulo puro

`buildEntitlementDates()` vive hoy dentro de `src/lib/order-fulfillment.ts`, que importa Prisma, Servilex y el SDK de correo. La capa de reglas del Task 2 necesita esa funcion y debe poder importarse desde un test sin arrastrar nada de eso. Es un movimiento sin cambio de comportamiento.

**Files:**
- Create: `src/lib/entitlement-dates.ts`
- Create: `src/lib/entitlement-dates.test.ts`
- Modify: `src/lib/order-fulfillment.ts` (borrar lineas 360-368 y 397-480; importar del modulo nuevo)
- Modify: `scripts/issue-presential-carnets.ts:28` (cambiar el import)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `buildEntitlementDates(input): Date[]` y `toDateObjectsFromDateStrings(values: string[]): Date[]` desde `@/lib/entitlement-dates`.

- [ ] **Step 1: Crear el modulo con la funcion movida tal cual**

Crear `src/lib/entitlement-dates.ts`. El cuerpo de `buildEntitlementDates` y de `toDateObjectsFromDateStrings` se copia **literal** desde `src/lib/order-fulfillment.ts` (lineas 360-368 y 397-480). No cambiar ni una condicion: este task no altera comportamiento.

```ts
import type { Prisma } from "@prisma/client"

import { extractTicketValidDates, normalizeScheduleSelections } from "@/lib/ticket-schedule"
import { getDaysBetween } from "@/lib/utils"

/** Lo minimo que `buildEntitlementDates` lee del asistente. */
export type EntitlementAttendee = {
    scheduleSelections?: unknown
}

export const toDateObjectsFromDateStrings = (values: string[]): Date[] => {
    const unique = Array.from(new Set(values))
    return unique.map((value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
        if (!match) return new Date(value)
        const [, year, month, day] = match
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
    })
}

export const buildEntitlementDates = (input: {
    ticketType: {
        isPackage: boolean
        packageDaysCount: number | null
        monthlyClassLimit?: number | null
        validDays: Prisma.JsonValue | null
    }
    event: {
        startDate: Date
        endDate: Date
    }
    attendee: EntitlementAttendee | null
    eventCategory?: string
}): Date[] => {
    // Membresías con cupo mensual: NO se pre-generan entitlements. Cada clase
    // crea el entitlement del día al vuelo durante el escaneo, y el control de
    // asistencia cuenta lo usado dentro del mes en curso (use-it-or-lose-it).
    if (input.ticketType.monthlyClassLimit) {
        return []
    }

    const configuredDates = extractTicketValidDates(input.ticketType.validDays)
    const allEventDates = getDaysBetween(input.event.startDate, input.event.endDate)
        .map((date) => date.toISOString().split("T")[0])
    const selectedDates = normalizeScheduleSelections(input.attendee?.scheduleSelections).map(
        (selection) => selection.date
    )

    // Piscina libre: solo 1 entitlement (el dia seleccionado)
    if (input.eventCategory === "PISCINA_LIBRE") {
        // Bolsa (paquete): NO se pre-generan entitlements. Cada visita se crea como
        // una PoolVisitReservation al reservar desde "Mi cuenta".
        if (input.ticketType.isPackage && input.ticketType.packageDaysCount) {
            return []
        }
        if (selectedDates.length > 0) {
            return toDateObjectsFromDateStrings([selectedDates[0]])
        }
        return [input.event.startDate]
    }

    if (input.ticketType.isPackage && input.ticketType.packageDaysCount) {
        const requiredDays = input.ticketType.packageDaysCount
        const chosenDates: string[] = []

        for (const date of selectedDates) {
            if (!chosenDates.includes(date)) {
                chosenDates.push(date)
            }
            if (chosenDates.length >= requiredDays) break
        }

        if (chosenDates.length < requiredDays) {
            for (const date of configuredDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        if (chosenDates.length < requiredDays) {
            for (const date of allEventDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        return toDateObjectsFromDateStrings(chosenDates.slice(0, requiredDays))
    }

    if (selectedDates.length > 0) {
        return toDateObjectsFromDateStrings(selectedDates)
    }

    if (configuredDates.length > 0) {
        return toDateObjectsFromDateStrings(configuredDates)
    }

    return getDaysBetween(input.event.startDate, input.event.endDate)
}
```

Comparar contra `src/lib/order-fulfillment.ts` lineas 410-480 antes de seguir: debe ser identico.

- [ ] **Step 2: Escribir el test que fija el comportamiento actual**

Crear `src/lib/entitlement-dates.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import { buildEntitlementDates } from "./entitlement-dates"

const event = {
    startDate: new Date(Date.UTC(2026, 8, 1, 12)),
    endDate: new Date(Date.UTC(2026, 8, 3, 12)),
}

const toKeys = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10))

test("una membresia con cupo mensual no pre-genera entitlements", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: 12, validDays: null },
        event,
        attendee: null,
    })
    assert.deepEqual(dates, [])
})

test("piscina libre genera un solo dia: el elegido", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: null, validDays: null },
        event,
        attendee: { scheduleSelections: [{ date: "2026-09-02", shift: null }] },
        eventCategory: "PISCINA_LIBRE",
    })
    assert.deepEqual(toKeys(dates), ["2026-09-02"])
})

test("una bolsa de piscina no pre-genera entitlements", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: true, packageDaysCount: 10, monthlyClassLimit: null, validDays: null },
        event,
        attendee: null,
        eventCategory: "PISCINA_LIBRE",
    })
    assert.deepEqual(dates, [])
})

test("un paquete toma exactamente packageDaysCount fechas elegidas", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: true, packageDaysCount: 2, monthlyClassLimit: null, validDays: null },
        event,
        attendee: {
            scheduleSelections: [
                { date: "2026-09-01", shift: null },
                { date: "2026-09-03", shift: null },
                { date: "2026-09-02", shift: null },
            ],
        },
    })
    assert.deepEqual(toKeys(dates), ["2026-09-01", "2026-09-03"])
})

test("una entrada de evento sin seleccion cubre todo el rango del evento", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: null, validDays: null },
        event,
        attendee: null,
    })
    assert.equal(dates.length, 3)
})
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS. Si falla, el cuerpo copiado en el Step 1 no es identico al original — corregirlo, no ajustar el test.

- [ ] **Step 4: Borrar la funcion vieja y reapuntar los imports**

En `src/lib/order-fulfillment.ts`:
1. Borrar `toDateObjectsFromDateStrings` (lineas 360-368) y `buildEntitlementDates` (lineas 397-480).
2. Agregar `import { buildEntitlementDates } from "@/lib/entitlement-dates"`.
3. Quitar de la linea 5 los imports que queden sin uso (`extractTicketValidDates`, y `normalizeScheduleSelections` si ya no se usa) y de la linea 2 `getDaysBetween` si quedo huerfano. TypeScript los va a marcar.

En `scripts/issue-presential-carnets.ts:28`, cambiar:

```ts
import { buildEntitlementDates } from "@/lib/order-fulfillment"
```

por:

```ts
import { buildEntitlementDates } from "@/lib/entitlement-dates"
```

- [ ] **Step 5: Verificar que compila y que nada mas se rompio**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/entitlement-dates.ts src/lib/entitlement-dates.test.ts src/lib/order-fulfillment.ts scripts/issue-presential-carnets.ts
git commit -m "refactor(lib): extrae buildEntitlementDates a un modulo puro"
```

---

### Task 2: Capa de reglas pura (`carnet-issuance-rules.ts`)

Toda la validacion de negocio, sobre datos ya cargados. Sin Prisma, sin `fetch`, sin efectos.

**Files:**
- Create: `src/lib/carnet-issuance-rules.ts`
- Create: `src/lib/carnet-issuance-rules.test.ts`

**Interfaces:**
- Consumes: `buildEntitlementDates` de `@/lib/entitlement-dates` (Task 1).
- Produces:
  - `type CarnetIssuanceInput`
  - `type CarnetTicketTypeContext`
  - `type CarnetValidationContext`
  - `type CarnetPlan`
  - `type CarnetValidationResult = { ok: true; plan: CarnetPlan } | { ok: false; errors: string[] }`
  - `function validateCarnetRequest(ctx: CarnetValidationContext): CarnetValidationResult`
  - `function buildPanelSourceRef(userId: string, ticketTypeId: string, now?: Date): string`

- [ ] **Step 1: Escribir el archivo de tipos y la funcion vacia**

Crear `src/lib/carnet-issuance-rules.ts`:

```ts
import type { Prisma } from "@prisma/client"

import { isBlackoutMonth } from "@/lib/membership-config"
import {
    getMembershipScheduleProfile,
    validateMembershipScheduleSelection,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { buildEntitlementDates } from "@/lib/entitlement-dates"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type CarnetIssuanceInput = {
    userId: string
    ticketTypeId: string
    attendeeName?: string | null
    attendeeDni?: string | null
    amountPaid?: number
    membershipStartDate?: string | null
    membershipSchedule?: MembershipScheduleInput | null
    scheduleSelections?: Array<{ date: string; shift?: string | null }>
    sourceRef: string
    reason: string
    forceCapacity?: boolean
    allowExistingActive?: boolean
    sendEmail?: boolean
}

/** El TicketType con su evento, ya cargado desde la BD. */
export type CarnetTicketTypeContext = {
    id: string
    name: string
    isActive: boolean
    capacity: number
    sold: number
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    membershipScheduleKey: string | null
    isPackage: boolean
    packageDaysCount: number | null
    validDays: Prisma.JsonValue | null
    eventId: string
    event: {
        id: string
        title: string
        category: string
        servilexSucursalCode: string
        startDate: Date
        endDate: Date
        membershipStartFixed: Date | null
        membershipStartMin: Date | null
        membershipStartMax: Date | null
    }
}

/** Inventario por fecha de un ticketType de piscina libre. */
export type CarnetDateInventory = {
    date: string
    capacity: number
    sold: number
    isEnabled: boolean
}

export type CarnetValidationContext = {
    input: CarnetIssuanceInput
    user: { id: string; email: string; name: string }
    ticketType: CarnetTicketTypeContext
    /** Codigo del carnet ACTIVE que este usuario ya tiene para este tipo, si hay. */
    existingActiveTicketCode: string | null
    /** Id de la orden previa con el mismo sourceRef, si ya se emitio. */
    duplicateOrderId: string | null
    /** Solo para piscina libre: inventario configurado del ticketType. */
    dateInventory: CarnetDateInventory[]
}

export type CarnetPlan = {
    userId: string
    userEmail: string
    userName: string
    ticketTypeId: string
    ticketTypeName: string
    eventId: string
    eventTitle: string
    attendeeName: string
    attendeeDni: string | null
    amountPaid: number
    membershipStartDate: string | null
    membershipSchedule: MembershipScheduleSelection | null
    scheduleSelections: Array<{ date: string; shift: string | null }>
    /** Fechas de entitlement en formato YYYY-MM-DD, para mostrar en el preview. */
    entitlementDates: string[]
    providerOrderNumber: string
    sourceRef: string
    reason: string
    capacityBefore: number
    capacityTotal: number
    /** True solo si se salto un cupo realmente lleno, no si el check estaba marcado de mas. */
    forcedCapacity: boolean
    allowedExistingActive: boolean
    sendEmail: boolean
    warnings: string[]
}

export type CarnetValidationResult =
    | { ok: true; plan: CarnetPlan }
    | { ok: false; errors: string[] }

/**
 * Referencia de idempotencia para emisiones del panel. El servidor la genera en
 * el preview y la UI la devuelve al emitir, de modo que un doble clic choque
 * contra la guarda de duplicados en vez de crear dos carnets.
 */
export function buildPanelSourceRef(userId: string, ticketTypeId: string, now: Date = new Date()): string {
    return `panel:${userId}:${ticketTypeId}:${now.getTime()}`
}

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10)

export function validateCarnetRequest(ctx: CarnetValidationContext): CarnetValidationResult {
    return { ok: false, errors: ["sin implementar"] }
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `src/lib/carnet-issuance-rules.test.ts`. El helper `makeCtx` arma un contexto valido de membresia BRONCE en Campo de Marte (`servilexSucursalCode: "01"`) para que cada test solo sobrescriba lo que le importa.

```ts
import assert from "node:assert/strict"
import test from "node:test"

import { validateCarnetRequest, type CarnetValidationContext } from "./carnet-issuance-rules"

const baseTicketType: CarnetValidationContext["ticketType"] = {
    id: "tt_bronce",
    name: "MEMBRESIA SEMESTRAL BRONCE",
    isActive: true,
    capacity: 100,
    sold: 10,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: "BRONCE",
    isPackage: false,
    packageDaysCount: null,
    validDays: null,
    eventId: "ev_cm",
    event: {
        id: "ev_cm",
        title: "Membresias Campo de Marte 2026",
        category: "ACADEMIA",
        servilexSucursalCode: "01",
        startDate: new Date(Date.UTC(2026, 0, 1, 12)),
        endDate: new Date(Date.UTC(2026, 11, 31, 12)),
        membershipStartFixed: null,
        membershipStartMin: null,
        membershipStartMax: null,
    },
}

/** Overrides con `input` parcial, para que cada test toque solo lo suyo. */
type CtxOverrides = Omit<Partial<CarnetValidationContext>, "input"> & {
    input?: Partial<CarnetValidationContext["input"]>
}

function makeCtx(overrides: CtxOverrides = {}): CarnetValidationContext {
    const { input: inputOverrides, ...rest } = overrides
    return {
        user: { id: "u1", email: "alumno@example.com", name: "Ana Torres" },
        ticketType: baseTicketType,
        existingActiveTicketCode: null,
        duplicateOrderId: null,
        dateInventory: [],
        ...rest,
        // `input` se arma al final para que un override parcial se fusione con
        // los defaults en vez de reemplazarlos.
        input: {
            userId: "u1",
            ticketTypeId: "tt_bronce",
            attendeeDni: "12345678",
            amountPaid: 0,
            membershipStartDate: "2026-09-01",
            membershipSchedule: { category: "ADULTOS", frequency: "LMV", hours: { main: "07:00-08:00" } },
            sourceRef: "panel:u1:tt_bronce:1",
            reason: "Regularizacion de inscrito presencial",
            ...inputOverrides,
        },
    }
}

const errorsOf = (result: ReturnType<typeof validateCarnetRequest>) =>
    result.ok ? [] : result.errors

test("una membresia con horario valido produce un plan", () => {
    const result = validateCarnetRequest(makeCtx())
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.plan.membershipStartDate, "2026-09-01")
    assert.equal(result.plan.membershipSchedule?.profileKey, "BRONCE")
    assert.equal(result.plan.membershipSchedule?.sessions.length, 3) // L, M, V
    assert.equal(result.plan.attendeeName, "Ana Torres") // default: nombre del usuario
    assert.deepEqual(result.plan.entitlementDates, []) // cupo mensual: no pre-genera
    assert.equal(result.plan.providerOrderNumber, "PRES-panel:u1:tt_bronce:1")
})

test("falta el motivo", () => {
    const result = validateCarnetRequest(makeCtx({ input: { reason: "  " } }))
    assert.match(errorsOf(result).join(" "), /motivo/i)
})

test("un tipo de entrada inactivo se rechaza", () => {
    const result = validateCarnetRequest(
        makeCtx({ ticketType: { ...baseTicketType, isActive: false } })
    )
    assert.match(errorsOf(result).join(" "), /inactivo/i)
})

test("enero y febrero estan bloqueados como inicio de membresia", () => {
    const result = validateCarnetRequest(
        makeCtx({ input: { membershipStartDate: "2027-01-05" } })
    )
    assert.match(errorsOf(result).join(" "), /enero|febrero/i)
})

test("el inicio no puede caer fuera del rango del evento", () => {
    const ticketType = {
        ...baseTicketType,
        event: {
            ...baseTicketType.event,
            membershipStartMin: new Date(Date.UTC(2026, 8, 1, 12)),
            membershipStartMax: new Date(Date.UTC(2026, 8, 30, 12)),
        },
    }
    const result = validateCarnetRequest(
        makeCtx({ ticketType, input: { membershipStartDate: "2026-10-15" } })
    )
    assert.match(errorsOf(result).join(" "), /2026-09-30/)
})

test("una membresia con perfil de horario exige la seleccion", () => {
    const result = validateCarnetRequest(makeCtx({ input: { membershipSchedule: null } }))
    assert.equal(result.ok, false)
    assert.ok(errorsOf(result).length > 0)
})

test("una hora que no esta en el catalogo de la sede se rechaza", () => {
    const result = validateCarnetRequest(
        makeCtx({
            input: {
                membershipSchedule: { category: "ADULTOS", frequency: "LMV", hours: { main: "23:00-23:30" } },
            },
        })
    )
    assert.match(errorsOf(result).join(" "), /no est/i)
})

test("un carnet activo duplicado bloquea, salvo override explicito", () => {
    const blocked = validateCarnetRequest(makeCtx({ existingActiveTicketCode: "ABC12345" }))
    assert.equal(blocked.ok, false)
    assert.match(errorsOf(blocked).join(" "), /ABC12345/)

    const allowed = validateCarnetRequest(
        makeCtx({ existingActiveTicketCode: "ABC12345", input: { allowExistingActive: true } })
    )
    assert.equal(allowed.ok, true)
    if (allowed.ok) assert.ok(allowed.plan.warnings.some((w) => /ABC12345/.test(w)))
})

test("un sourceRef ya emitido bloquea", () => {
    const result = validateCarnetRequest(makeCtx({ duplicateOrderId: "ord_1" }))
    assert.match(errorsOf(result).join(" "), /ya se emiti/i)
})

test("sin cupo global se rechaza, y forceCapacity lo deja pasar con aviso", () => {
    const full = { ...baseTicketType, capacity: 10, sold: 10 }
    const blocked = validateCarnetRequest(makeCtx({ ticketType: full }))
    assert.match(errorsOf(blocked).join(" "), /cupo/i)

    const forced = validateCarnetRequest(
        makeCtx({ ticketType: full, input: { forceCapacity: true } })
    )
    assert.equal(forced.ok, true)
    if (forced.ok) {
        assert.equal(forced.plan.forcedCapacity, true)
        assert.ok(forced.plan.warnings.some((w) => /sobrecupo/i.test(w)))
    }
})

test("piscina libre exige fecha y respeta el inventario del dia", () => {
    const poolType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pool",
        name: "PISCINA LIBRE 3-4 PM",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        event: { ...baseTicketType.event, category: "PISCINA_LIBRE" },
    }
    const poolInput = {
        userId: "u1",
        ticketTypeId: "tt_pool",
        sourceRef: "panel:u1:tt_pool:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
    }

    const sinFecha = validateCarnetRequest(
        makeCtx({ ticketType: poolType, input: poolInput })
    )
    assert.match(errorsOf(sinFecha).join(" "), /fecha/i)

    const cerrada = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 0, isEnabled: false }],
        })
    )
    assert.match(errorsOf(cerrada).join(" "), /cerrad/i)

    const llena = makeCtx({
        ticketType: poolType,
        input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
        dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 30, isEnabled: true }],
    })
    assert.equal(validateCarnetRequest(llena).ok, false)

    // forceCapacity salta el cupo lleno...
    const forzada = validateCarnetRequest({
        ...llena,
        input: { ...llena.input, forceCapacity: true },
    })
    assert.equal(forzada.ok, true)
    if (forzada.ok) assert.deepEqual(forzada.plan.entitlementDates, ["2026-09-02"])

    // ...pero NO una fecha deshabilitada.
    const forzadaCerrada = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }], forceCapacity: true },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 0, isEnabled: false }],
        })
    )
    assert.equal(forzadaCerrada.ok, false)
})

test("un paquete al que le faltan fechas se rechaza", () => {
    const packType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack",
        name: "PAQUETE 3 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 3,
        event: { ...baseTicketType.event, category: "DEPORTIVO" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pack",
                sourceRef: "panel:u1:tt_pack:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [{ date: "2026-09-01" }],
            },
        })
    )
    assert.match(errorsOf(result).join(" "), /3 fecha/i)
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — todos los casos de `carnet-issuance-rules.test.ts` fallan porque `validateCarnetRequest` devuelve `["sin implementar"]`.

- [ ] **Step 4: Implementar `validateCarnetRequest`**

Reemplazar el stub. Acumula **todos** los errores antes de devolver, para que el admin los vea de una sola vez en vez de uno por intento.

```ts
export function validateCarnetRequest(ctx: CarnetValidationContext): CarnetValidationResult {
    const { input, user, ticketType } = ctx
    const errors: string[] = []
    const warnings: string[] = []

    const reason = (input.reason ?? "").trim()
    if (!reason) errors.push("Indica el motivo de la emision.")

    if (!ticketType.isActive) {
        errors.push(`El tipo de entrada "${ticketType.name}" esta inactivo.`)
    }

    if (ctx.duplicateOrderId) {
        errors.push(
            `Este carnet ya se emitio (orden ${ctx.duplicateOrderId.slice(-8).toUpperCase()}).`
        )
    }

    if (ctx.existingActiveTicketCode) {
        if (input.allowExistingActive) {
            warnings.push(
                `${user.email} ya tiene el carnet activo ${ctx.existingActiveTicketCode} para "${ticketType.name}".`
            )
        } else {
            errors.push(
                `${user.email} ya tiene el carnet activo ${ctx.existingActiveTicketCode} para "${ticketType.name}". Marca "permitir duplicado" si es intencional.`
            )
        }
    }

    // ── Cupo global ───────────────────────────────────────────────────────────
    const hasGlobalCap = ticketType.capacity > 0
    const globalFull = hasGlobalCap && ticketType.sold >= ticketType.capacity
    if (globalFull) {
        if (input.forceCapacity) {
            warnings.push(
                `Sobrecupo: "${ticketType.name}" esta en ${ticketType.sold}/${ticketType.capacity}.`
            )
        } else {
            errors.push(
                `No hay cupo para "${ticketType.name}" (${ticketType.sold}/${ticketType.capacity}).`
            )
        }
    }

    // ── Fecha de inicio de membresia ──────────────────────────────────────────
    const isMembership = (ticketType.monthlyClassLimit ?? 0) > 0
    const isFixedTerm = isMembership && (ticketType.membershipDurationMonths ?? 0) > 0
    const fixedStart = ticketType.event.membershipStartFixed
    let membershipStartDate: string | null = fixedStart
        ? toDateKey(fixedStart)
        : (input.membershipStartDate ?? null)

    if (isFixedTerm && !membershipStartDate) {
        errors.push(`Indica la fecha de inicio para "${ticketType.name}".`)
    }

    if (membershipStartDate) {
        if (!DATE_RE.test(membershipStartDate)) {
            errors.push(`La fecha de inicio "${membershipStartDate}" no tiene el formato AAAA-MM-DD.`)
            membershipStartDate = null
        } else {
            if (isBlackoutMonth(Number(membershipStartDate.slice(5, 7)))) {
                errors.push("La membresia no puede empezar en enero ni febrero.")
            }
            const min = ticketType.event.membershipStartMin
                ? toDateKey(ticketType.event.membershipStartMin)
                : null
            const max = ticketType.event.membershipStartMax
                ? toDateKey(ticketType.event.membershipStartMax)
                : null
            if (min && membershipStartDate < min) {
                errors.push(`El inicio ${membershipStartDate} es anterior al minimo ${min}.`)
            }
            if (max && membershipStartDate > max) {
                errors.push(`El inicio ${membershipStartDate} supera el maximo ${max}.`)
            }
        }
    }

    // ── Horario semanal ───────────────────────────────────────────────────────
    const profile = getMembershipScheduleProfile(
        ticketType.event.servilexSucursalCode,
        ticketType.membershipScheduleKey
    )
    let membershipSchedule: MembershipScheduleSelection | null = null
    if (profile) {
        const validation = validateMembershipScheduleSelection(
            profile,
            input.membershipSchedule ?? null,
            ticketType.event.servilexSucursalCode
        )
        if (validation.ok) {
            membershipSchedule = validation.selection
        } else {
            errors.push(validation.error)
        }
    }

    // ── Fechas (piscina libre y paquetes) ─────────────────────────────────────
    const selections = (input.scheduleSelections ?? [])
        .filter((s) => DATE_RE.test(s.date))
        .map((s) => ({ date: s.date, shift: s.shift?.trim() ? s.shift.trim() : null }))

    const isPoolFree = isPoolFreeEventCategory(ticketType.event.category)
    const isBag = ticketType.isPackage && isPoolFree

    let skippedFullDate = false
    if (isPoolFree && !isBag) {
        if (selections.length === 0) {
            errors.push("Elige la fecha de la visita.")
        } else {
            const dateKey = selections[0].date
            const cell = ctx.dateInventory.find((row) => row.date === dateKey)
            if (cell && !cell.isEnabled) {
                // Forzar sobrecupo NO abre una fecha cerrada: cerrarla es una
                // decision operativa, no un tope lleno.
                errors.push(`La fecha ${dateKey} esta cerrada para "${ticketType.name}".`)
            } else if (cell && cell.capacity > 0 && cell.sold >= cell.capacity) {
                if (input.forceCapacity) {
                    skippedFullDate = true
                    warnings.push(
                        `Sobrecupo del dia ${dateKey}: ${cell.sold}/${cell.capacity}.`
                    )
                } else {
                    errors.push(
                        `No hay cupo para "${ticketType.name}" el ${dateKey} (${cell.sold}/${cell.capacity}).`
                    )
                }
            }
        }
    }

    if (ticketType.isPackage && ticketType.packageDaysCount && !isBag) {
        const unique = new Set(selections.map((s) => s.date))
        if (unique.size < ticketType.packageDaysCount) {
            errors.push(
                `"${ticketType.name}" requiere ${ticketType.packageDaysCount} fechas; elegiste ${unique.size}.`
            )
        }
    }

    if (errors.length > 0) return { ok: false, errors }

    const entitlementDates = buildEntitlementDates({
        ticketType: {
            isPackage: ticketType.isPackage,
            packageDaysCount: ticketType.packageDaysCount,
            monthlyClassLimit: ticketType.monthlyClassLimit,
            validDays: ticketType.validDays,
        },
        event: { startDate: ticketType.event.startDate, endDate: ticketType.event.endDate },
        attendee: selections.length > 0 ? { scheduleSelections: selections } : null,
        eventCategory: ticketType.event.category,
    })

    const amountPaid = Number.isFinite(input.amountPaid) ? Number(input.amountPaid) : 0

    return {
        ok: true,
        plan: {
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            ticketTypeId: ticketType.id,
            ticketTypeName: ticketType.name,
            eventId: ticketType.eventId,
            eventTitle: ticketType.event.title,
            attendeeName: (input.attendeeName ?? "").trim() || user.name,
            attendeeDni: (input.attendeeDni ?? "").trim() || null,
            amountPaid: amountPaid < 0 ? 0 : amountPaid,
            membershipStartDate,
            membershipSchedule,
            scheduleSelections: selections,
            entitlementDates: entitlementDates.map(toDateKey),
            providerOrderNumber: `PRES-${input.sourceRef}`,
            sourceRef: input.sourceRef,
            reason,
            capacityBefore: ticketType.sold,
            capacityTotal: ticketType.capacity,
            // Solo true si de verdad se salto un tope lleno. Marcar el check sin
            // que hubiera nada lleno no debe desactivar el guard de la escritura.
            forcedCapacity: Boolean(input.forceCapacity) && (globalFull || skippedFullDate),
            allowedExistingActive: Boolean(ctx.existingActiveTicketCode && input.allowExistingActive),
            sendEmail: input.sendEmail !== false,
            warnings,
        },
    }
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/carnet-issuance-rules.ts src/lib/carnet-issuance-rules.test.ts
git commit -m "feat(carnets): reglas de validacion para emision de carnets"
```

---

### Task 3: Capa de base de datos (`carnet-issuance.ts`)

Carga el contexto, llama a las reglas, y escribe en una transaccion.

**Files:**
- Create: `src/lib/carnet-issuance.ts`

**Interfaces:**
- Consumes: todo lo exportado por `@/lib/carnet-issuance-rules` (Task 2).
- Produces:
  - `planCarnetIssuance(input: CarnetIssuanceInput): Promise<CarnetValidationResult>`
  - `issueCarnet(plan: CarnetPlan, actor: { id: string; email: string }): Promise<{ orderId: string; ticketCode: string; emailSent: boolean; emailError: string | null }>`

- [ ] **Step 1: Escribir el modulo completo**

Crear `src/lib/carnet-issuance.ts`:

```ts
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { sendPurchaseEmail } from "@/lib/email"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { reserveTicketTypeDateInventory } from "@/lib/ticket-date-inventory"
import { formatPrice, generateTicketCode, parseDateOnly } from "@/lib/utils"
import {
    validateCarnetRequest,
    type CarnetIssuanceInput,
    type CarnetPlan,
    type CarnetValidationResult,
} from "@/lib/carnet-issuance-rules"

const TICKET_TYPE_SELECT = {
    id: true,
    name: true,
    isActive: true,
    capacity: true,
    sold: true,
    monthlyClassLimit: true,
    membershipDurationMonths: true,
    membershipScheduleKey: true,
    isPackage: true,
    packageDaysCount: true,
    validDays: true,
    eventId: true,
    event: {
        select: {
            id: true,
            title: true,
            category: true,
            servilexSucursalCode: true,
            startDate: true,
            endDate: true,
            membershipStartFixed: true,
            membershipStartMin: true,
            membershipStartMax: true,
        },
    },
} satisfies Prisma.TicketTypeSelect

/**
 * Carga el contexto desde la BD y valida. No escribe nada: es el dry-run que
 * usan tanto el preview del panel como el script.
 */
export async function planCarnetIssuance(
    input: CarnetIssuanceInput
): Promise<CarnetValidationResult> {
    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, name: true },
    })
    if (!user) return { ok: false, errors: ["El usuario no existe."] }

    const ticketType = await prisma.ticketType.findUnique({
        where: { id: input.ticketTypeId },
        select: TICKET_TYPE_SELECT,
    })
    if (!ticketType) return { ok: false, errors: ["El tipo de entrada no existe."] }

    const [duplicate, existingActive] = await Promise.all([
        prisma.order.findFirst({
            where: { provider: "PRESENCIAL", providerOrderNumber: `PRES-${input.sourceRef}` },
            select: { id: true },
        }),
        prisma.ticket.findFirst({
            where: {
                userId: user.id,
                ticketTypeId: ticketType.id,
                status: "ACTIVE",
                order: { status: "PAID" },
            },
            select: { ticketCode: true },
        }),
    ])

    const dateInventory = isPoolFreeEventCategory(ticketType.event.category)
        ? (
              await prisma.ticketTypeDateInventory.findMany({
                  where: { ticketTypeId: ticketType.id },
                  select: { date: true, capacity: true, sold: true, isEnabled: true },
              })
          ).map((row) => ({
              date: row.date.toISOString().slice(0, 10),
              capacity: row.capacity,
              sold: row.sold,
              isEnabled: row.isEnabled,
          }))
        : []

    return validateCarnetRequest({
        input,
        user: { id: user.id, email: user.email, name: user.name },
        ticketType,
        existingActiveTicketCode: existingActive?.ticketCode ?? null,
        duplicateOrderId: duplicate?.id ?? null,
        dateInventory,
    })
}

/**
 * Escribe el carnet: cupos, orden PRESENCIAL, item, ticket y entitlements, todo
 * en una transaccion. El correo va despues del commit, best-effort.
 */
export async function issueCarnet(
    plan: CarnetPlan,
    actor: { id: string; email: string }
): Promise<{ orderId: string; ticketCode: string; emailSent: boolean; emailError: string | null }> {
    const now = new Date()

    const created = await prisma.$transaction(async (tx) => {
        // 1. Cupo global. Con forceCapacity el incremento va sin guard; sin el,
        //    el guard hace que dos emisiones simultaneas no pasen del tope.
        const ticketType = await tx.ticketType.findUniqueOrThrow({
            where: { id: plan.ticketTypeId },
            select: { capacity: true, name: true, eventId: true, event: { select: { category: true } } },
        })

        const capacityWhere =
            ticketType.capacity > 0 && !plan.forcedCapacity
                ? { sold: { lt: ticketType.capacity } }
                : {}
        const updated = await tx.ticketType.updateMany({
            where: { id: plan.ticketTypeId, isActive: true, ...capacityWhere },
            data: { sold: { increment: 1 } },
        })
        if (updated.count !== 1) {
            throw new Error(`No hay cupo para "${ticketType.name}".`)
        }

        // 2. Cupo por fecha (solo piscina libre).
        if (isPoolFreeEventCategory(ticketType.event.category) && plan.scheduleSelections.length > 0) {
            const dateKey = plan.scheduleSelections[0].date
            if (plan.forcedCapacity) {
                // Incremento sin guard, aqui y no en el helper del checkout.
                const bumped = await tx.ticketTypeDateInventory.updateMany({
                    where: { ticketTypeId: plan.ticketTypeId, date: parseDateOnly(dateKey) },
                    data: { sold: { increment: 1 } },
                })
                if (bumped.count === 0) {
                    throw new Error(`No hay inventario configurado para el ${dateKey}.`)
                }
            } else {
                await reserveTicketTypeDateInventory(tx, {
                    ticketTypeId: plan.ticketTypeId,
                    templateCapacity: 0,
                    reservations: new Map([[dateKey, 1]]),
                    ticketLabel: plan.ticketTypeName,
                    requireConfigured: true,
                })
            }
        }

        const order = await tx.order.create({
            data: {
                userId: plan.userId,
                status: "PAID",
                orderType: "TICKET",
                totalAmount: plan.amountPaid,
                currency: "PEN",
                provider: "PRESENCIAL",
                providerRef: plan.sourceRef,
                providerOrderNumber: plan.providerOrderNumber,
                providerResponse: {
                    source: "admin-carnet-panel",
                    issuedByUserId: actor.id,
                    issuedByEmail: actor.email,
                    reason: plan.reason,
                    forcedCapacity: plan.forcedCapacity,
                    allowedExistingActive: plan.allowedExistingActive,
                    issuedAt: now.toISOString(),
                },
                paidAt: now,
                documentType: "BOLETA",
                buyerDocType: "1",
                buyerDocNumber: plan.attendeeDni,
                buyerName: plan.userName,
                buyerEmail: plan.userEmail,
                orderItems: {
                    create: [
                        {
                            ticketTypeId: plan.ticketTypeId,
                            quantity: 1,
                            unitPrice: plan.amountPaid,
                            subtotal: plan.amountPaid,
                            attendeeData: [
                                {
                                    name: plan.attendeeName,
                                    dni: plan.attendeeDni,
                                    membershipStartDate: plan.membershipStartDate,
                                    membershipSchedule: plan.membershipSchedule,
                                    scheduleSelections: plan.scheduleSelections,
                                },
                            ] as Prisma.InputJsonValue,
                        },
                    ],
                },
            },
            select: { id: true },
        })

        const ticket = await tx.ticket.create({
            data: {
                orderId: order.id,
                userId: plan.userId,
                eventId: plan.eventId,
                ticketTypeId: plan.ticketTypeId,
                ticketCode: generateTicketCode(),
                attendeeName: plan.attendeeName,
                attendeeDni: plan.attendeeDni ?? undefined,
                membershipStartDate: plan.membershipStartDate
                    ? parseDateOnly(plan.membershipStartDate)
                    : null,
                membershipSchedule: plan.membershipSchedule
                    ? (plan.membershipSchedule as unknown as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
                status: "ACTIVE",
                entitlements: {
                    create: plan.entitlementDates.map((dateKey) => ({
                        date: parseDateOnly(dateKey),
                        status: "AVAILABLE" as const,
                    })),
                },
            },
            select: { ticketCode: true },
        })

        return { orderId: order.id, ticketCode: ticket.ticketCode }
    }, { timeout: 30_000 })

    // El carnet ya existe: un fallo de correo no revierte nada.
    let emailSent = false
    let emailError: string | null = null
    if (!plan.sendEmail) {
        return { ...created, emailSent: false, emailError: null }
    }
    try {
        const result = await sendPurchaseEmail(
            plan.userEmail,
            plan.userName,
            created.orderId,
            plan.eventTitle,
            1,
            formatPrice(plan.amountPaid)
        )
        emailSent = result.success
        if (!result.success) emailError = result.error ?? "desconocido"
    } catch (error) {
        emailError = error instanceof Error ? error.message : String(error)
    }

    return { ...created, emailSent, emailError }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores. Si Prisma se queja del `select` de `TicketType`, comparar los nombres de campo contra `prisma/schema.prisma` — no inventar campos.

Run: `npm test`
Expected: PASS (los tests del Task 2 siguen verdes).

- [ ] **Step 3: Commit**

```bash
git add src/lib/carnet-issuance.ts
git commit -m "feat(carnets): planificacion y emision contra base de datos"
```

---

### Task 4: Rutas de catalogo (`options` y `pool-dates`)

Lo que la UI necesita para poblar los selects.

**Files:**
- Create: `src/app/api/admin/carnets/options/route.ts`
- Create: `src/app/api/admin/carnets/pool-dates/route.ts`

**Interfaces:**
- Consumes: `getMembershipScheduleProfile` de `@/lib/membership-schedule`.
- Produces:
  - `GET /api/admin/carnets/options?includeEnded=true` → `{ success: true, data: { events: CarnetOptionEvent[] } }`
  - `GET /api/admin/carnets/pool-dates?ticketTypeId=` → `{ success: true, data: { dates: Array<{ date: string; capacity: number; sold: number; isEnabled: boolean }> } }`

  ```ts
  type CarnetOptionEvent = {
      id: string
      title: string
      category: string
      servilexSucursalCode: string
      startDate: string   // ISO
      endDate: string     // ISO
      membershipStartFixed: string | null
      membershipStartMin: string | null
      membershipStartMax: string | null
      ticketTypes: Array<{
          id: string
          name: string
          price: number
          capacity: number
          sold: number
          monthlyClassLimit: number | null
          membershipDurationMonths: number | null
          isPackage: boolean
          packageDaysCount: number | null
          scheduleProfile: MembershipScheduleProfile | null
      }>
  }
  ```

- [ ] **Step 1: Escribir `options/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { prisma } from "@/lib/prisma"
import { getTodayDateString } from "@/lib/qr"
import { parseDateOnly } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const includeEnded = new URL(request.url).searchParams.get("includeEnded") === "true"

        const events = await prisma.event.findMany({
            where: {
                isActive: true,
                // El dia se calcula en America/Lima, no en el UTC del contenedor.
                ...(includeEnded ? {} : { endDate: { gte: parseDateOnly(getTodayDateString()) } }),
            },
            select: {
                id: true,
                title: true,
                category: true,
                servilexSucursalCode: true,
                startDate: true,
                endDate: true,
                membershipStartFixed: true,
                membershipStartMin: true,
                membershipStartMax: true,
                ticketTypes: {
                    where: { isActive: true },
                    orderBy: { name: "asc" },
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        capacity: true,
                        sold: true,
                        monthlyClassLimit: true,
                        membershipDurationMonths: true,
                        membershipScheduleKey: true,
                        isPackage: true,
                        packageDaysCount: true,
                    },
                },
            },
            orderBy: { startDate: "desc" },
        })

        const data = events.map((event) => ({
            id: event.id,
            title: event.title,
            category: event.category,
            servilexSucursalCode: event.servilexSucursalCode,
            startDate: event.startDate.toISOString(),
            endDate: event.endDate.toISOString(),
            membershipStartFixed: iso(event.membershipStartFixed),
            membershipStartMin: iso(event.membershipStartMin),
            membershipStartMax: iso(event.membershipStartMax),
            ticketTypes: event.ticketTypes.map((tt) => ({
                id: tt.id,
                name: tt.name,
                price: Number(tt.price),
                capacity: tt.capacity,
                sold: tt.sold,
                monthlyClassLimit: tt.monthlyClassLimit,
                membershipDurationMonths: tt.membershipDurationMonths,
                isPackage: tt.isPackage,
                packageDaysCount: tt.packageDaysCount,
                scheduleProfile: getMembershipScheduleProfile(
                    event.servilexSucursalCode,
                    tt.membershipScheduleKey
                ),
            })),
        }))

        return NextResponse.json({ success: true, data: { events: data } })
    } catch (error) {
        console.error("Error cargando opciones de carnets:", error)
        return NextResponse.json({ success: false, error: "Error al cargar opciones" }, { status: 500 })
    }
}
```

- [ ] **Step 2: Escribir `pool-dates/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const ticketTypeId = new URL(request.url).searchParams.get("ticketTypeId")?.trim()
        if (!ticketTypeId) {
            return NextResponse.json({ success: false, error: "Falta ticketTypeId" }, { status: 400 })
        }

        const rows = await prisma.ticketTypeDateInventory.findMany({
            where: { ticketTypeId },
            orderBy: { date: "asc" },
            select: { date: true, capacity: true, sold: true, isEnabled: true },
        })

        return NextResponse.json({
            success: true,
            data: {
                dates: rows.map((row) => ({
                    date: row.date.toISOString().slice(0, 10),
                    capacity: row.capacity,
                    sold: row.sold,
                    isEnabled: row.isEnabled,
                })),
            },
        })
    } catch (error) {
        console.error("Error cargando fechas de piscina:", error)
        return NextResponse.json({ success: false, error: "Error al cargar fechas" }, { status: 500 })
    }
}
```

- [ ] **Step 3: Verificar que compila y responde**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run dev`, entrar autenticado como ADMIN y abrir `http://localhost:3000/api/admin/carnets/options`
Expected: JSON con `success: true` y al menos un evento con sus tipos de entrada. En un tipo BRONCE de Campo de Marte o VIDENA, `scheduleProfile` no debe ser `null`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/carnets/options/route.ts src/app/api/admin/carnets/pool-dates/route.ts
git commit -m "feat(carnets): endpoints de catalogo para el panel de emision"
```

---

### Task 5: Rutas de preview, emision e historial

**Files:**
- Create: `src/app/api/admin/carnets/preview/route.ts`
- Create: `src/app/api/admin/carnets/route.ts`

**Interfaces:**
- Consumes: `planCarnetIssuance`, `issueCarnet` (Task 3); `buildPanelSourceRef` (Task 2).
- Produces:
  - `POST /api/admin/carnets/preview` body `CarnetIssuanceInput` sin `sourceRef` → `{ success: true, data: { plan: CarnetPlan } }` | `{ success: false, errors: string[] }` (HTTP 422)
  - `POST /api/admin/carnets` body `CarnetIssuanceInput` **con** `sourceRef` → `{ success: true, data: { orderId, ticketCode, emailSent, emailError, warnings } }`
  - `GET /api/admin/carnets` → `{ success: true, data: { items: CarnetHistoryItem[] } }`

- [ ] **Step 1: Escribir `preview/route.ts`**

El preview genera el `sourceRef` y lo devuelve dentro del plan; la UI lo reenvia al emitir.

```ts
import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { planCarnetIssuance } from "@/lib/carnet-issuance"
import { buildPanelSourceRef, type CarnetIssuanceInput } from "@/lib/carnet-issuance-rules"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = (await request.json()) as Partial<CarnetIssuanceInput>
        if (!body.userId || !body.ticketTypeId) {
            return NextResponse.json(
                { success: false, errors: ["Elige un usuario y un tipo de entrada."] },
                { status: 400 }
            )
        }

        const input: CarnetIssuanceInput = {
            ...body,
            userId: body.userId,
            ticketTypeId: body.ticketTypeId,
            reason: body.reason ?? "",
            sourceRef: body.sourceRef || buildPanelSourceRef(body.userId, body.ticketTypeId),
        }

        const result = await planCarnetIssuance(input)
        if (!result.ok) {
            return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
        }

        return NextResponse.json({ success: true, data: { plan: result.plan } })
    } catch (error) {
        console.error("Error en preview de carnet:", error)
        return NextResponse.json(
            { success: false, errors: ["Error al previsualizar la emision"] },
            { status: 500 }
        )
    }
}
```

- [ ] **Step 2: Escribir `route.ts` (POST emitir + GET historial)**

El POST **revalida** con `planCarnetIssuance` en vez de confiar en el plan que manda el cliente: entre el preview y el clic pudo llenarse el cupo, y el plan viaja por la red.

```ts
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { issueCarnet, planCarnetIssuance } from "@/lib/carnet-issuance"
import type { CarnetIssuanceInput } from "@/lib/carnet-issuance-rules"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = (await request.json()) as Partial<CarnetIssuanceInput>
        if (!body.userId || !body.ticketTypeId || !body.sourceRef) {
            return NextResponse.json(
                { success: false, errors: ["Previsualiza la emision antes de confirmarla."] },
                { status: 400 }
            )
        }

        // Revalidacion: el cupo pudo cambiar entre el preview y el clic.
        const result = await planCarnetIssuance({
            ...body,
            userId: body.userId,
            ticketTypeId: body.ticketTypeId,
            sourceRef: body.sourceRef,
            reason: body.reason ?? "",
        })
        if (!result.ok) {
            return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
        }

        const issued = await issueCarnet(result.plan, { id: user.id, email: user.email })

        return NextResponse.json({
            success: true,
            data: { ...issued, warnings: result.plan.warnings },
        })
    } catch (error) {
        console.error("Error emitiendo carnet:", error)
        const message = error instanceof Error ? error.message : "Error al emitir el carnet"
        return NextResponse.json({ success: false, errors: [message] }, { status: 500 })
    }
}

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const orders = await prisma.order.findMany({
            where: {
                provider: "PRESENCIAL",
                providerResponse: {
                    path: ["source"],
                    equals: "admin-carnet-panel",
                } as Prisma.JsonFilter,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
                id: true,
                createdAt: true,
                totalAmount: true,
                providerResponse: true,
                user: { select: { name: true, email: true } },
                tickets: {
                    select: {
                        ticketCode: true,
                        attendeeName: true,
                        event: { select: { title: true } },
                        ticketType: { select: { name: true } },
                    },
                },
            },
        })

        const items = orders.map((order) => {
            const meta = (order.providerResponse ?? {}) as Record<string, unknown>
            const ticket = order.tickets[0]
            return {
                orderId: order.id,
                createdAt: order.createdAt.toISOString(),
                amount: Number(order.totalAmount),
                issuedByEmail: typeof meta.issuedByEmail === "string" ? meta.issuedByEmail : "-",
                reason: typeof meta.reason === "string" ? meta.reason : "",
                forcedCapacity: meta.forcedCapacity === true,
                userName: order.user.name,
                userEmail: order.user.email,
                ticketCode: ticket?.ticketCode ?? "-",
                attendeeName: ticket?.attendeeName ?? "-",
                eventTitle: ticket?.event.title ?? "-",
                ticketTypeName: ticket?.ticketType.name ?? "-",
            }
        })

        return NextResponse.json({ success: true, data: { items } })
    } catch (error) {
        console.error("Error cargando historial de carnets:", error)
        return NextResponse.json({ success: false, error: "Error al cargar historial" }, { status: 500 })
    }
}
```

- [ ] **Step 3: Probar el ciclo completo a mano**

Run: `npx tsc --noEmit` → sin errores.

Con `npm run dev` y sesion ADMIN, desde la consola del navegador:

```js
// 1. Preview de una membresia real (reemplazar los ids por los del entorno)
const preview = await fetch("/api/admin/carnets/preview", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "<id de un usuario existente>",
    ticketTypeId: "<id de un ticketType BRONCE>",
    membershipStartDate: "2026-09-01",
    membershipSchedule: { category: "ADULTOS", frequency: "LMV", hours: { main: "07:00-08:00" } },
    reason: "prueba manual",
  }),
}).then((r) => r.json())
console.log(preview)
```

Expected: `success: true`, con `plan.sourceRef` empezando en `panel:`, y `plan.membershipSchedule.sessions` con 3 sesiones.

Repetir el mismo POST sin `reason`.
Expected: HTTP 422 con `errors` mencionando el motivo.

Emitir con el `sourceRef` del preview, y luego **repetir el mismo POST**.
Expected: la primera emision devuelve `ticketCode`; la segunda devuelve 422 con "ya se emitio".

Verificar en `/api/admin/carnets` que el registro aparece en el historial.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/carnets/preview/route.ts src/app/api/admin/carnets/route.ts
git commit -m "feat(carnets): endpoints de preview, emision e historial"
```

---

### Task 6: Buscador de usuarios y shell de la pagina

**Files:**
- Create: `src/app/admin/carnets/page.tsx`
- Create: `src/components/admin/carnets/UserPicker.tsx`
- Modify: `src/components/admin/AdminLayoutClient.tsx` (grupo "Ventas" y el mapa de titulos)

**Interfaces:**
- Consumes: `GET /api/admin/users?search=` (ya existente).
- Produces:
  - `type CarnetUser = { id: string; name: string; email: string }`
  - `<UserPicker value={CarnetUser | null} onChange={(u: CarnetUser | null) => void} />` desde `@/components/admin/carnets/UserPicker`

- [ ] **Step 1: Escribir `UserPicker.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"

export type CarnetUser = { id: string; name: string; email: string }

interface Props {
    value: CarnetUser | null
    onChange: (user: CarnetUser | null) => void
}

export function UserPicker({ value, onChange }: Props) {
    const [term, setTerm] = useState("")
    const [results, setResults] = useState<CarnetUser[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const query = term.trim()
        if (value || query.length < 3) {
            setResults([])
            return
        }
        setLoading(true)
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/admin/users?search=${encodeURIComponent(query)}&pageSize=10`
                )
                const json = await res.json()
                // /api/admin/users responde { success, data: { users, ... } }
                setResults(json?.success ? json.data.users : [])
            } catch {
                setResults([])
            } finally {
                setLoading(false)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [term, value])

    if (value) {
        return (
            <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <div>
                    <p className="text-sm font-medium text-gray-900">{value.name}</p>
                    <p className="text-xs text-gray-500">{value.email}</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        onChange(null)
                        setTerm("")
                    }}
                    className="text-xs font-medium text-sky-700 hover:underline"
                >
                    Cambiar
                </button>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Busca por nombre o correo (minimo 3 letras)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {loading && <p className="text-xs text-gray-500">Buscando...</p>}
            {!loading && term.trim().length >= 3 && results.length === 0 && (
                <p className="text-xs text-gray-500">
                    Sin resultados. El titular debe existir en la web; el panel no crea usuarios.
                </p>
            )}
            <ul className="divide-y divide-gray-100">
                {results.map((user) => (
                    <li key={user.id}>
                        <button
                            type="button"
                            onClick={() => onChange(user)}
                            className="w-full px-1 py-2 text-left hover:bg-gray-50"
                        >
                            <span className="block text-sm text-gray-900">{user.name}</span>
                            <span className="block text-xs text-gray-500">{user.email}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    )
}
```

- [ ] **Step 2: Escribir `page.tsx`**

```tsx
import { redirect } from "next/navigation"

import { CarnetIssueForm } from "@/components/admin/carnets/CarnetIssueForm"
import { getCurrentUser, hasRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function CarnetsPage() {
    const user = await getCurrentUser()
    if (!user || !hasRole(user.role, "ADMIN")) redirect("/admin")

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-semibold text-gray-900">Emitir carnet</h1>
                <p className="text-sm text-gray-600">
                    Emite un carnet a un usuario ya registrado. No genera comprobante: la boleta se
                    emite fuera de la web.
                </p>
            </header>
            <CarnetIssueForm />
        </div>
    )
}
```

Este archivo no compila hasta el Task 7, que crea `CarnetIssueForm`. Es intencional: el Step 4 lo verifica recien entonces.

- [ ] **Step 3: Agregar la entrada de menu**

En `src/components/admin/AdminLayoutClient.tsx`, dentro del grupo `"Ventas"`, justo despues de la linea de `Cortesías`:

```tsx
{ label: "Emitir carnet", href: "/admin/carnets", icon: IdCard },
```

Agregar `IdCard` al import de `lucide-react` que ya existe en ese archivo. Y en el mapa de titulos (cerca de la linea 292), antes del retorno por defecto:

```tsx
if (pathname.includes("/carnets")) return "Emitir carnet"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/carnets/page.tsx src/components/admin/carnets/UserPicker.tsx src/components/admin/AdminLayoutClient.tsx
git commit -m "feat(carnets): pagina del panel y buscador de usuarios"
```

---

### Task 7: Formulario de emision

El bloque grande: seleccion de evento/tipo, campos condicionales, preview y emision.

**Files:**
- Create: `src/components/admin/carnets/CarnetIssueForm.tsx`
- Create: `src/components/admin/carnets/CarnetDetailFields.tsx`

**Interfaces:**
- Consumes: `UserPicker`, `CarnetUser` (Task 6); `MembershipScheduleSelector` de `@/components/membership/MembershipScheduleSelector`; los endpoints de los Tasks 4 y 5.
- Produces: `<CarnetIssueForm />` (sin props), usado por `page.tsx`.

- [ ] **Step 1: Escribir `CarnetDetailFields.tsx`**

Encapsula lo que cambia segun el tipo de entrada, para que el formulario no se convierta en una escalera de `if`.

```tsx
"use client"

import { MembershipScheduleSelector } from "@/components/membership/MembershipScheduleSelector"
import type {
    MembershipScheduleInput,
    MembershipScheduleProfile,
} from "@/lib/membership-schedule"

export type CarnetTicketTypeOption = {
    id: string
    name: string
    price: number
    capacity: number
    sold: number
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    isPackage: boolean
    packageDaysCount: number | null
    scheduleProfile: MembershipScheduleProfile | null
}

export type PoolDate = { date: string; capacity: number; sold: number; isEnabled: boolean }

interface Props {
    ticketType: CarnetTicketTypeOption
    isPoolFree: boolean
    membershipStartFixed: string | null
    startDate: string
    setStartDate: (value: string) => void
    schedule: MembershipScheduleInput
    setSchedule: (value: MembershipScheduleInput) => void
    poolDates: PoolDate[]
    selectedDates: string[]
    setSelectedDates: (value: string[]) => void
}

export function CarnetDetailFields({
    ticketType,
    isPoolFree,
    membershipStartFixed,
    startDate,
    setStartDate,
    schedule,
    setSchedule,
    poolDates,
    selectedDates,
    setSelectedDates,
}: Props) {
    const isMembership = (ticketType.monthlyClassLimit ?? 0) > 0
    const needsPackageDates = ticketType.isPackage && !!ticketType.packageDaysCount && !isPoolFree

    const toggleDate = (date: string) => {
        setSelectedDates(
            selectedDates.includes(date)
                ? selectedDates.filter((d) => d !== date)
                : [...selectedDates, date]
        )
    }

    return (
        <div className="space-y-4">
            {isMembership && (
                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fecha de inicio
                    </label>
                    {membershipStartFixed ? (
                        <p className="text-sm text-gray-600">
                            Fija por el evento: {membershipStartFixed.slice(0, 10)}
                        </p>
                    ) : (
                        <input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                        Enero y febrero estan bloqueados.
                    </p>
                </div>
            )}

            {ticketType.scheduleProfile && (
                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                        Horario semanal
                    </label>
                    <MembershipScheduleSelector
                        profile={ticketType.scheduleProfile}
                        value={schedule}
                        onChange={setSchedule}
                    />
                </div>
            )}

            {isPoolFree && !ticketType.isPackage && (
                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fecha de la visita
                    </label>
                    <p className="mb-2 text-xs text-gray-500">
                        El horario es el tipo de entrada elegido arriba.
                    </p>
                    <select
                        value={selectedDates[0] ?? ""}
                        onChange={(event) => setSelectedDates(event.target.value ? [event.target.value] : [])}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="">Elige una fecha</option>
                        {poolDates.map((row) => (
                            <option key={row.date} value={row.date} disabled={!row.isEnabled}>
                                {row.date} — {row.isEnabled ? `${row.sold}/${row.capacity}` : "cerrado"}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {needsPackageDates && (
                <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                        Fechas del paquete ({selectedDates.length}/{ticketType.packageDaysCount})
                    </label>
                    <input
                        type="date"
                        onChange={(event) => {
                            if (event.target.value) toggleDate(event.target.value)
                            event.target.value = ""
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <ul className="mt-2 flex flex-wrap gap-2">
                        {selectedDates.map((date) => (
                            <li key={date}>
                                <button
                                    type="button"
                                    onClick={() => toggleDate(date)}
                                    className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-800"
                                >
                                    {date} ✕
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Escribir `CarnetIssueForm.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"

import { CarnetDetailFields, type CarnetTicketTypeOption, type PoolDate } from "./CarnetDetailFields"
import { UserPicker, type CarnetUser } from "./UserPicker"
import type { MembershipScheduleInput } from "@/lib/membership-schedule"

type CarnetOptionEvent = {
    id: string
    title: string
    category: string
    membershipStartFixed: string | null
    ticketTypes: CarnetTicketTypeOption[]
}

type CarnetPlanPreview = {
    sourceRef: string
    attendeeName: string
    entitlementDates: string[]
    capacityBefore: number
    capacityTotal: number
    warnings: string[]
    membershipStartDate: string | null
}

export function CarnetIssueForm() {
    const [events, setEvents] = useState<CarnetOptionEvent[]>([])
    const [includeEnded, setIncludeEnded] = useState(false)
    const [user, setUser] = useState<CarnetUser | null>(null)
    const [eventId, setEventId] = useState("")
    const [ticketTypeId, setTicketTypeId] = useState("")
    const [startDate, setStartDate] = useState("")
    const [schedule, setSchedule] = useState<MembershipScheduleInput>({})
    const [poolDates, setPoolDates] = useState<PoolDate[]>([])
    const [selectedDates, setSelectedDates] = useState<string[]>([])
    const [attendeeName, setAttendeeName] = useState("")
    const [attendeeDni, setAttendeeDni] = useState("")
    const [amountPaid, setAmountPaid] = useState("0")
    const [reason, setReason] = useState("")
    const [sendEmail, setSendEmail] = useState(true)
    const [forceCapacity, setForceCapacity] = useState(false)
    const [allowExistingActive, setAllowExistingActive] = useState(false)
    const [plan, setPlan] = useState<CarnetPlanPreview | null>(null)
    const [errors, setErrors] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [issued, setIssued] = useState<{ ticketCode: string; emailError: string | null } | null>(null)

    const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId])
    const ticketType = useMemo(
        () => event?.ticketTypes.find((t) => t.id === ticketTypeId) ?? null,
        [event, ticketTypeId]
    )
    const isPoolFree = event?.category === "PISCINA_LIBRE"

    useEffect(() => {
        fetch(`/api/admin/carnets/options?includeEnded=${includeEnded}`)
            .then((r) => r.json())
            .then((json) => setEvents(json?.success ? json.data.events : []))
            .catch(() => setEvents([]))
    }, [includeEnded])

    // Cualquier cambio de seleccion invalida el preview: emitir siempre usa un
    // plan recien calculado.
    useEffect(() => {
        setPlan(null)
        setIssued(null)
        setErrors([])
    }, [user, eventId, ticketTypeId, startDate, schedule, selectedDates, amountPaid, reason])

    useEffect(() => {
        setTicketTypeId("")
        setSelectedDates([])
    }, [eventId])

    useEffect(() => {
        if (!ticketTypeId || !isPoolFree) {
            setPoolDates([])
            return
        }
        fetch(`/api/admin/carnets/pool-dates?ticketTypeId=${ticketTypeId}`)
            .then((r) => r.json())
            .then((json) => setPoolDates(json?.success ? json.data.dates : []))
            .catch(() => setPoolDates([]))
    }, [ticketTypeId, isPoolFree])

    const buildBody = (sourceRef?: string) => ({
        userId: user?.id,
        ticketTypeId,
        attendeeName: attendeeName.trim() || undefined,
        attendeeDni: attendeeDni.trim() || undefined,
        amountPaid: Number(amountPaid) || 0,
        membershipStartDate: startDate || undefined,
        membershipSchedule: ticketType?.scheduleProfile ? schedule : undefined,
        scheduleSelections: selectedDates.map((date) => ({ date })),
        reason,
        sendEmail,
        forceCapacity,
        allowExistingActive,
        ...(sourceRef ? { sourceRef } : {}),
    })

    const post = async (url: string, sourceRef?: string) => {
        setBusy(true)
        setErrors([])
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildBody(sourceRef)),
            })
            const json = await res.json()
            if (!json?.success) {
                setErrors(json?.errors ?? [json?.error ?? "Error inesperado"])
                return null
            }
            return json.data
        } catch (error) {
            setErrors([error instanceof Error ? error.message : "Error de red"])
            return null
        } finally {
            setBusy(false)
        }
    }

    const onPreview = async () => {
        const data = await post("/api/admin/carnets/preview")
        if (data) setPlan(data.plan)
    }

    const onIssue = async () => {
        if (!plan) return
        const data = await post("/api/admin/carnets", plan.sourceRef)
        if (data) {
            setIssued({ ticketCode: data.ticketCode, emailError: data.emailError })
            setPlan(null)
        }
    }

    return (
        <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-5">
            <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-900">1 · Usuario</h2>
                <UserPicker value={user} onChange={setUser} />
            </section>

            <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-900">2 · Evento y tipo de entrada</h2>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                        type="checkbox"
                        checked={includeEnded}
                        onChange={(e) => setIncludeEnded(e.target.checked)}
                    />
                    Mostrar eventos finalizados
                </label>
                <select
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                    <option value="">Elige un evento</option>
                    {events.map((e) => (
                        <option key={e.id} value={e.id}>{e.title}</option>
                    ))}
                </select>
                {event && (
                    <select
                        value={ticketTypeId}
                        onChange={(e) => setTicketTypeId(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="">Elige un tipo de entrada</option>
                        {event.ticketTypes.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name} — {t.sold}/{t.capacity || "∞"} — S/{t.price}
                            </option>
                        ))}
                    </select>
                )}
            </section>

            {ticketType && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold text-gray-900">3 · Detalle</h2>
                    <CarnetDetailFields
                        ticketType={ticketType}
                        isPoolFree={Boolean(isPoolFree)}
                        membershipStartFixed={event?.membershipStartFixed ?? null}
                        startDate={startDate}
                        setStartDate={setStartDate}
                        schedule={schedule}
                        setSchedule={setSchedule}
                        poolDates={poolDates}
                        selectedDates={selectedDates}
                        setSelectedDates={setSelectedDates}
                    />
                </section>
            )}

            <section className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-900">4 · Datos del carnet</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    <input
                        value={attendeeName}
                        onChange={(e) => setAttendeeName(e.target.value)}
                        placeholder={user?.name ?? "Nombre del asistente"}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        value={attendeeDni}
                        onChange={(e) => setAttendeeDni(e.target.value)}
                        placeholder="DNI"
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                </div>
                <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motivo de la emision (obligatorio)"
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-4 text-xs text-gray-700">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                        Enviar correo al titular
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={forceCapacity} onChange={(e) => setForceCapacity(e.target.checked)} />
                        Forzar sobrecupo
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={allowExistingActive}
                            onChange={(e) => setAllowExistingActive(e.target.checked)}
                        />
                        Permitir duplicado
                    </label>
                </div>
            </section>

            {errors.length > 0 && (
                <ul className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {errors.map((error) => <li key={error}>• {error}</li>)}
                </ul>
            )}

            {plan && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <p className="font-medium">Se va a emitir:</p>
                    <p>{plan.attendeeName} — {ticketType?.name}</p>
                    {plan.membershipStartDate && <p>Inicio: {plan.membershipStartDate}</p>}
                    <p>
                        Dias validos: {plan.entitlementDates.length === 0
                            ? "por clase (cupo mensual)"
                            : `${plan.entitlementDates.length} (${plan.entitlementDates[0]} → ${plan.entitlementDates[plan.entitlementDates.length - 1]})`}
                    </p>
                    <p>Cupo: {plan.capacityBefore} → {plan.capacityBefore + 1} de {plan.capacityTotal || "∞"}</p>
                    {plan.warnings.map((w) => (
                        <p key={w} className="mt-1 font-medium text-amber-700">⚠ {w}</p>
                    ))}
                </div>
            )}

            {issued && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                    <p className="font-medium">Carnet emitido: {issued.ticketCode}</p>
                    {issued.emailError && <p className="text-amber-700">El correo fallo: {issued.emailError}</p>}
                </div>
            )}

            <div className="flex gap-3">
                <button
                    type="button"
                    onClick={onPreview}
                    disabled={busy || !user || !ticketTypeId}
                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                    Previsualizar
                </button>
                <button
                    type="button"
                    onClick={onIssue}
                    disabled={busy || !plan}
                    className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                    Emitir
                </button>
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Probar el flujo en el navegador**

Run: `npx tsc --noEmit` → sin errores. `npm run dev`, entrar a `/admin/carnets`.

Verificar, en este orden:
1. Buscar un usuario por correo y seleccionarlo.
2. Elegir un evento de membresia y un tipo BRONCE → aparece el selector de horario.
3. Sin motivo, **Previsualizar** → error en rojo pidiendo el motivo.
4. Con motivo y horario completo → tarjeta azul con dias validos y cupo.
5. Cambiar la hora del horario → la tarjeta desaparece y el boton Emitir se deshabilita.
6. Previsualizar de nuevo y **Emitir** → recuadro verde con el codigo.
7. Emitir el mismo caso otra vez → error "ya tiene el carnet activo …".
8. Elegir un evento de piscina libre → aparece el selector de fecha con `sold/capacity`, y las fechas cerradas salen deshabilitadas.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/carnets/CarnetIssueForm.tsx src/components/admin/carnets/CarnetDetailFields.tsx
git commit -m "feat(carnets): formulario de emision con preview"
```

---

### Task 8: Historial en el panel

**Files:**
- Create: `src/components/admin/carnets/CarnetHistory.tsx`
- Modify: `src/app/admin/carnets/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/carnets` (Task 5).
- Produces: `<CarnetHistory />` (sin props).

- [ ] **Step 1: Escribir `CarnetHistory.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"

type HistoryItem = {
    orderId: string
    createdAt: string
    amount: number
    issuedByEmail: string
    reason: string
    forcedCapacity: boolean
    userName: string
    userEmail: string
    ticketCode: string
    eventTitle: string
    ticketTypeName: string
}

export function CarnetHistory() {
    const [items, setItems] = useState<HistoryItem[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch("/api/admin/carnets")
            .then((r) => r.json())
            .then((json) => setItems(json?.success ? json.data.items : []))
            .catch(() => setItems([]))
            .finally(() => setLoading(false))
    }, [])

    if (loading) return <p className="text-sm text-gray-500">Cargando historial...</p>
    if (items.length === 0) {
        return <p className="text-sm text-gray-500">Todavia no se emitio ningun carnet desde el panel.</p>
    }

    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Titular</th>
                        <th className="px-3 py-2">Evento / tipo</th>
                        <th className="px-3 py-2">Codigo</th>
                        <th className="px-3 py-2">Monto</th>
                        <th className="px-3 py-2">Emitio</th>
                        <th className="px-3 py-2">Motivo</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((item) => (
                        <tr key={item.orderId}>
                            <td className="px-3 py-2 whitespace-nowrap">
                                {new Date(item.createdAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}
                            </td>
                            <td className="px-3 py-2">
                                <span className="block">{item.userName}</span>
                                <span className="block text-xs text-gray-500">{item.userEmail}</span>
                            </td>
                            <td className="px-3 py-2">
                                <span className="block">{item.eventTitle}</span>
                                <span className="block text-xs text-gray-500">{item.ticketTypeName}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{item.ticketCode}</td>
                            <td className="px-3 py-2">S/{item.amount.toFixed(2)}</td>
                            <td className="px-3 py-2 text-xs">{item.issuedByEmail}</td>
                            <td className="px-3 py-2 text-xs">
                                {item.reason}
                                {item.forcedCapacity && (
                                    <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">sobrecupo</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
```

- [ ] **Step 2: Montarlo en la pagina**

En `src/app/admin/carnets/page.tsx`, agregar el import y la seccion despues de `<CarnetIssueForm />`:

```tsx
import { CarnetHistory } from "@/components/admin/carnets/CarnetHistory"
```

```tsx
            <CarnetIssueForm />
            <section className="space-y-2">
                <h2 className="text-lg font-semibold text-gray-900">Ultimas emisiones</h2>
                <CarnetHistory />
            </section>
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` → sin errores.

En `/admin/carnets`, recargar despues de emitir un carnet en el Task 7.
Expected: la fila aparece con el codigo, el correo del admin y el motivo. Si se forzo el cupo, con la etiqueta ambar.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/carnets/CarnetHistory.tsx src/app/admin/carnets/page.tsx
git commit -m "feat(carnets): historial de emisiones en el panel"
```

---

### Task 9: El script pasa a usar el modulo

`scripts/issue-presential-carnets.ts` deja de tener logica propia. Mismos flags, misma salida.

**Files:**
- Modify: `scripts/issue-presential-carnets.ts`

**Interfaces:**
- Consumes: `planCarnetIssuance`, `issueCarnet` (Task 3); `CarnetIssuanceInput` (Task 2).
- Produces: nada nuevo.

- [ ] **Step 1: Capturar la salida actual como referencia**

Antes de tocar nada, correr el script en dry-run contra un CSV de prueba y guardar la salida:

```bash
npx tsx scripts/issue-presential-carnets.ts --print-template > /tmp/plantilla.csv
npx tsx scripts/issue-presential-carnets.ts --file=<csv de prueba> --batch=refactor-check --event-slug=<slug> --ticket-type-name="<tipo>" > /tmp/antes.txt
```

Expected: el archivo `/tmp/antes.txt` tiene las lineas `OK fila N: ...`. Es la referencia del Step 4.

- [ ] **Step 2: Reemplazar `planRow` y `createIssue`**

Borrar de `scripts/issue-presential-carnets.ts` las funciones `planRow` (desde su definicion hasta el `return` del plan) y `createIssue` completa. Se conservan: `parseArgs`, `flagString`, `flagBool`, `loadRows`, `getCell`, `resolveTicketType`, `scheduleInputFromRow`, `usage`, `printTemplate` y `main`.

En su lugar, una funcion que traduce una fila a `CarnetIssuanceInput`:

```ts
import { planCarnetIssuance, issueCarnet } from "@/lib/carnet-issuance"
import type { CarnetIssuanceInput, CarnetPlan } from "@/lib/carnet-issuance-rules"

async function inputFromRow(
    row: Row,
    rowNumber: number,
    flags: Flags,
    batch: string,
    seenRefs: Set<string>
): Promise<CarnetIssuanceInput> {
    const email = getCell(row, "email", "correo").toLowerCase()
    if (!email) throw new Error(`Fila ${rowNumber}: falta email.`)

    const user = await db().user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
    })
    if (!user) throw new Error(`Fila ${rowNumber}: el usuario ${email} no existe en la web.`)

    const ticketType = await resolveTicketType(row, flags)

    const rawRef = getCell(row, "sourceRef", "ref") || getCell(row, "dni") || email || String(rowNumber)
    const sourceRef = `${batch}:${rawRef}`
    if (seenRefs.has(sourceRef)) {
        throw new Error(`Fila ${rowNumber}: sourceRef duplicado en el archivo (${sourceRef}).`)
    }
    seenRefs.add(sourceRef)

    return {
        userId: user.id,
        ticketTypeId: ticketType.id,
        attendeeName: getCell(row, "attendeeName", "name", "nombre") || undefined,
        attendeeDni: getCell(row, "attendeeDni", "dni", "documentNumber", "documento") || null,
        amountPaid: parseMoney(
            getCell(row, "amountPaid", "amount", "monto") || flagString(flags, "amount") || "0"
        ),
        membershipStartDate: getCell(row, "membershipStartDate", "startDate", "inicio") || null,
        membershipSchedule: scheduleInputFromRow(row),
        sourceRef,
        reason: `Import presencial lote ${batch} (fila ${rowNumber})`,
        forceCapacity: flagBool(flags, "force-capacity"),
        allowExistingActive: flagBool(flags, "allow-existing-active"),
        sendEmail: !flagBool(flags, "no-email"),
    }
}
```

En `main()`, el bucle de planificacion pasa a:

```ts
    for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2
        try {
            const input = await inputFromRow(rows[index], rowNumber, flags, batch, seenRefs)
            const result = await planCarnetIssuance(input)
            if (result.ok) {
                planned.push({ rowNumber, plan: result.plan })
            } else if (result.errors.some((e) => /ya se emiti/i.test(e))) {
                skipped.push({ rowNumber, sourceRef: input.sourceRef, reason: result.errors[0] })
            } else {
                errors.push(`Fila ${rowNumber}: ${result.errors.join(" | ")}`)
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error))
        }
    }
```

`issueCarnet` ya manda el correo y respeta `plan.sendEmail`, asi que **se borra** el bloque de envio de correos al final de `main()` junto con el import de `sendPurchaseEmail` y `formatPrice`. El flag `--no-email` sigue funcionando: viaja como `sendEmail: false` en el input y llega al plan. El resumen de correos se reemplaza por un conteo sobre lo que devuelve `issueCarnet`:

```ts
    const failedEmails = created.filter((item) => item.emailError).length
    console.log(`Correos: ${created.length - failedEmails} enviados, ${failedEmails} fallidos.`)
```

Para eso, el bucle de emision guarda tambien `emailError`:

```ts
    const created: Array<{ email: string; orderId: string; ticketCode: string; emailError: string | null }> = []
    for (const item of planned) {
        const result = await issueCarnet(item.plan, { id: "script", email: `cli:${batch}` })
        created.push({
            email: item.plan.userEmail,
            orderId: result.orderId,
            ticketCode: result.ticketCode,
            emailError: result.emailError,
        })
    }
```

Cambio de comportamiento a declarar en el commit: la emision ya no ocurre dentro de **una sola** transaccion para todas las filas, sino una transaccion por fila. Es lo correcto para un panel (una fila mala no tumba el lote) y para lotes grandes (evita el timeout de 60s), pero significa que un fallo a mitad de camino deja las filas anteriores emitidas. El resumen final ya lista lo emitido, asi que se puede reanudar: los `sourceRef` ya usados se saltan solos.

- [ ] **Step 3: Ajustar los tipos que quedaron colgando**

Borrar los tipos `PlannedIssue` y `SkippedIssue` viejos y reemplazarlos por:

```ts
type PlannedIssue = { rowNumber: number; plan: CarnetPlan }
type SkippedIssue = { rowNumber: number; sourceRef: string; reason: string }
```

Ajustar las lineas de `console.log` del resumen para que lean del `plan`:

```ts
    for (const issue of planned) {
        const p = issue.plan
        console.log(
            `OK fila ${issue.rowNumber}: ${p.userEmail} -> ${p.eventTitle} / ${p.ticketTypeName} | ${p.attendeeName} (${p.attendeeDni ?? "sin DNI"}) | S/${p.amountPaid} | inicio ${p.membershipStartDate || "-"} | dias ${p.entitlementDates.length} | ref=${p.sourceRef}`
        )
    }
```

- [ ] **Step 4: Verificar contra la referencia**

Run: `npx tsc --noEmit` → sin errores.

Run: `npx tsx scripts/issue-presential-carnets.ts --file=<mismo csv> --batch=refactor-check --event-slug=<slug> --ticket-type-name="<tipo>" > /tmp/despues.txt`

Run: `diff /tmp/antes.txt /tmp/despues.txt`
Expected: sin diferencias en las lineas `OK fila N:`. Si difieren, es un cambio de comportamiento real — investigarlo antes de seguir, no ajustar el formato para que calce.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/issue-presential-carnets.ts
git commit -m "refactor(carnets): el script de import usa el modulo de emision"
```

---

## Cierre

- [ ] **Verificacion final**

Run: `npm test` → PASS.
Run: `npx tsc --noEmit` → sin errores.
Run: `npm run build` → build exitoso. (Ojo: `scripts/tmp-*.ts` rompe el build local; si aparece, moverlos fuera antes de buildear.)

- [ ] **Push a staging**

```bash
git push -u origin feat/panel-emision-carnets
```

Luego merge a `origin/staging`, deploy por GitHub Actions/GHCR (nunca buildear en el VPS), y recien despues merge a `origin/main`. **No hay migracion que correr.**
