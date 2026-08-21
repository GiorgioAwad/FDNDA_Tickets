# Gestion de horario y sede de carnets desde el panel admin

Fecha: 2026-08-21
Estado: aprobado, pendiente de plan de implementacion

## Problema

Corregir el horario o la sede de un carnet de membresia hoy solo se puede hacer
desde VS Code, editando un array hardcodeado en un script y corriendolo contra
produccion:

- `scripts/set-membership-schedule.ts` — horario semanal base (CM `01`, VIDENA `03`).
- `scripts/change-academia-schedule.ts` — horario en VMT `04`, donde la franja
  ES el `TicketType`.
- `scripts/reassign-membership-sites.ts` — cambio de sede.

Cada correccion exige escribir a mano los cuids de `Ticket`, `Order`,
`OrderItem`, `TicketType` origen y destino, mas una bateria de valores
esperados. Es lento, no escala a varios casos por semana, y el rastro de por que
se hizo el cambio vive en un mensaje de commit.

`/admin/membresias` ya lista los carnets con busqueda y filtros, pero lo unico
que deja editar es `membershipStartDate`.

Objetivo: que un admin pueda diagnosticar un carnet y corregirle horario o sede
desde el panel, con las mismas guardas que hoy protegen los scripts y dejando
rastro de quien lo hizo y por que.

## Alcance

Entra:

- Cambio de horario semanal (CM `01` / VIDENA `03`).
- Cambio de horario en VMT `04` (mover el carnet de `TicketType`).
- Cambio de sede entre eventos de membresia.
- Diagnostico por carnet: lo que el alumno ve hoy.
- Ocupacion por franja, por evento.
- Historial de cambios administrativos.

Queda **fuera** de este trabajo:

- Congelar un mes, anular carnets, prender doble asistencia
  (`freeze-membership-month.ts`, `cancel-duplicate-batch-carnets.ts`,
  `enable-doble-asistencia.ts`).
- Emitir carnets presenciales, fulfillment manual, cortesias de piscina.
- Deteccion de duplicados y contraste contra la hoja de inscripciones.
- Definir y hacer cumplir un cupo por franja horaria. Hoy no existe ese tope en
  la base: el unico cupo que se hace cumplir es el global del `TicketType`
  (`capacity` / `sold`). Este trabajo muestra ocupacion, no la limita.

## Decisiones tomadas

| Tema | Decision |
|---|---|
| Casos que el script rechaza | Bloquear con motivo legible, sin override. Siguen saliendo por script. |
| Auditoria | Tabla nueva con antes/despues, actor y motivo obligatorio. |
| Cupo por franja | Solo ver ocupacion. No se fija ni se hace cumplir. |
| Forma | Ficha por carnet, no modales sobre la tabla. |
| Rol | `ADMIN` puro, igual que el resto de `/api/admin/memberships`. |
| Boleta en ventas presenciales | No se emite boleta. El panel ni la busca ni la reporta como faltante. |

## Modelo de datos

Modelo nuevo en `prisma/schema.prisma`:

```prisma
enum MembershipChangeKind {
  SCHEDULE   // horario semanal base (CM 01 / VIDENA 03)
  TRANSFER   // movido de TicketType: mismo evento = horario VMT, otro = sede
}

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

`onDelete: Restrict` a proposito: el rastro no se borra ni aunque se borre el
carnet. El resto de relaciones de `Ticket` usan `Cascade` porque son estado
vigente; esto es historia.

`before` y `after` guardan el snapshot relevante segun el `kind`: para `SCHEDULE`
las sesiones normalizadas; para `TRANSFER` evento, tipo, sede, sesiones y los
contadores `sold` de origen y destino.

## Dos operaciones, no tres

Los tres scripts colapsan en dos primitivas, porque cambiar horario en VMT y
cambiar sede son mecanicamente lo mismo: mover el carnet a otro `TicketType`
arrastrando su cupo.

| Operacion | Escribe | Aplica en |
|---|---|---|
| `schedule` | `Ticket.membershipSchedule` y `OrderItem.attendeeData[].membershipSchedule` | solo `01` / `03` |
| `transfer` | `Ticket.eventId`, `Ticket.ticketTypeId`, `OrderItem.ticketTypeId`, `sold -1/+1`, y el horario si el destino tiene catalogo | mismo evento (VMT) o entre eventos (sede) |

Que el horario viva en dos sitios no es redundancia accidental:
`Ticket.membershipSchedule` es lo que valida el escaner en la puerta, y
`OrderItem.attendeeData` es el snapshot del checkout. Nacen iguales en
`order-fulfillment.ts` y se pueden separar. Editar solo el segundo no cambia
nada en la puerta, por eso las dos escrituras van siempre juntas en una
transaccion.

## Donde vive la seguridad

Modulo nuevo `src/lib/membership-transfer.ts`, **puro**, al estilo de
`membership-schedule.ts`: sin Prisma ni env adentro. Recibe un snapshot de datos
planos y la intencion, y devuelve un plan.

```
planMembershipChange(snapshot, intent) -> { blockers[], writes[], before, after }
```

El snapshot trae: carnet, item, tipo origen y destino, evento de cada uno,
cantidad de horarios mensuales, provider de la orden y comprobantes emitidos.

La ruta hace: leer snapshot -> planificar -> devolver la vista previa. Al
confirmar: **releer y replanificar dentro de la transaccion**, abortando si
aparecieron bloqueos o si el `before` ya no coincide con el que vio el admin.
Ahi reviven los `assertEqual` del script: dejan de ser "esperado 1090, recibido
1240" y pasan a ser "este carnet cambio desde que abriste la pantalla".

### Bloqueos

Comunes a ambas operaciones:

- Carnet no `ACTIVE`, u orden no `PAID`.
- `OrderItem.attendeeData` sin exactamente una persona, o esa persona sin
  `matricula`. La matricula sale de ahi (`attendeeData[0].matricula`): es lo que
  liga el carnet con su comprobante ABIO, y en los scripts va hardcodeada en el
  spec del caso.
- El carnet tiene filas en `MembershipMonthlySchedule` (cambios de horario por
  mes ya definidos). Requiere revision manual: mover la base dejaria esos meses
  apuntando a un catalogo que ya no aplica.

Solo en `transfer`:

- Tipo destino inactivo.
- Tipo destino sin cupo: `capacity != 0 && sold + 1 > capacity`.
- `sold` del tipo origen ya en cero (descontar dejaria el contador negativo).
- Tipo destino no equivalente al origen en: `price`, `monthlyClassLimit`,
  `membershipDurationMonths`, `isPackage`, `membershipScheduleKey`.

La equivalencia es lo que permite mover la sede sin nota de credito: la orden y
la boleta no se tocan, asi que el destino tiene que costar y valer exactamente
lo mismo. En la UI eso se traduce en que el selector de sede destino solo lista
tipos equivalentes; el bloqueo es la red de seguridad del servidor.

### Comprobante segun el origen de la venta

`Order.provider` es un `String` libre con default `"IZIPAY"`; los valores en uso
son `IZIPAY`, `PRESENCIAL`, `MOCK` y `COURTESY`.

| `provider` | Regla |
|---|---|
| `IZIPAY` | Debe existir `Invoice` con `status = ISSUED` y `servilexGroupKey` terminado en `:MATRICULA:<matricula>`. Si no, **bloqueo**: una orden pagada sin boleta significa que la emision ABIO fallo o la matricula no cuadra, y eso se arregla antes de mover sedes. |
| `PRESENCIAL`, `COURTESY` | **No se emite boleta.** El panel no consulta comprobantes ni los reporta como faltantes. En la ficha aparece como dato plano: "Venta presencial · sin boleta". |
| `MOCK` | **Bloqueo.** Una orden `MOCK` en produccion viene del incidente de Vercel (`PAYMENTS_MODE=mock` sobre BD de produccion): esa entrada se anula, no se le reasigna sede. |

La lista de providers va explicita en el codigo, sin `else` de cajon, para que
agregar una pasarela nueva sea anadir una fila y no descubrir el hueco en
produccion.

`reassign-membership-sites.ts` hoy exige el comprobante siempre. Portar esa
guarda tal cual romperia con los carnets presenciales, que nacen con
`totalAmount = 0` y sin ninguna fila en `Invoice` — `issue-presential-carnets.ts`
crea la orden y el ticket con `tx.ticket.create` sin pasar por
`fulfillPaidOrder`, y `grant-piscina-courtesy.ts` tampoco toca comprobantes.

### Horario incompatible con la sede destino

No es un bloqueo, es un campo requerido. Si el horario actual no existe en el
catalogo de la sede destino, el formulario obliga a elegir uno nuevo en el mismo
paso. Caso real: una franja de adultos en Campo de Marte que en VIDENA es de
ninos.

## Endpoints

Todos bajo `ADMIN`, igual que `/api/admin/memberships`.

| Ruta | Que hace |
|---|---|
| `GET /api/admin/memberships/[ticketId]` | Ficha completa: carnet, diagnostico, opciones de horario del perfil, tipos destino equivalentes, historial. |
| `POST /api/admin/memberships/[ticketId]/schedule` | `{ selection, reason, preview? }`. Con `preview` devuelve el plan sin escribir. |
| `POST /api/admin/memberships/[ticketId]/transfer` | `{ targetTicketTypeId, selection?, reason, preview? }`. Detecta mismo evento (horario VMT) o distinto (sede). |
| `GET /api/admin/membership-occupancy?eventId=` | Ocupacion por franja del evento. |

## La ficha `/admin/membresias/[ticketId]`

`/admin/membresias` sigue siendo el buscador; cada fila enlaza a la ficha.
Cuatro bloques, en el orden en que se resuelve un caso real:

**1. Quien es y que compro.** Nombre, DNI, matricula, evento y sede, plan,
duracion, fecha de inicio, origen del carnet (web con su numero de boleta, o
presencial/cortesia sin boleta).

**2. Que ve el alumno hoy.** Estado exacto del carnet (`QR activo` / `aun no
inicia` / `congelada` / `no disponible`), horario **efectivo del mes en curso**
(no el del checkout), vencimiento, clases usadas del cupo mensual, y ultimos
escaneos con su resultado. Reuso directo de `scan-helpers.ts`:
`getMembershipAccessStatus`, `getEffectiveScheduleSelection`,
`buildMembershipDisplay`, `buildAttendanceSummary`, `getMembershipExpiry`. Es la
misma logica que corre en la puerta, asi que lo que se ve aca es lo que le va a
pasar al alumno al escanear.

**3. Acciones.** El panel muestra el control que corresponde a la sede, sin
pedirle al admin que elija cual:

- CM `01` / VIDENA `03`: selector en cascada de horario (categoria -> frecuencia
  -> una hora por grupo de dias), poblado desde el perfil real de
  `MEMBERSHIP_SCHEDULES`, con la ocupacion de cada franja al lado. Y selector de
  sede destino, que solo lista tipos equivalentes.
- VMT `04`: lista de los `TicketType` del evento, que ahi son las franjas, con
  vendidos y cupo de cada uno.

Cada accion es previsualizar -> confirmar. La previsualizacion muestra el
antes/despues lado a lado y las escrituras exactas, incluido el `sold -1/+1`. El
motivo es obligatorio: sin el, el boton no se habilita.

**4. Historial.** Los `MembershipAdminChange` del carnet: quien, cuando, que
cambio y por que.

## La ocupacion `/admin/membresias/cupos`

Se elige evento y se ven tres cosas, calculadas con el horario **efectivo del
mes** (aplicando los cambios mensuales, no el del checkout):

1. **Matriz plan x frecuencia x dia x hora** con inscritos vigentes por franja.
2. **Carga por dia y hora**: cuanta gente entra al agua en esa franja sumando
   todos los planes.
3. **Cupo por plan**: `capacity` / `sold` global del `TicketType`, el unico tope
   que hoy se hace cumplir.

Funciona para cualquier evento de membresia, incluido VMT, donde cada franja es
un tipo y la ocupacion sale directo de `sold`.
`report-cupos-horarios-membresias.ts` esta cableado a `01` y `03`; esto no.

El calculo vive en un modulo puro y testeado
(`src/lib/membership-occupancy.ts`), separado de la ruta, para que la matriz no
mienta.

## Tests

Con `node:test` sobre modulos puros, alimentados con snapshots armados a mano y
sin base de datos, igual que `src/lib/membership-schedule.test.ts`.

`membership-transfer.test.ts`:

- Cada bloqueo dispara cuando debe y no dispara cuando no debe: tipo no
  equivalente en precio, duracion, cupo mensual o `isPackage`; destino inactivo
  o lleno; `sold` origen en cero; carnet con horarios mensuales; orden no
  pagada.
- `IZIPAY` sin boleta bloquea; `PRESENCIAL` y `COURTESY` ni consultan; `MOCK`
  bloquea.
- El horario destino se revalida contra el catalogo de la sede nueva, y se exige
  elegir uno cuando el actual no existe alla.
- Las escrituras del plan reproducen lo que hoy hace el script, incluido el par
  `sold -1/+1`.
- Replanificar sobre un snapshot cambiado aborta en vez de escribir.

`membership-occupancy.test.ts`:

- La ocupacion usa el horario efectivo del mes, no el del checkout.
- Solo cuenta carnets `ACTIVE` de ordenes `PAID` y vigentes a la fecha.
- Un carnet congelado no cuenta en el mes congelado.
- VMT agrupa por `TicketType` en vez de por sesiones.

El proyecto no tiene script `test` en `package.json` ni CI que corra los tests,
aunque el comando funciona. Se agrega:

```json
"test": "tsx --test \"src/lib/*.test.ts\""
```

Baseline al 2026-08-21: 167 tests, todos en verde.

## Despliegue

Hay migracion (`MembershipAdminChange` y su enum), asi que en el VPS va
`prisma migrate deploy` **antes** de `docker compose up -d app`. La imagen se
construye en GitHub Actions, nunca en el VPS.

Los scripts que este trabajo reemplaza se conservan: siguen siendo la salida
para los casos que el panel bloquea a proposito.
