# Lector Zebra DS2278 en la puerta (modo lector en /scanner)

Fecha: 2026-09-08
Estado: aprobado, pendiente de plan de implementacion

## Problema

Hoy el control de ingreso se hace solo con la camara del celular del staff, via
`/scanner/evento/[eventId]`. Se quiere sumar un puesto fijo en la puerta con un
lector laser Zebra **DS2278** (cordless, imager 2D) emparejado a una **laptop
Windows con Chrome**, sin que eso cambie en nada la operacion de los celulares
en las otras puertas.

La pagina actual no puede recibir a ese lector:

- El QR de los tickets **no es un codigo corto**: es un JSON firmado de ~250-300
  caracteres con `{ } " : ,` y una firma HMAC de 64 hex (`src/lib/qr.ts`). Un
  lector en modo teclado tiene que transmitirlo entero y sin deformarlo.
- El campo de "codigo manual" (`page.tsx:1406`) hace `.toUpperCase()` en cada
  tecla y solo pasa por `parseLookupPayload`. Un pistolazo ahi destroza el JSON
  en silencio.
- La camara arranca sola al montar (`page.tsx:473`) pidiendo
  `facingMode: exact "environment"`, que en una laptop no existe: pide permiso
  de webcam y falla.
- No hay auto-reset: tras cada lectura hay que tocar "Escanear otro"
  (`page.tsx:914`). Con una fila y una pistola, eso es friccion constante.

Objetivo: que un puesto de puerta con laptop + DS2278 valide ingresos disparando
la pistola, sin tocar la laptop entre persona y persona, conservando la
verificacion de firma HMAC que ya hace la camara.

## Alcance

Entra:

- Interruptor **"Modo lector"** por dispositivo, persistido en `localStorage`.
- Hook nuevo `src/hooks/useBarcodeWedge.ts` que captura la transmision del
  lector y la entrega a `handleScan()`.
- Auto-reset del resultado valido; el rechazado se queda en pantalla.
- Aviso visible de **foco perdido**.
- Endurecer el campo manual para que deje de romper el JSON.
- Configuracion del DS2278 (modo HID, emulacion, sufijo) y prueba de banco.

Queda **fuera**:

- Cualquier cambio en el comportamiento actual en celulares. Sin el interruptor
  prendido, la pagina se comporta exactamente como hoy.
- Cambiar el contenido del QR, los carnets impresos o `/mi-cuenta/entradas`.
- Modo SPP / Web Serial / Web Bluetooth.
- Reglas ADF en el lector. Es el plan B, documentado abajo, no este trabajo.
- El panel de asistencia manual (`/scanner/asistencia`), que no se toca.

## Decisiones

### 1. HID teclado, no SPP

El DS2278 se empareja a Windows como teclado Bluetooth. Es la unica ruta que no
exige implementar el protocolo SSI de Zebra y que funciona en Chrome sin
permisos especiales.

### 2. Input invisible con evento `input`, no listener de `keydown`

Esta es la decision tecnica central y la razon esta en el modo de emulacion.

Para que el JSON sobreviva al layout de teclado espanol de Windows, el lector se
configura en **"Emulate Keypad"**: manda cada caracter como Alt + codigo
numerico, ignorando el layout activo. Un listener de `keydown` veria una rafaga
de teclas del teclado numerico con Alt, **no** los caracteres reales.

El evento `input` sobre un campo enfocado, en cambio, dispara con el caracter ya
compuesto por el sistema operativo, sea cual sea la forma en que se produjo.
Por eso el hook usa un `<input>` fuera de pantalla y escucha `input`.

### 3. La pistola entra por el mismo camino que la camara

El hook entrega el string crudo a `handleScan()`. De ahi pasa por
`parseScannedPayload` y entra a `/api/scans/validate`, **conservando la
verificacion de firma HMAC**. No se crea un segundo camino de validacion, ni se
degrada a lookup por codigo.

### 4. Un pistolazo nuevo reemplaza un rechazo en pantalla

El resultado rechazado se queda fijo para que el staff lo vea, pero no bloquea:
la siguiente lectura lo sustituye. Si se quedara bloqueando, un rechazo trabaria
la fila hasta que alguien vaya a cerrarlo a mano.

### 5. Interruptor por dispositivo, no por usuario ni por evento

En `localStorage`. La laptop de la puerta lo prende una vez y queda asi; los
celulares nunca lo ven. Es lo que garantiza que este trabajo no pueda romper la
operacion existente.

## Diseno

### Hook: `src/hooks/useBarcodeWedge.ts`

Responsabilidad unica: convertir la transmision de un lector HID en un string
completo, y entregarlo. No sabe nada de tickets, eventos ni endpoints.

Interfaz:

- Entrada: `{ enabled: boolean, onScan: (raw: string) => void, paused: boolean }`
- Salida: el elemento `<input>` invisible a renderizar, y el estado de foco.

Comportamiento:

1. Renderiza un `<input>` fuera de pantalla, `aria-hidden`, sin tab order.
2. Se auto-enfoca **solo si `document.activeElement` es el `body`** o el propio
   input. Nunca le roba el foco al campo manual, al selector de turno ni a un
   boton.
3. Acumula lo que llega por `input` y despacha al ver **Enter**.
4. Red de seguridad: si pasan ~300 ms sin caracteres nuevos y el buffer tiene
   contenido, despacha igual. Asi funciona aunque el sufijo Enter quede mal
   configurado en el lector.
5. Mientras `paused` (hay una validacion en vuelo), descarta lo que llegue.

### Cambios en `src/app/scanner/evento/[eventId]/page.tsx`

- Estado `readerMode` leido de `localStorage`, con boton en la barra superior
  junto a sonido e historial. Indicador visible de modo activo.
- El efecto de `page.tsx:473` no arranca la camara cuando `readerMode` esta
  prendido. En su lugar, estado grande **"Listo para leer"**, con boton
  "Usar camara" disponible como respaldo manual.
- Auto-reset: al recibir un resultado valido, timer de ~2.5 s que llama a la
  logica de `resetScan` **incluyendo la liberacion de `scanLockedRef`**, sin
  arrancar la camara si `readerMode` esta prendido. El timer se cancela si llega
  una lectura nueva o si el componente se desmonta.
- Resultado rechazado: sin timer. Se limpia por lectura nueva o por el boton.
- Banda de foco perdido: escuchando `blur`/`focus` de `window`, banda amarilla
  "Haz clic aqui para reactivar la lectura" cuando `document.hasFocus()` es
  falso. Sin esto, el lector escribe en el vacio y las lecturas se pierden en
  silencio: es el modo de falla mas traicionero de un lector HID.

Se conservan sin cambios el contador del dia, el historial, el selector de turno
de piscina, el forzado de ingreso de emergencia y los tres audios
(`beep` / `success` / `error`). El sonido es el canal principal en una puerta:
el staff mira al cliente, no la pantalla.

### Endurecimiento del campo manual

Independiente del modo lector, y util por si mismo:

- No aplicar `.toUpperCase()` cuando el valor empieza con `{`.
- `handleManualSubmit` pasa por `parseScannedPayload` en vez de
  `parseLookupPayload`, para aceptar tambien el QR firmado.

Con eso el campo manual deja de ser una trampa silenciosa y pasa a ser un
destino valido de la pistola.

## Configuracion del hardware

No hay nada que comprar. El DS2278 con la cuna **CR2278-PC10004WW** (que es de
**solo carga**, no de comunicacion) alcanza: basta enchufar su USB a un cargador
o a un puerto de la laptop. Verificar que la laptop tenga Bluetooth; si no, un
dongle USB.

La configuracion se hace **sin instalar nada**: se abre el PDF *DS2278 Product
Reference Guide* de Zebra en pantalla y se dispara la pistola contra los codigos
de barras impresos en el propio PDF, que el lector interpreta como comandos.

**123Scan no hace falta para el enfoque A.** Ademas programa por cable USB de
datos, y la cuna CR2278-PC es de solo carga, asi que igual habria que terminar
configurando por codigos escaneados. Solo se justifica si se activa el plan B,
porque armar una regla ADF a mano desde el PDF es impracticable.

Secuencia:

1. Restaurar valores de fabrica.
2. Host Bluetooth = **HID Keyboard**. El lector queda visible y se empareja
   desde Ajustes -> Bluetooth de Windows.
3. Emulacion = **Emulate Keypad**.
4. Sufijo = **Enter**.
5. Verificar que QR Code este habilitado.

Los valores numericos exactos de cada opcion se confirman contra el PDF al
momento de configurar.

## Orden de trabajo y riesgo principal

**Primero el hardware, despues el codigo.**

El riesgo real del proyecto es uno: **cuanto demora "Emulate Keypad" en teclear
~300 caracteres**. Ese modo escribe caracter por caracter; si cada lectura toma
2 segundos, la puerta queda mas lenta que con el celular y el enfoque pierde
sentido.

Prueba de banco, antes de escribir codigo, con el Bloc de notas:

1. Emparejar el lector a la laptop.
2. Disparar contra un carnet impreso y contra un QR en pantalla de celular.
3. Verificar que el JSON llegue **completo**, que los `{ } " :` lleguen
   **intactos**, y **cuanto demora**.
4. Medir de paso lo que solo se sabe probando: si el DS2278 lee bien pantallas
   de celular reales, con brillo bajo, con mica y con la pantalla rajada.

Criterio de aceptacion de la prueba: JSON identico al original y menos de ~1 s
por lectura.

## Plan B (si la prueba de banco falla)

Regla **ADF** programada en el lector con 123Scan, para que lea el JSON pero
transmita unicamente el `ticketCode` de 14 caracteres (`ABCD-EFGH-IJKL`).

- Inmune a cualquier layout, transmision cortisima, y serviria igual en Android.
- Costo: entra por `/api/scans/lookup` en vez de `/api/scans/validate`, o sea
  **sin verificacion de firma** (sigue validando contra la BD, como el campo
  manual y el panel de asistencia).
- Fragilidad: la regla depende del orden exacto de los campos del JSON. Si el
  payload de `src/lib/qr.ts` cambia, la pistola deja de funcionar y no es obvio
  por que.

Si se activa el plan B, el hook y la UI de este diseno se mantienen tal cual;
solo cambia el contenido que llega y el endpoint al que se enruta.

## Pruebas

- **Unitarias del hook**: rafaga con Enter final; rafaga sin Enter (red de
  seguridad por timeout); llegada durante `paused`; que no se auto-enfoque
  cuando hay otro input enfocado.
- **Del parser**: que `parseScannedPayload` acepte el JSON tal como lo entrega
  el lector, incluido el caso con y sin campo `shift`.
- **Del campo manual**: que un valor que empieza con `{` no se pase a mayusculas
  y que `handleManualSubmit` acepte un QR firmado.
- **Manual en la puerta**: modo lector prendido no pide camara; valido se limpia
  solo; rechazado se queda; pistolazo nuevo reemplaza el rechazo; la banda de
  foco perdido aparece al cambiar de ventana.
- **De no-regresion**: con el modo apagado, la pagina se comporta igual que hoy
  en celular.
