# Panel de emision de carnets — pendientes conocidos

Fecha: 2026-08-31
Rama: `feat/panel-emision-carnets`
Estado: ninguno bloquea el merge. Salieron de la revision final de rama y de la
re-revision de la oleada de arreglos, y se decidieron conscientemente como
seguimiento en vez de meterlos en una segunda oleada.

Contexto: `docs/superpowers/specs/2026-08-27-panel-emision-carnets-design.md` y
`docs/superpowers/plans/2026-08-28-panel-emision-carnets.md`.

## 1. El gate de turnos es mas estricto que el checkout para dos formas

`src/lib/carnet-issuance-rules.ts` rechaza los tipos con `requireShiftSelection`
antes de calcular `isBag` y sin mirar `scheduleConfig.dates.length`. El checkout
publico solo exige turno cuando `requiredScheduleSelections > 0`, que es 0 para
una bolsa de piscina y 0 cuando no hay fechas configuradas.

Consecuencia: una bolsa `PISCINA_LIBRE` cuyo `validDays` lleve turnos — algo
configurable desde el formulario normal de tipos de entrada — queda inemitible
por el panel **y** por el script, mientras el checkout la sigue vendiendo.

Arreglo: una condicion (`!isBag && scheduleConfig.dates.length > 0 && …`),
moviendo el calculo de `isBag` por encima del gate.

Falla cerrado (bloquea la emision en vez de emitir mal), por eso no bloquea.

## 2. Fechas de paquete sobrantes queman cupo sin entitlement

Preexistente, misma clase que el hallazgo I-6 pero fuera de lo que ese pedia.

La validacion solo rechaza `unique.size < packageDaysCount`, asi que N+k fechas
pasan. `issueCarnet` reserva las N+k, mientras `buildEntitlementDates` recorta a
N — el cupo de los dias sobrantes queda consumido sin que ningun entitlement lo
cubra. Se alcanza desde la UI: el selector de fechas de paquete no tiene tope.

El checkout lo evita con `selections.slice(0, requiredSelections)`
(`src/lib/ticket-date-capacity.ts`). Arreglo: un tope superior junto al conteo
que ya existe.

## 3. `source` y `extra` los puede fijar el cliente

Las rutas `POST /api/admin/carnets` y `/preview` esparcen el body en
`CarnetIssuanceInput`, asi que un request hecho a mano puede fijar
`providerResponse.source` a cualquier cosa y sacar su propia emision del
historial del panel, que filtra por `DEFAULT_CARNET_SOURCE`. Tambien permite
inyectar JSON arbitrario en `providerResponse`.

Las claves canonicas estan protegidas por el orden del spread y
`issuedByUserId` sigue registrando al actor, asi que el rastro no se pierde —
pero el filtro es evadible donde antes `source` estaba hardcodeado.

Arreglo: allowlist en las dos rutas. Alternativa: aceptarlo explicitamente, dado
que solo un ADMIN llega a esas rutas.

## 4. `--print-template` no anuncia las columnas nuevas

`scripts/issue-presential-carnets.ts` documenta `buyerName`, `buyerPhone`,
`buyerDocNumber` y `documentType` en el comentario de cabecera, pero no los
incluye en la fila de plantilla que imprime `--print-template`.

Importa porque el beneficio de recuperar esos campos — que una membresia
importada se pueda buscar por telefono en `/admin/membresias` — depende de que
operaciones agregue una columna que la plantilla nunca les muestra.

## 5. El desplegable de fechas ofrece dias que luego se rechazan

`GET /api/admin/carnets/pool-dates` devuelve todas las filas de inventario del
tipo, y la UI las pinta tal cual. Una fecha fuera de `validDays` o del rango del
evento se ofrece y despues la rechazan las reglas. No es una divergencia con el
checkout (alli tambien se rechaza), solo una opcion muerta en la UI.

## 6. Cambio de comportamiento del script, para operaciones

Con la guarda de duplicados dentro de la transaccion, dos filas del CSV para el
mismo usuario + tipo de entrada ahora abortan el lote despues de escribir la
primera, donde antes se emitian las dos. Es el endurecimiento buscado.

La reanudacion funciona (las filas ya emitidas se saltan por `sourceRef`), pero
el operador tiene que quitar la fila repetida: cualquier error en la fase de
planificacion aborta la corrida completa.

## 7. Idempotencia sin constraint unica

Por decision del diseno no hay migracion, asi que `Order.providerOrderNumber` no
tiene unique. La guarda de duplicados se apoya en el row-lock que toma el
`updateMany` de `TicketType.sold`, lo que serializa las emisiones del mismo tipo
de entrada bajo READ COMMITTED. El cierre definitivo exige un unique sobre
`(provider, providerOrderNumber)` — y por lo tanto una migracion.

## 8. El script nunca se ejecuto

`scripts/issue-presential-carnets.ts` se reescribio como adaptador del modulo
compartido, pero ningun task pudo correrlo: `.env` apunta al host Neon de
PRODUCCION y `.env.staging` es una plantilla sin credenciales. Se verifico por
lectura linea a linea, `tsc` y `eslint`.

Antes de usarlo en un lote real conviene una corrida dry-run contra staging con
un CSV de prueba, comparando la salida `OK fila N:` contra la de la version
anterior.
