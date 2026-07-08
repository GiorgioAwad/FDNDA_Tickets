/**
 * Habilita "doble asistencia" (allowMultipleDailyScans) en TicketTypes de
 * membresía por su membershipScheduleKey. Con el flag prendido:
 *   - Panel manual: hasta 2 ingresos/día (el 2º cuenta como clase del cupo).
 *   - Escáner QR: planes con horario semanal (BRONCE/PLATA) tienen el mismo
 *     tope de 2/día; ORO (sin horario) sigue ilimitado.
 *
 * Por defecto DRY-RUN: lista TODAS las membresías (monthlyClassLimit > 0) con
 * su flag actual y marca cuáles cambiaría, sin escribir nada.
 *   tsx scripts/enable-doble-asistencia.ts
 *
 * Para aplicar:
 *   APPLY=1 tsx scripts/enable-doble-asistencia.ts
 *
 * Por defecto apunta a BRONCE y BRONCE_2X. Otras keys (ej. incluir PLATA):
 *   KEYS=BRONCE,BRONCE_2X,PLATA APPLY=1 tsx scripts/enable-doble-asistencia.ts
 *
 * No carga .env por sí solo: correr con DATABASE_URL en el entorno (igual que
 * los demás scripts).
 */
import { prisma } from "@/lib/prisma"

const APPLY = process.env.APPLY === "1"
const KEYS = (process.env.KEYS ?? "BRONCE,BRONCE_2X")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean)

async function main() {
    console.log(
        `\n========== DOBLE ASISTENCIA  [${APPLY ? "APPLY (escribe)" : "DRY-RUN (solo lectura)"}]  keys=${KEYS.join(",")} ==========\n`
    )

    const memberships = await prisma.ticketType.findMany({
        where: { monthlyClassLimit: { gt: 0 } },
        select: {
            id: true,
            name: true,
            monthlyClassLimit: true,
            membershipScheduleKey: true,
            allowMultipleDailyScans: true,
            isActive: true,
            event: { select: { title: true } },
        },
        orderBy: [{ event: { title: "asc" } }, { name: "asc" }],
    })

    if (memberships.length === 0) {
        console.log("No hay TicketTypes de membresía (monthlyClassLimit > 0).")
        return
    }

    const targets = memberships.filter(
        (tt) => tt.membershipScheduleKey && KEYS.includes(tt.membershipScheduleKey.toUpperCase()) && !tt.allowMultipleDailyScans
    )

    for (const tt of memberships) {
        const isTarget = targets.some((t) => t.id === tt.id)
        const marker = isTarget ? "-> HABILITAR" : ""
        console.log(
            `  [${tt.allowMultipleDailyScans ? "ON " : "off"}] ${tt.event.title} / ${tt.name}` +
                `  (key=${tt.membershipScheduleKey ?? "-"}, cupo=${tt.monthlyClassLimit}/mes, ${tt.isActive ? "activo" : "inactivo"}, id=${tt.id})  ${marker}`
        )
    }

    console.log(`\nTotal membresías: ${memberships.length}. A habilitar: ${targets.length}.`)

    if (targets.length === 0) {
        console.log("Nada que cambiar (los targets ya están ON o no hay match de key).")
        return
    }

    if (!APPLY) {
        console.log("\n(DRY-RUN: no se escribió nada. Aplicar: APPLY=1 tsx scripts/enable-doble-asistencia.ts)")
        return
    }

    const result = await prisma.ticketType.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { allowMultipleDailyScans: true },
    })
    console.log(`\nAPPLY OK: ${result.count} TicketType(s) con doble asistencia habilitada.`)
}

main()
    .catch((error) => {
        console.error("[enable-doble-asistencia] Error:", error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
