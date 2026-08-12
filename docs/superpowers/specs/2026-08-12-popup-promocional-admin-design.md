# Popup promocional editable desde el admin

Fecha: 2026-08-12
Estado: aprobado, pendiente de plan de implementacion

## Problema

El popup promocional ("Voces del Agua", commit `8d8cce4`) tiene el contenido
escrito en el codigo: titulo, texto, ID del video y las rutas donde aparece
viven en `src/components/home/VocesDelAguaPopup.tsx`. Cambiar el anuncio, o
simplemente apagarlo, obliga a un commit, un build en GitHub Actions y un
deploy al VPS. Marketing no puede mover nada por su cuenta.

Objetivo: que un admin pueda editar el contenido del popup, decidir si tiene
enlace y donde aparece, sin tocar codigo ni desplegar.

## Alcance

Un unico popup configurable, global al sitio. Queda **fuera** de este trabajo:

- Multiples campanas simultaneas con fechas de vigencia y prioridad.
- Segmentacion por usuario, dispositivo o procedencia.
- Metricas de impresiones y clics.

Si mas adelante hace falta rotar anuncios programados, el modelo de una fila
se migra a varias filas con `validFrom`/`validUntil`; nada de este diseno lo
impide.

## Decisiones tomadas

| Tema | Decision |
|---|---|
| Alcance | Un popup configurable (no varias campanas) |
| Imagen | Enlace libre; miniatura automatica si es YouTube, si no imagen subida |
| Enlace | Opcional: sin enlace el popup es un anuncio puro |
| Rutas | Casillas por seccion en el admin, no rutas escritas a mano |
| Frecuencia | Una vez por sesion; reaparece si cambia el contenido |

## Modelo de datos

Modelo nuevo en `prisma/schema.prisma`, con una sola fila de id fijo
`"default"`. La fila se crea sola en el primer guardado (`upsert`), no hace
falta seed.

```prisma
model PromoPopup {
  id          String   @id @default("default")
  isActive    Boolean  @default(false)
  eyebrow     String?  // "Estreno FDNDA"
  kicker      String?  // "Voces del Agua"
  title       String
  description String?
  imageUrl    String?  // subida a R2; si es null y linkUrl es YouTube se deriva la miniatura
  linkUrl     String?  // opcional
  linkLabel   String?  // "Ver ahora en YouTube"
  mediaCaption String? // "Temporada 1 - Episodio 1"
  sections    String[] // ["INICIO","EVENTOS","MERCH"] o ["TODO_PUBLICO"]
  updatedAt   DateTime @updatedAt
  updatedById String?

  updatedBy User? @relation(fields: [updatedById], references: [id], onDelete: SetNull)

  @@map("promo_popups")
}
```

`sections` es un arreglo de strings y no cuatro booleanos: agregar una seccion
mas adelante no requiere migracion. Es el primer `String[]` del schema; Neon es
Postgres y lo soporta de forma nativa.

`User` necesita la relacion inversa `promoPopups PromoPopup[]`.

Valores validos de `sections`: `INICIO`, `EVENTOS`, `MERCH`, `MI_CUENTA`,
`TODO_PUBLICO`. Se listan los cinco desde el inicio aunque hoy solo se usen
tres.

## Logica pura: `src/lib/promo-popup.ts`

Toda la logica que se puede probar sin BD vive aca, siguiendo el patron de
`src/lib/membership-schedule.ts` y sus tests con `node:test`.

```ts
export const PROMO_SECTIONS = ["INICIO", "EVENTOS", "MERCH", "MI_CUENTA", "TODO_PUBLICO"] as const
export type PromoSection = (typeof PROMO_SECTIONS)[number]

/** Rutas donde el popup NO debe aparecer nunca, sin importar la config. */
export function isBlockedPromoPath(pathname: string): boolean

/** Extrae el ID de un enlace de YouTube (watch, youtu.be, shorts, embed). Null si no es YouTube. */
export function extractYoutubeId(url: string | null): string | null

/** Imagen final a mostrar: la subida gana; si no hay, la miniatura de YouTube; si no, null. */
export function resolvePromoImage(linkUrl: string | null, imageUrl: string | null): {
    url: string | null
    fit: "cover" | "contain"
}

/** Si la config aplica a la ruta actual. */
export function isPromoVisibleOnPath(sections: string[], pathname: string): boolean
```

`isBlockedPromoPath` bloquea `/admin`, `/scanner`, `/tesoreria`, `/checkout`,
`/canjear`, `/login`, `/registro` y `/recuperar`. Esta lista manda sobre
`TODO_PUBLICO`.

Mapeo de seccion a ruta:

- `INICIO` -> `/` exacto
- `EVENTOS` -> `/eventos` y todo lo que cuelgue
- `MERCH` -> `/merch` y todo lo que cuelgue
- `MI_CUENTA` -> `/mi-cuenta` y todo lo que cuelgue
- `TODO_PUBLICO` -> cualquier ruta no bloqueada

### Proporcion de imagen

El panel de la imagen es mas alto que ancho en escritorio, y las miniaturas de
YouTube son 16:9. De ahi las bandas oscuras que se ven hoy en produccion.
Regla:

- Miniatura de YouTube -> `contain` sobre el fondo `bg-fdnda-primary`. No se
  recorta arte que no controlamos.
- Imagen subida -> `cover`, con 1200x1500 (4:5) como tamano recomendado en la
  ayuda del formulario. Llena el panel sin bandas.

El riesgo de `cover` es recortar texto pegado al borde de una imagen subida.
Lo cubre la vista previa en vivo del admin, que muestra el recorte real antes
de guardar. Si en la practica queda corto, se agrega un campo `imageFit`; no
se agrega ahora.

## API

### `GET /api/promo-popup` (publica)

Sin auth. Devuelve la promo ya resuelta, o `null` si esta inactiva o no existe.

```json
{
  "promo": {
    "eyebrow": "Estreno FDNDA",
    "kicker": "Voces del Agua",
    "title": "Conoce a la nadadora mas rapida de la historia del Peru",
    "description": "Rafaela Fernandini comparte...",
    "image": { "url": "https://i.ytimg.com/vi/AbSRrPAz4Zo/maxresdefault.jpg", "fit": "contain" },
    "mediaCaption": "Temporada 1 - Episodio 1",
    "linkUrl": "https://www.youtube.com/watch?v=AbSRrPAz4Zo",
    "linkLabel": "Ver ahora en YouTube",
    "sections": ["INICIO", "EVENTOS", "MERCH"],
    "version": "2026-08-12T18:04:11.000Z"
  }
}
```

Responde con `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
para que Cloudflare la absorba. Un cambio en el admin tarda hasta un minuto en
propagarse; queda dicho en la UI del admin.

No lee cookies ni sesion, para que la respuesta sea cacheable en el borde.

### `GET` y `PUT /api/admin/promo-popup`

Guard `getCurrentUser()` + `role === "ADMIN"`, mismo patron que
`src/app/api/admin/discounts/route.ts`. `PUT` hace `upsert` sobre la fila
`default` y graba `updatedById`.

Validacion en el `PUT`:

- `title` obligatorio si `isActive` es true.
- `linkUrl`, si viene, debe ser `http(s)` absoluta.
- `linkLabel` obligatorio si hay `linkUrl`.
- `sections` no puede quedar vacio si `isActive` es true.
- Cada valor de `sections` debe estar en `PROMO_SECTIONS`.

Los errores vuelven por campo para pintarlos junto al input.

## Componente publico

`src/components/home/VocesDelAguaPopup.tsx` se renombra a
`src/components/promo/PromoPopup.tsx` y se parte en dos archivos (ver "UI del
admin" mas abajo). Se actualiza el import en
`src/components/layout/MainLayoutWrapper.tsx`.

Cambios respecto a la version actual:

- Consulta `GET /api/promo-popup` al montarse, del lado del cliente.
- Todo el contenido sale de la respuesta; no queda nada escrito en el
  componente.
- El bloque del enlace (miniatura clickeable y boton) solo se pinta si hay
  `linkUrl`. Sin enlace, la imagen no es clickeable y el unico boton es el de
  cerrar.
- La clave de `sessionStorage` pasa a ser `fdnda-promo-${version}`, donde
  `version` es el `updatedAt` de la fila. Editar el contenido genera una clave
  nueva, asi que el popup vuelve a salir aunque la persona ya lo hubiera
  cerrado.

**Por que el fetch va del lado del cliente.** `MainLayoutWrapper` cuelga del
layout raiz, que envuelve todas las paginas. Leer Prisma ahi hornearia la promo
en el HTML estatico de cada pagina y no cambiaria hasta revalidar, que es justo
lo que queremos evitar. El fetch del cliente no toca el ISR y hace que los
cambios del admin se vean sin desplegar. El costo es una peticion JSON chica
por carga de pagina, amortiguada por el cache de 60s en Cloudflare.

Mientras la peticion esta en vuelo no se renderiza nada, asi que no hay
parpadeo ni salto de layout.

Si el fetch falla, el componente no muestra nada y no rompe la pagina.

## UI del admin

Componente nuevo `src/components/admin/PromoPopupSettings.tsx`, montado como
una card en `src/app/admin/configuracion/page.tsx`. Va en su propio archivo
porque esa pagina ya tiene 297 lineas.

Contenido de la card:

- Switch **Popup activo**.
- Campos: `eyebrow`, `kicker`, `title`, `description`, `mediaCaption`.
- **Enlace**: `linkUrl` y `linkLabel`, ambos opcionales. Si se pega un enlace
  de YouTube, un aviso indica que la miniatura se saca sola.
- **Imagen**: subida via `POST /api/upload` con `type=promo` (admin, 5 MB,
  jpeg/png/webp/gif). Boton para quitarla y volver a la miniatura automatica.
- **Secciones**: casillas Inicio, Eventos, Merch, Mi cuenta y Todo el sitio
  publico. Marcar la ultima deshabilita las demas.
- **Vista previa en vivo** del popup con los valores del formulario, reusando
  el mismo componente de presentacion que el sitio publico.
- Boton **Guardar** con estado de carga y errores por campo.

Para que la vista previa y el sitio no se desincronicen, el popup se parte en
dos archivos:

- `src/components/promo/PromoPopupCard.tsx`: solo presentacion, recibe los
  datos por props y no sabe nada de fetch ni de `sessionStorage`.
- `src/components/promo/PromoPopup.tsx`: obtiene los datos, decide si toca
  mostrarlo, maneja `sessionStorage`, el foco y la tecla Escape, y renderiza
  `PromoPopupCard`.

El admin usa `PromoPopupCard` directo, sin overlay ni bloqueo de scroll.

Ademas se elimina el boton "Guardar cambios" que hoy existe en
`/admin/configuracion` y su mensaje de "guardado": no persiste nada, solo pinta
un cartel por 3 segundos, y conviviendo con el guardado real del popup induce
a error.

## Pruebas

`src/lib/promo-popup.test.ts` con `node:test`, como el resto de `src/lib`:

- `extractYoutubeId` con formatos `watch?v=`, `youtu.be/`, `/shorts/`,
  `/embed/`, con parametros extra, y `null` para una URL que no es de YouTube.
- `resolvePromoImage`: gana la imagen subida sobre la de YouTube; `contain`
  para YouTube y `cover` para subida; `null` cuando no hay ninguna.
- `isPromoVisibleOnPath`: cada seccion contra sus rutas; `TODO_PUBLICO` en una
  ruta cualquiera; que `/admin`, `/scanner`, `/tesoreria`, `/checkout` y
  `/canjear` queden bloqueadas incluso con `TODO_PUBLICO`; `INICIO` no matchea
  `/eventos`.

Verificacion manual antes del deploy: guardar con el popup inactivo y
comprobar que no sale; activarlo solo en Inicio y verificar que no aparece en
`/merch`; guardar sin enlace y ver que no hay boton; editar el titulo con la
sesion ya marcada y confirmar que vuelve a salir.

## Deploy

A diferencia del commit `8d8cce4`, este cambio **si** lleva migracion de
Prisma, asi que el paso `migrate` deja de ser opcional:

```bash
docker compose --profile tools -f docker-compose.prod.yml \
  --env-file .env.production run --rm migrate
```

Las migraciones corren desde la imagen `tools`, no desde el git del VPS: hay
que confirmar que `TOOLS_IMAGE` apunte al tag recien publicado antes de
correrla.

Tras el deploy, la fila `default` no existe todavia y `isActive` arranca en
false, o sea que el popup no se muestra hasta que un admin lo configure y lo
active. El contenido de "Voces del Agua" se vuelve a cargar a mano desde el
formulario.
