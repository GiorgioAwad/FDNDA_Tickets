# Panel de emision de carnets desde el admin

Fecha: 2026-08-27
Estado: aprobado, pendiente de plan de implementacion

## Problema

Emitir un carnet a un usuario ya registrado (regularizar a un inscrito
presencial, corregir una compra que no se fulfilleo, dar acceso a alguien que
pago fuera de la web) hoy solo se puede hacer desde VS Code:

- `scripts/issue-presential-carnets.ts` — 771 lineas, exige armar un CSV,
  correrlo en dry-run, revisar la salida en consola y repetir con `--confirm`.
- `scripts/grant-piscina-courtesy.ts` — para piscina libre, con los cuids
  escritos a mano.

`/admin/cortesias` existe pero **no sirve para esto**: genera claim codes sin
entitlements, lo que produce un pase mensual gratis en vez de un carnet acotado.

Objetivo: que un admin emita un carnet desde el navegador eligiendo evento, tipo
de entrada y horario, sobre un usuario que ya existe en la web, con las mismas
guardas que hoy protegen al script y dejando rastro de quien lo emitio y por que.

## Alcance

Entra:

- Emision **uno por uno**, con buscador de usuario.
- Membresias de academia: fecha de inicio + horario semanal (BRONCE / PLATA /
  BRONCE_2X, por sede).
- Piscina libre: fecha, contra el inventario por `(ticketType, fecha)`.
- Paquetes y bolsas: seleccion de las N fechas.
- Entradas de evento normales.
- Monto editable (default `S/0`), **sin** emision de comprobante.
- Consumo de cupo, con opcion explicita de forzar sobrecupo.
- Historial de lo emitido desde el panel.

Queda **fuera** de este trabajo:

- Anular o revocar carnets desde el panel.
- Emision en lote / carga de CSV desde la UI. El script sigue siendo la via
  para lotes.
- Crear usuarios nuevos: el titular debe existir en la web.
- Emitir boleta ABIO. El comprobante se emite fuera de la web; el panel nunca
  toca Servilex.
- Cambiar horario o sede de un carnet ya emitido. Eso es
  `2026-08-21-admin-carnets-horario-sede-design.md`.

## Decisiones

**Modulo de dominio compartido, no logica duplicada.** La logica de emision sale
del script a `src/lib/carnet-issuance.ts`. El panel y el script quedan como dos
adaptadores del mismo nucleo. La alternativa (copiar la logica a la ruta API)
deja dos implementaciones divergentes del camino de escritura mas delicado del
sistema — orden, ticket, entitlements y cupos — y garantiza que en unos meses
una tenga un bug que la otra no.

**No se reusa `fulfillPaidOrder()`.** Esa funcion dispara Servilex/ABIO y asume
pasarela de pago; el camino presencial lo evita a proposito. Reusarla obligaria
a meterle banderas de supresion a la funcion que corre en cada compra web.

**La auditoria vive en `Order.providerResponse`, no en una tabla nueva.** Evita
una migracion de Prisma, y por lo tanto evita el `migrate deploy` en el VPS
antes de levantar la app. Para un panel interno, ese ahorro operativo vale mas
que tener modelo propio.

**No se toca `reserveTicketTypeDateInventory()`.** Ese helper lanza excepcion
cuando no hay cupo y lo usa el checkout en produccion. El camino de "forzar
sobrecupo" se implementa dentro de `carnet-issuance.ts` como un incremento
propio sin guard de capacidad.

## Arquitectura

### 1. `src/lib/carnet-issuance.ts`

Tres capas, separadas para que la validacion sea testeable sin base de datos
(`npm test` corre `tsx --test` sobre `src/lib/*.test.ts`):

```
validateCarnetRequest(ctx)   // puro: reglas de negocio sobre datos ya cargados
planCarnetIssuance(input)    // carga de BD + validate -> plan | errores
issueCarnet(plan, actor)     // transaccion: cupos -> Order -> OrderItem -> Ticket -> entitlements
```

Entrada:

```ts
type CarnetIssuanceInput = {
  userId: string                  // el usuario debe existir; el panel no crea usuarios
  ticketTypeId: string
  attendeeName?: string           // default: nombre del usuario
  attendeeDni?: string | null
  amountPaid: number              // default 0
  membershipStartDate?: string    // YYYY-MM-DD
  membershipSchedule?: MembershipScheduleInput | null
  scheduleSelections?: { date: string; shift: string }[]  // piscina / paquetes
  sourceRef: string               // idempotencia
  reason: string                  // obligatorio, va a la auditoria
  forceCapacity?: boolean
  allowExistingActive?: boolean
  sendEmail?: boolean
}
```

`shift` va en `""` para piscina libre, donde la franja ya esta codificada en el
`ticketType`. Es lo mismo que hace hoy `grant-piscina-courtesy.ts`.

**Quien genera `sourceRef`:** el script lo deriva del CSV (`<lote>:<dni|email|fila>`).
El panel lo genera solo, con la forma `panel:<userId>:<ticketTypeId>:<timestamp>`,
y lo devuelve en la previsualizacion. Al emitir se manda **el mismo** `sourceRef`
que devolvio el preview, de modo que un doble clic en "Emitir" choque contra la
guarda de idempotencia en vez de crear dos carnets.

Reglas de validacion, heredadas del script y generalizadas a cualquier tipo de
entrada:

| Caso | Validacion |
| --- | --- |
| Usuario | Debe existir (`userId`) |
| Tipo de entrada | `isActive`; se resuelve evento, sede y categoria |
| Membresia | Fecha de inicio requerida si es termino fijo; bloqueo enero/febrero (`isBlackoutMonth`); respeta `membershipStartFixed` o el rango `membershipStartMin/Max` |
| Horario semanal | Si `getMembershipScheduleProfile(sede, key)` devuelve perfil, la seleccion es obligatoria y pasa por `validateMembershipScheduleSelection` |
| Piscina libre | Requiere fecha; valida `TicketTypeDateInventory` (`isEnabled` y con cupo) |
| Paquete / bolsa | Requiere las N fechas de `packageDaysCount` |
| Idempotencia | Si ya existe `Order.providerOrderNumber = PRES-<sourceRef>`, no emite |
| Duplicado | Ticket `ACTIVE` del mismo usuario + tipo bloquea, salvo `allowExistingActive` |
| Entitlements | Siempre via `buildEntitlementDates()`, el mismo helper del checkout |

Escritura, en una sola transaccion:

1. Reserva de cupo: incremento de `TicketType.sold` con guard de capacidad, mas
   `reserveTicketTypeDateInventory()` en piscina libre. Con `forceCapacity`, el
   incremento se hace sin guard, dentro de este modulo. `forceCapacity` cubre
   **ambos** cupos: el global del `TicketType` y el de la fecha en piscina libre;
   en ese caso el `sold` del `TicketTypeDateInventory` tambien se incrementa
   directamente, saltando el helper. Lo que `forceCapacity` **no** saltea es
   `isEnabled: false`: una fecha cerrada sigue siendo un error, porque cerrarla
   es una decision operativa, no un tope lleno.
2. `Order` con `provider: "PRESENCIAL"`, `status: "PAID"`, `totalAmount` = monto
   ingresado, `providerOrderNumber = PRES-<sourceRef>`. **Sin Servilex.**
3. `OrderItem` con `attendeeData` (nombre, dni, `membershipStartDate`,
   `membershipSchedule`, `scheduleSelections`).
4. `Ticket` + entitlements en estado `AVAILABLE`.

`providerResponse` guarda la auditoria:

```json
{
  "source": "admin-carnet-panel",
  "issuedByUserId": "...",
  "issuedByEmail": "...",
  "reason": "...",
  "forcedCapacity": false,
  "allowedExistingActive": false,
  "issuedAt": "2026-08-27T..."
}
```

El correo al titular se envia **despues** del commit, best-effort con
`sendPurchaseEmail()`. Si falla, el carnet ya existe y la respuesta lo reporta.

### 2. Rutas API

Todas bajo `/api/admin/carnets`, todas exigen `hasRole(user.role, "ADMIN")`.

| Ruta | Que hace |
| --- | --- |
| `GET /options` | Eventos con `isActive: true` y `endDate >= hoy (Lima)`, con sus tipos de entrada y toda la metadata que la UI necesita en un solo fetch: categoria, `servilexSucursalCode`, `membershipScheduleKey`, perfil de horario resuelto, `isPackage` / `packageDaysCount`, `monthlyClassLimit`, `membershipDurationMonths`, `membershipStartFixed/Min/Max`, `capacity` / `sold`, precio |
| `GET /pool-dates?ticketTypeId=` | Fechas con inventario habilitado y su `capacity` / `sold` |
| `POST /preview` | Dry-run: `planCarnetIssuance()`. Devuelve el plan o la lista de errores. No escribe |
| `POST /` | Emite: `issueCarnet()` |
| `GET /` | Historial: ultimas 50 ordenes `PRESENCIAL` con `providerResponse.source = "admin-carnet-panel"` |

El buscador de usuarios reusa `GET /api/admin/users?search=`, que ya filtra por
nombre y correo.

`GET /options` acepta `?includeEnded=true` para listar tambien eventos ya
terminados. La UI lo expone como un check "mostrar eventos finalizados", apagado
por defecto: regularizar a alguien de un evento que acaba de cerrar es un caso
real, pero no debe ser lo primero que se ve en el select.

### 3. UI: `/admin/carnets`

Formulario de cuatro bloques; el tercero se adapta al tipo de entrada elegido.

**1. Usuario.** Buscador con debounce. Al elegirlo muestra nombre, correo y los
carnets activos que ya tiene, para ver de inmediato si se esta duplicando.

**2. Evento -> Tipo de entrada.** Dos selects encadenados. El de tipo muestra
`vendidos/cupo` y precio en cada opcion.

**3. Detalle, condicional al tipo:**

- Membresia con horario: `MembershipScheduleSelector` (el componente que ya usa
  el checkout, reusado tal cual) mas fecha de inicio con enero/febrero
  bloqueados y el rango del evento aplicado.
- Membresia sin horario: solo fecha de inicio.
- Piscina libre: selector de fecha con cupo disponible. El horario **es** el
  tipo de entrada, no un campo aparte.
- Paquete / bolsa: seleccion de las N fechas de `packageDaysCount`.
- Entrada de evento: nada; los entitlements salen de los dias del evento.

**4. Datos y confirmacion.** Nombre del asistente (precargado con el del
usuario), DNI, monto (default `0`), motivo obligatorio, y tres checks: enviar
correo al titular, forzar sobrecupo, permitir duplicado.

Flujo: **Previsualizar** -> tarjeta con lo que se va a crear (dias validos con
rango de fechas, resumen del horario en texto, cupo antes -> despues, y si va a
forzar algo) -> **Emitir** -> codigo de ticket con enlace al carnet.

Debajo, tabla de historial: fecha, admin que emitio, usuario, evento/tipo,
codigo, monto, motivo.

Entrada de menu: `Carnets` en el grupo **Ventas** de `AdminLayoutClient.tsx`,
junto a Cortesias.

### 4. El script

`scripts/issue-presential-carnets.ts` se reescribe como adaptador CSV sobre
`planCarnetIssuance()` / `issueCarnet()`. Mismos flags y misma salida de
consola, sin logica propia. Su comportamiento observable no cambia.

## Manejo de errores

Toda validacion fallida devuelve una lista de mensajes en espanol con la razon
concreta, y **no escribe nada**. La emision es una sola transaccion: o queda
completa o no queda. El correo es lo unico best-effort, y ocurre despues del
commit.

## Pruebas

`src/lib/carnet-issuance.test.ts`, con `node:test` via `tsx`, sin base de datos.
La capa `validateCarnetRequest()` recibe los datos ya cargados, lo que permite
cubrir:

- Horario semanal valido e invalido por sede.
- Blackout de enero y febrero.
- Fecha de inicio fuera del rango `min` / `max`.
- Carnet activo duplicado, con y sin `allowExistingActive`.
- Paquete al que le faltan fechas.
- Calculo de entitlements por categoria: membresia (vacio), piscina libre (un
  dia), paquete (N dias), evento normal (rango completo).
