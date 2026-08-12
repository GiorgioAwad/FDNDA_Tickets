# Panel admin del popup promocional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin pueda editar el contenido del popup promocional, su enlace y en qué secciones aparece, desde `/admin/configuracion`, sin tocar código ni desplegar.

**Architecture:** Un modelo Prisma `PromoPopup` de fila única (id `"default"`), sembrado en la migración con el contenido actual de "Voces del Agua". La lógica que no necesita BD (parseo de YouTube, resolución de imagen, matching de rutas, validación) vive en `src/lib/promo-popup.ts` y se prueba con `node:test`. El sitio público lee la config por `GET /api/promo-popup` desde el cliente, para no romper el ISR del layout raíz. El popup se parte en un componente de presentación puro y otro con la lógica, para que la vista previa del admin y el sitio real no se desincronicen.

**Tech Stack:** Next.js App Router (Next 15, `--webpack`), React 19, Prisma sobre Postgres (Neon), Tailwind, `node:test` vía `tsx`, almacenamiento R2.

**Spec:** `docs/superpowers/specs/2026-08-12-popup-promocional-admin-design.md`

## Global Constraints

- Los tests se corren con `npx tsx --test <archivo>`. No hay script `test` en `package.json`; no lo agregues.
- Los tests de librería usan `node:test` + `node:assert/strict`, siguiendo `src/lib/membership-schedule.test.ts`. Nada de vitest ni jest.
- Las rutas de API usan `export const runtime = "nodejs"`.
- El guard de admin es `getCurrentUser()` de `@/lib/auth` + `user.role !== "ADMIN"` → 401 con `{ success: false, error: "No autorizado" }`. Patrón de referencia: `src/app/api/admin/discounts/route.ts`.
- Las migraciones se escriben a mano en `prisma/migrations/<AAAAMMDD>120000_<nombre>/migration.sql`. No corras `prisma migrate dev` contra la BD: staging y producción son Neon compartidas.
- Indentación de 4 espacios, sin punto y coma al final de línea, comillas dobles. Mira cualquier archivo de `src/components/` antes de escribir.
- Los mensajes de commit van en español, en imperativo, con prefijo `feat:` / `fix:` / `test:` / `refactor:`, y terminan con la línea `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Valores válidos de `sections`, siempre estos cinco: `INICIO`, `EVENTOS`, `MERCH`, `MI_CUENTA`, `TODO_PUBLICO`.
- No pushees nada. El repo se queda en local hasta que Giorgio revise.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/promo-popup.ts` | Lógica pura: secciones, parseo de YouTube, resolución de imagen, matching de rutas, validación de formulario. Sin Prisma, sin React. |
| `src/lib/promo-popup.test.ts` | Tests de lo anterior. |
| `prisma/schema.prisma` | Modelo `PromoPopup` + relación inversa en `User`. |
| `prisma/migrations/20260812120000_add_promo_popup/migration.sql` | `CREATE TABLE` + `INSERT` del contenido actual. |
| `src/app/api/promo-popup/route.ts` | `GET` público, cacheable, sin auth. |
| `src/app/api/admin/promo-popup/route.ts` | `GET`/`PUT` de admin. |
| `src/components/promo/PromoPopupCard.tsx` | Presentación pura del popup. La usan el sitio y la vista previa del admin. |
| `src/components/promo/PromoPopup.tsx` | Fetch, `sessionStorage`, foco, Escape, overlay. Renderiza `PromoPopupCard`. |
| `src/components/admin/PromoPopupSettings.tsx` | Formulario del admin con vista previa en vivo. |
| `src/components/layout/MainLayoutWrapper.tsx` | Cambia el import del popup. |
| `src/app/admin/configuracion/page.tsx` | Monta la card nueva y pierde el botón "Guardar cambios" falso. |
| `src/components/ui/image-uploader.tsx` | Se le agrega `"promo"` a la unión de `type`. |
| `src/components/home/VocesDelAguaPopup.tsx` | Se elimina. |

---

### Task 1: Lógica pura de presentación

**Files:**
- Create: `src/lib/promo-popup.ts`
- Test: `src/lib/promo-popup.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `PROMO_SECTIONS`, `PromoSection`, `PromoImage`, `isBlockedPromoPath(pathname: string): boolean`, `extractYoutubeId(url: string | null | undefined): string | null`, `resolvePromoImage(linkUrl, imageUrl): PromoImage`, `isPromoVisibleOnPath(sections: string[], pathname: string): boolean`.

- [ ] **Step 1: Escribe el test que falla**

Crea `src/lib/promo-popup.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
    extractYoutubeId,
    isBlockedPromoPath,
    isPromoVisibleOnPath,
    resolvePromoImage,
} from "./promo-popup"

test("extractYoutubeId acepta los formatos de enlace de YouTube", () => {
    assert.equal(extractYoutubeId("https://www.youtube.com/watch?v=AbSRrPAz4Zo"), "AbSRrPAz4Zo")
    assert.equal(extractYoutubeId("https://youtu.be/AbSRrPAz4Zo"), "AbSRrPAz4Zo")
    assert.equal(extractYoutubeId("https://www.youtube.com/shorts/AbSRrPAz4Zo"), "AbSRrPAz4Zo")
    assert.equal(extractYoutubeId("https://www.youtube.com/embed/AbSRrPAz4Zo"), "AbSRrPAz4Zo")
    assert.equal(extractYoutubeId("https://youtube.com/watch?v=AbSRrPAz4Zo&t=42s"), "AbSRrPAz4Zo")
})

test("extractYoutubeId devuelve null si no es un video de YouTube", () => {
    assert.equal(extractYoutubeId("https://ticketingfdnda.pe/eventos"), null)
    assert.equal(extractYoutubeId("https://www.youtube.com/@fdnda"), null)
    assert.equal(extractYoutubeId("no soy una url"), null)
    assert.equal(extractYoutubeId(null), null)
    assert.equal(extractYoutubeId(""), null)
})

test("resolvePromoImage prefiere la imagen subida sobre la de YouTube", () => {
    const result = resolvePromoImage(
        "https://www.youtube.com/watch?v=AbSRrPAz4Zo",
        "https://assets.ticketingfdnda.pe/promo/arte.jpg"
    )
    assert.deepEqual(result, {
        url: "https://assets.ticketingfdnda.pe/promo/arte.jpg",
        fit: "cover",
    })
})

test("resolvePromoImage deriva la miniatura de YouTube cuando no hay imagen subida", () => {
    const result = resolvePromoImage("https://youtu.be/AbSRrPAz4Zo", null)
    assert.deepEqual(result, {
        url: "https://i.ytimg.com/vi/AbSRrPAz4Zo/maxresdefault.jpg",
        fit: "contain",
    })
})

test("resolvePromoImage devuelve null cuando no hay ninguna imagen", () => {
    assert.deepEqual(resolvePromoImage(null, null), { url: null, fit: "cover" })
    assert.deepEqual(resolvePromoImage("https://ticketingfdnda.pe/eventos", null), {
        url: null,
        fit: "cover",
    })
})

test("isBlockedPromoPath bloquea las rutas privadas y de compra", () => {
    for (const path of [
        "/admin",
        "/admin/configuracion",
        "/scanner",
        "/scanner/asistencia",
        "/tesoreria",
        "/checkout",
        "/checkout/success",
        "/canjear",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
    ]) {
        assert.equal(isBlockedPromoPath(path), true, `deberia bloquear ${path}`)
    }
})

test("isBlockedPromoPath deja pasar las rutas publicas", () => {
    for (const path of ["/", "/eventos", "/merch", "/mi-cuenta", "/contacto"]) {
        assert.equal(isBlockedPromoPath(path), false, `no deberia bloquear ${path}`)
    }
})

test("isPromoVisibleOnPath respeta cada seccion", () => {
    assert.equal(isPromoVisibleOnPath(["INICIO"], "/"), true)
    assert.equal(isPromoVisibleOnPath(["INICIO"], "/eventos"), false)
    assert.equal(isPromoVisibleOnPath(["EVENTOS"], "/eventos"), true)
    assert.equal(isPromoVisibleOnPath(["EVENTOS"], "/eventos/festival-2026"), true)
    assert.equal(isPromoVisibleOnPath(["EVENTOS"], "/"), false)
    assert.equal(isPromoVisibleOnPath(["MERCH"], "/merch/gorro"), true)
    assert.equal(isPromoVisibleOnPath(["MI_CUENTA"], "/mi-cuenta/entradas"), true)
    assert.equal(isPromoVisibleOnPath(["INICIO", "MERCH"], "/merch"), true)
})

test("isPromoVisibleOnPath con TODO_PUBLICO cubre cualquier ruta no bloqueada", () => {
    assert.equal(isPromoVisibleOnPath(["TODO_PUBLICO"], "/contacto"), true)
    assert.equal(isPromoVisibleOnPath(["TODO_PUBLICO"], "/"), true)
})

test("las rutas bloqueadas ganan incluso con TODO_PUBLICO", () => {
    for (const path of ["/admin/eventos", "/scanner", "/tesoreria", "/checkout", "/canjear"]) {
        assert.equal(isPromoVisibleOnPath(["TODO_PUBLICO"], path), false, `deberia bloquear ${path}`)
    }
})

test("sin secciones el popup no se muestra en ningun lado", () => {
    assert.equal(isPromoVisibleOnPath([], "/"), false)
})
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx tsx --test src/lib/promo-popup.test.ts`
Expected: FAIL — no se puede resolver el módulo `./promo-popup`.

- [ ] **Step 3: Escribe la implementación**

Crea `src/lib/promo-popup.ts`:

```ts
export const PROMO_SECTIONS = ["INICIO", "EVENTOS", "MERCH", "MI_CUENTA", "TODO_PUBLICO"] as const

export type PromoSection = (typeof PROMO_SECTIONS)[number]

export interface PromoImage {
    url: string | null
    fit: "cover" | "contain"
}

// Rutas donde el popup no debe salir nunca: paneles internos, el camino de
// compra y las pantallas de autenticacion. Manda sobre TODO_PUBLICO.
const BLOCKED_PREFIXES = [
    "/admin",
    "/scanner",
    "/tesoreria",
    "/checkout",
    "/canjear",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
]

// Secciones que se resuelven por prefijo de ruta. INICIO se compara exacto y
// TODO_PUBLICO no tiene prefijo, por eso quedan fuera de este mapa.
const SECTION_PREFIXES: Record<string, string> = {
    EVENTOS: "/eventos",
    MERCH: "/merch",
    MI_CUENTA: "/mi-cuenta",
}

function matchesPrefix(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isBlockedPromoPath(pathname: string): boolean {
    return BLOCKED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
}

// Un ID de YouTube son 11 caracteres de [A-Za-z0-9_-]. Validarlo evita armar
// una URL de miniatura con basura pegada.
function sanitizeYoutubeId(raw: string): string | null {
    const id = raw.trim()
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export function extractYoutubeId(url: string | null | undefined): string | null {
    if (!url) return null

    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }

    const host = parsed.hostname.replace(/^www\./, "")

    if (host === "youtu.be") {
        return sanitizeYoutubeId(parsed.pathname.slice(1))
    }

    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
        return null
    }

    if (parsed.pathname === "/watch") {
        return sanitizeYoutubeId(parsed.searchParams.get("v") ?? "")
    }

    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length === 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
        return sanitizeYoutubeId(segments[1])
    }

    return null
}

/**
 * Imagen final del popup. La subida gana y se muestra recortada porque el arte
 * se sube a medida; la miniatura de YouTube se muestra contenida para no
 * recortar arte que no controlamos.
 */
export function resolvePromoImage(
    linkUrl: string | null | undefined,
    imageUrl: string | null | undefined
): PromoImage {
    if (imageUrl) {
        return { url: imageUrl, fit: "cover" }
    }

    const youtubeId = extractYoutubeId(linkUrl)
    if (youtubeId) {
        return { url: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`, fit: "contain" }
    }

    return { url: null, fit: "cover" }
}

export function isPromoVisibleOnPath(sections: string[], pathname: string): boolean {
    if (isBlockedPromoPath(pathname)) return false
    if (sections.includes("TODO_PUBLICO")) return true
    if (sections.includes("INICIO") && pathname === "/") return true

    return Object.entries(SECTION_PREFIXES).some(
        ([section, prefix]) => sections.includes(section) && matchesPrefix(pathname, prefix)
    )
}
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx tsx --test src/lib/promo-popup.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo-popup.ts src/lib/promo-popup.test.ts
git commit -m "feat: agrega logica de resolucion del popup promocional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Modelo Prisma y migración con el contenido actual

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260812120000_add_promo_popup/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `prisma.promoPopup` con los campos `id`, `isActive`, `eyebrow`, `kicker`, `title`, `description`, `imageUrl`, `linkUrl`, `linkLabel`, `mediaCaption`, `sections`, `updatedAt`, `updatedById`.

- [ ] **Step 1: Agrega el modelo al schema**

Al final de `prisma/schema.prisma`:

```prisma
model PromoPopup {
  id           String   @id @default("default")
  isActive     Boolean  @default(false)
  eyebrow      String?
  kicker       String?
  title        String
  description  String?
  imageUrl     String?
  linkUrl      String?
  linkLabel    String?
  mediaCaption String?
  sections     String[] @default([])
  updatedAt    DateTime @updatedAt
  updatedById  String?

  updatedBy User? @relation(fields: [updatedById], references: [id], onDelete: SetNull)

  @@map("promo_popups")
}
```

- [ ] **Step 2: Agrega la relación inversa en `User`**

Dentro del `model User`, junto a las demás relaciones, agrega:

```prisma
  promoPopups PromoPopup[]
```

- [ ] **Step 3: Valida el schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Si se queja de la relación, es que falta el campo inverso del Step 2.

- [ ] **Step 4: Escribe la migración a mano**

Crea `prisma/migrations/20260812120000_add_promo_popup/migration.sql`. El `INSERT` va en el mismo archivo que el `CREATE TABLE` a propósito: el popup ya está en producción y no puede desaparecer durante el deploy.

```sql
-- CreateTable
CREATE TABLE "promo_popups" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "eyebrow" TEXT,
    "kicker" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "linkLabel" TEXT,
    "mediaCaption" TEXT,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "promo_popups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "promo_popups" ADD CONSTRAINT "promo_popups_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Contenido actual del popup en produccion, para que el deploy sea transparente
INSERT INTO "promo_popups" (
    "id", "isActive", "eyebrow", "kicker", "title", "description",
    "imageUrl", "linkUrl", "linkLabel", "mediaCaption", "sections", "updatedAt"
) VALUES (
    'default',
    true,
    'Estreno FDNDA',
    'Voces del Agua',
    'Conoce a la nadadora más rápida de la historia del Perú',
    'Rafaela Fernandini comparte el camino detrás de sus récords: disciplina, perseverancia y la pasión de representar al Perú.',
    NULL,
    'https://www.youtube.com/watch?v=AbSRrPAz4Zo',
    'Ver ahora en YouTube',
    'Temporada 1 · Episodio 1',
    ARRAY['INICIO','EVENTOS','MERCH'],
    NOW()
);
```

Confirma que la tabla de usuarios se llama `users`: `grep -n '@@map("users")' prisma/schema.prisma`. Si no coincide, corrige el `REFERENCES` del foreign key.

- [ ] **Step 5: Regenera el cliente y comprueba que compila**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes de `scripts/tmp-inspect-user-orders.ts` (`serie`, `correlativo`, `total`, `fechaEmision`). Cualquier error nuevo es tuyo.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260812120000_add_promo_popup
git commit -m "feat: agrega modelo PromoPopup con el contenido actual sembrado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Validación del formulario

**Files:**
- Modify: `src/lib/promo-popup.ts`
- Test: `src/lib/promo-popup.test.ts`

**Interfaces:**
- Consumes: `PROMO_SECTIONS` de la Task 1.
- Produces: `PromoPopupInput`, `PromoPopupErrors`, `validatePromoPopupInput(input: PromoPopupInput): PromoPopupErrors`. Devuelve un objeto vacío cuando todo está bien. Lo usan la ruta de admin (Task 5) y el formulario (Task 8).

- [ ] **Step 1: Escribe el test que falla**

Agrega al final de `src/lib/promo-popup.test.ts`, y suma `validatePromoPopupInput` al import de arriba:

```ts
const validInput = {
    isActive: true,
    eyebrow: "Estreno FDNDA",
    kicker: "Voces del Agua",
    title: "Conoce a la nadadora más rápida",
    description: "Rafaela Fernandini comparte el camino detrás de sus récords.",
    imageUrl: null,
    linkUrl: "https://www.youtube.com/watch?v=AbSRrPAz4Zo",
    linkLabel: "Ver ahora en YouTube",
    mediaCaption: "Temporada 1 · Episodio 1",
    sections: ["INICIO", "EVENTOS", "MERCH"],
}

test("validatePromoPopupInput acepta una config completa", () => {
    assert.deepEqual(validatePromoPopupInput(validInput), {})
})

test("validatePromoPopupInput acepta un popup sin enlace", () => {
    const errors = validatePromoPopupInput({
        ...validInput,
        linkUrl: null,
        linkLabel: null,
        imageUrl: "https://assets.ticketingfdnda.pe/promo/arte.jpg",
    })
    assert.deepEqual(errors, {})
})

test("validatePromoPopupInput exige titulo y secciones si esta activo", () => {
    const errors = validatePromoPopupInput({
        ...validInput,
        title: "   ",
        sections: [],
    })
    assert.ok(errors.title)
    assert.ok(errors.sections)
})

test("validatePromoPopupInput no exige nada si esta apagado", () => {
    const errors = validatePromoPopupInput({
        ...validInput,
        isActive: false,
        title: "",
        sections: [],
    })
    assert.deepEqual(errors, {})
})

test("validatePromoPopupInput exige etiqueta cuando hay enlace", () => {
    const errors = validatePromoPopupInput({ ...validInput, linkLabel: "  " })
    assert.ok(errors.linkLabel)
})

test("validatePromoPopupInput rechaza enlaces que no son http(s)", () => {
    assert.ok(validatePromoPopupInput({ ...validInput, linkUrl: "javascript:alert(1)" }).linkUrl)
    assert.ok(validatePromoPopupInput({ ...validInput, linkUrl: "no soy una url" }).linkUrl)
    assert.ok(validatePromoPopupInput({ ...validInput, linkUrl: "/eventos" }).linkUrl)
})

test("validatePromoPopupInput rechaza imagenes que no son http(s)", () => {
    assert.ok(validatePromoPopupInput({ ...validInput, imageUrl: "javascript:alert(1)" }).imageUrl)
})

test("validatePromoPopupInput rechaza secciones desconocidas", () => {
    assert.ok(validatePromoPopupInput({ ...validInput, sections: ["INICIO", "PISCINA"] }).sections)
})
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `npx tsx --test src/lib/promo-popup.test.ts`
Expected: FAIL — `validatePromoPopupInput is not a function` / error de import.

- [ ] **Step 3: Escribe la implementación**

Agrega al final de `src/lib/promo-popup.ts`:

```ts
export interface PromoPopupInput {
    isActive: boolean
    eyebrow: string | null
    kicker: string | null
    title: string
    description: string | null
    imageUrl: string | null
    linkUrl: string | null
    linkLabel: string | null
    mediaCaption: string | null
    sections: string[]
}

export type PromoPopupErrors = Partial<Record<keyof PromoPopupInput, string>>

function isAbsoluteHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
    } catch {
        return false
    }
}

function isBlank(value: string | null | undefined): boolean {
    return !value || value.trim().length === 0
}

/**
 * Valida la config del popup. Solo exige contenido cuando esta activo: un
 * popup apagado puede quedarse a medio llenar sin bloquear el guardado.
 */
export function validatePromoPopupInput(input: PromoPopupInput): PromoPopupErrors {
    const errors: PromoPopupErrors = {}

    if (input.isActive && isBlank(input.title)) {
        errors.title = "El título es obligatorio para activar el popup."
    }

    if (input.isActive && input.sections.length === 0) {
        errors.sections = "Elige al menos una sección donde mostrar el popup."
    }

    const unknown = input.sections.filter(
        (section) => !(PROMO_SECTIONS as readonly string[]).includes(section)
    )
    if (unknown.length > 0) {
        errors.sections = `Sección no válida: ${unknown.join(", ")}.`
    }

    if (!isBlank(input.linkUrl) && !isAbsoluteHttpUrl(input.linkUrl!.trim())) {
        errors.linkUrl = "El enlace debe ser una URL completa que empiece con http:// o https://."
    }

    if (!isBlank(input.linkUrl) && isBlank(input.linkLabel)) {
        errors.linkLabel = "Escribe el texto del botón, por ejemplo “Ver ahora en YouTube”."
    }

    if (!isBlank(input.imageUrl) && !isAbsoluteHttpUrl(input.imageUrl!.trim())) {
        errors.imageUrl = "La imagen debe ser una URL completa que empiece con http:// o https://."
    }

    return errors
}
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `npx tsx --test src/lib/promo-popup.test.ts`
Expected: PASS, 19 tests (11 de la Task 1 más 8 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo-popup.ts src/lib/promo-popup.test.ts
git commit -m "feat: valida la configuracion del popup promocional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: API pública

**Files:**
- Create: `src/app/api/promo-popup/route.ts`

**Interfaces:**
- Consumes: `resolvePromoImage` (Task 1), `prisma.promoPopup` (Task 2).
- Produces: `GET /api/promo-popup` → `{ promo: PromoApiPayload | null }`, donde `PromoApiPayload` tiene `eyebrow`, `kicker`, `title`, `description`, `image: { url, fit }`, `mediaCaption`, `linkUrl`, `linkLabel`, `sections: string[]`, `version: string`. Lo consume la Task 7.

- [ ] **Step 1: Escribe la ruta**

Crea `src/app/api/promo-popup/route.ts`:

```ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolvePromoImage } from "@/lib/promo-popup"

export const runtime = "nodejs"

// Cacheable en el borde: la respuesta no depende de cookies ni de sesion. Un
// cambio en el admin tarda hasta un minuto en propagarse.
const CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
}

export async function GET() {
    try {
        const promo = await prisma.promoPopup.findUnique({ where: { id: "default" } })

        if (!promo || !promo.isActive || promo.sections.length === 0) {
            return NextResponse.json({ promo: null }, { headers: CACHE_HEADERS })
        }

        return NextResponse.json(
            {
                promo: {
                    eyebrow: promo.eyebrow,
                    kicker: promo.kicker,
                    title: promo.title,
                    description: promo.description,
                    image: resolvePromoImage(promo.linkUrl, promo.imageUrl),
                    mediaCaption: promo.mediaCaption,
                    linkUrl: promo.linkUrl,
                    linkLabel: promo.linkLabel,
                    sections: promo.sections,
                    version: promo.updatedAt.toISOString(),
                },
            },
            { headers: CACHE_HEADERS }
        )
    } catch (error) {
        console.error("promo-popup GET error:", error)
        // Un fallo de BD no debe romper la pagina ni quedarse cacheado.
        return NextResponse.json({ promo: null }, { headers: { "Cache-Control": "no-store" } })
    }
}
```

- [ ] **Step 2: Comprueba que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes de `scripts/tmp-inspect-user-orders.ts`.

- [ ] **Step 3: Verifícalo contra la BD**

Levanta el server (`npm run dev`) y pide la ruta:

Run: `curl -s http://localhost:3000/api/promo-popup`

Expected: si ya aplicaste la migración en tu BD, sale el JSON de "Voces del Agua" con `image.url` apuntando a `https://i.ytimg.com/vi/AbSRrPAz4Zo/maxresdefault.jpg` y `image.fit` en `"contain"`. Si la tabla todavía no existe en tu BD, sale `{"promo":null}` y en la consola del server el error de Prisma: eso también es correcto, demuestra que la ruta no revienta.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/promo-popup/route.ts
git commit -m "feat: expone la configuracion publica del popup promocional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: API de admin

**Files:**
- Create: `src/app/api/admin/promo-popup/route.ts`

**Interfaces:**
- Consumes: `validatePromoPopupInput`, `PromoPopupInput` (Task 3), `prisma.promoPopup` (Task 2), `getCurrentUser` de `@/lib/auth`.
- Produces: `GET /api/admin/promo-popup` → `{ success: true, promo: <fila o null> }`; `PUT` → `{ success: true, promo }` o `{ success: false, errors: PromoPopupErrors }` con status 400. Lo consume la Task 8.

- [ ] **Step 1: Escribe la ruta**

Crea `src/app/api/admin/promo-popup/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { validatePromoPopupInput, type PromoPopupInput } from "@/lib/promo-popup"

export const runtime = "nodejs"

const PROMO_ID = "default"

async function requireAdmin() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") return null
    return user
}

// Normaliza lo que llega del formulario: los strings vacios se guardan como
// NULL para que el componente pueda preguntar simplemente "hay valor?".
function toNullable(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export async function GET() {
    try {
        const user = await requireAdmin()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const promo = await prisma.promoPopup.findUnique({ where: { id: PROMO_ID } })
        return NextResponse.json({ success: true, promo })
    } catch (error) {
        console.error("admin promo-popup GET error:", error)
        return NextResponse.json(
            { success: false, error: "Error al cargar el popup" },
            { status: 500 }
        )
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await requireAdmin()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()

        const input: PromoPopupInput = {
            isActive: body.isActive === true,
            eyebrow: toNullable(body.eyebrow),
            kicker: toNullable(body.kicker),
            title: typeof body.title === "string" ? body.title.trim() : "",
            description: toNullable(body.description),
            imageUrl: toNullable(body.imageUrl),
            linkUrl: toNullable(body.linkUrl),
            linkLabel: toNullable(body.linkLabel),
            mediaCaption: toNullable(body.mediaCaption),
            sections: Array.isArray(body.sections)
                ? body.sections.filter((s: unknown): s is string => typeof s === "string")
                : [],
        }

        const errors = validatePromoPopupInput(input)
        if (Object.keys(errors).length > 0) {
            return NextResponse.json({ success: false, errors }, { status: 400 })
        }

        const data = { ...input, updatedById: user.id }

        const promo = await prisma.promoPopup.upsert({
            where: { id: PROMO_ID },
            update: data,
            create: { id: PROMO_ID, ...data },
        })

        return NextResponse.json({ success: true, promo })
    } catch (error) {
        console.error("admin promo-popup PUT error:", error)
        return NextResponse.json(
            { success: false, error: "Error al guardar el popup" },
            { status: 500 }
        )
    }
}
```

- [ ] **Step 2: Comprueba que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes.

- [ ] **Step 3: Verifica que el guard funciona**

Con el server en `npm run dev` y **sin sesión iniciada**:

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/promo-popup`
Expected: `401`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/promo-popup/route.ts
git commit -m "feat: agrega API de admin para editar el popup promocional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Componente de presentación

**Files:**
- Create: `src/components/promo/PromoPopupCard.tsx`

**Interfaces:**
- Consumes: `PromoImage` (Task 1).
- Produces: `PromoPopupCard`, `PromoPopupCardData`. Lo consumen la Task 7 (sitio) y la Task 8 (vista previa del admin).

Este componente sale de `src/components/home/VocesDelAguaPopup.tsx`: es el mismo marcado, pero recibiendo los datos por props en vez de tenerlos escritos, y sin overlay ni `sessionStorage`. Abre el archivo original para copiar las clases exactas.

- [ ] **Step 1: Escribe el componente**

Crea `src/components/promo/PromoPopupCard.tsx`:

```tsx
"use client"

import Image from "next/image"
import { ExternalLink, Play, X, Youtube } from "lucide-react"
import type { PromoImage } from "@/lib/promo-popup"

export interface PromoPopupCardData {
    eyebrow: string | null
    kicker: string | null
    title: string
    description: string | null
    image: PromoImage
    mediaCaption: string | null
    linkUrl: string | null
    linkLabel: string | null
}

interface PromoPopupCardProps {
    data: PromoPopupCardData
    /** "preview" quita el boton de cerrar: en el admin no hay nada que cerrar. */
    variant?: "modal" | "preview"
    onClose?: () => void
    onLinkClick?: () => void
    closeButtonRef?: React.Ref<HTMLButtonElement>
}

export function PromoPopupCard({
    data,
    variant = "modal",
    onClose,
    onLinkClick,
    closeButtonRef,
}: PromoPopupCardProps) {
    const hasLink = Boolean(data.linkUrl && data.linkLabel)
    const isModal = variant === "modal"

    const media = (
        <>
            {data.image.url ? (
                <Image
                    src={data.image.url}
                    alt={data.title}
                    fill
                    priority
                    unoptimized
                    sizes="(min-width: 768px) 540px, 100vw"
                    className={`${data.image.fit === "cover" ? "object-cover" : "object-contain"} transition duration-500 group-hover:scale-[1.025]`}
                />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10" />
            {hasLink ? (
                <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl transition duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
                    <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" aria-hidden="true" />
                </span>
            ) : null}
            {data.mediaCaption ? (
                <span className="absolute bottom-4 left-4 right-4 text-sm font-semibold text-white drop-shadow sm:bottom-5 sm:left-5">
                    {data.mediaCaption}
                </span>
            ) : null}
        </>
    )

    const mediaClassName =
        "group relative min-h-56 overflow-hidden bg-fdnda-primary sm:min-h-72 md:min-h-[500px]"

    return (
        <section
            role={isModal ? "dialog" : undefined}
            aria-modal={isModal ? true : undefined}
            aria-labelledby={isModal ? "promo-popup-title" : undefined}
            aria-describedby={isModal && data.description ? "promo-popup-description" : undefined}
            className="animate-fade-up relative z-10 grid max-h-[calc(100vh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/20 bg-white shadow-2xl md:grid-cols-[1.16fr_0.84fr]"
        >
            {isModal ? (
                <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar anuncio"
                    className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
                >
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>
            ) : null}

            {hasLink ? (
                <a
                    href={data.linkUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onLinkClick}
                    aria-label={`${data.linkLabel}: ${data.title}`}
                    className={mediaClassName}
                >
                    {media}
                </a>
            ) : (
                <div className={mediaClassName}>{media}</div>
            )}

            <div className="flex flex-col justify-center p-5 sm:p-8 md:p-9">
                {data.eyebrow ? (
                    <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-red-600">
                        <Youtube className="h-4 w-4" aria-hidden="true" />
                        {data.eyebrow}
                    </div>
                ) : null}

                {data.kicker ? (
                    <p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-fdnda-secondary">
                        {data.kicker}
                    </p>
                ) : null}

                <h2
                    id={isModal ? "promo-popup-title" : undefined}
                    className="font-display text-2xl font-bold leading-tight text-fdnda-primary sm:text-3xl"
                >
                    {data.title}
                </h2>

                {data.description ? (
                    <p
                        id={isModal ? "promo-popup-description" : undefined}
                        className="mt-4 text-sm leading-6 text-gray-600 sm:text-base"
                    >
                        {data.description}
                    </p>
                ) : null}

                {hasLink ? (
                    <a
                        href={data.linkUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onLinkClick}
                        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                    >
                        {data.linkLabel}
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                ) : null}

                {isModal ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-primary focus-visible:ring-offset-2"
                    >
                        Seguir viendo entradas
                    </button>
                ) : null}
            </div>
        </section>
    )
}
```

- [ ] **Step 2: Comprueba que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes.

- [ ] **Step 3: Commit**

```bash
git add src/components/promo/PromoPopupCard.tsx
git commit -m "refactor: extrae la presentacion del popup a PromoPopupCard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Popup del sitio conectado a la API

**Files:**
- Create: `src/components/promo/PromoPopup.tsx`
- Modify: `src/components/layout/MainLayoutWrapper.tsx:8` y `:22`
- Delete: `src/components/home/VocesDelAguaPopup.tsx`

**Interfaces:**
- Consumes: `PromoPopupCard`, `PromoPopupCardData` (Task 6), `isPromoVisibleOnPath` (Task 1), `GET /api/promo-popup` (Task 4).
- Produces: `PromoPopup` como export por defecto.

- [ ] **Step 1: Escribe el componente**

Crea `src/components/promo/PromoPopup.tsx`:

```tsx
"use client"

import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { isPromoVisibleOnPath } from "@/lib/promo-popup"
import { PromoPopupCard, type PromoPopupCardData } from "./PromoPopupCard"

interface PromoApiPayload extends PromoPopupCardData {
    sections: string[]
    version: string
}

export default function PromoPopup() {
    const pathname = usePathname()
    const closeButtonRef = useRef<HTMLButtonElement>(null)
    const [promo, setPromo] = useState<PromoApiPayload | null>(null)
    const [isDismissed, setIsDismissed] = useState(false)

    // Una sola peticion por montaje. No depende de pathname: navegar dentro del
    // sitio no debe volver a pedirla.
    useEffect(() => {
        let cancelled = false

        fetch("/api/promo-popup")
            .then((res) => (res.ok ? res.json() : null))
            .then((result) => {
                if (cancelled || !result?.promo) return
                setPromo(result.promo)
            })
            .catch(() => {
                // Si falla, simplemente no se muestra el popup.
            })

        return () => {
            cancelled = true
        }
    }, [])

    // La clave depende de la version (el updatedAt de la fila): si el admin
    // edita el contenido, el popup vuelve a salir aunque ya lo hubieran cerrado.
    const storageKey = promo ? `fdnda-promo-${promo.version}` : null

    useEffect(() => {
        if (!storageKey) return
        try {
            if (window.sessionStorage.getItem(storageKey)) setIsDismissed(true)
        } catch {
            // El popup sigue funcionando aunque el navegador bloquee sessionStorage.
        }
    }, [storageKey])

    const dismiss = useCallback(() => {
        if (storageKey) {
            try {
                window.sessionStorage.setItem(storageKey, "1")
            } catch {
                // No impedir la navegación si el almacenamiento no está disponible.
            }
        }
        setIsDismissed(true)
    }, [storageKey])

    const isOpen = Boolean(promo) && !isDismissed && isPromoVisibleOnPath(promo?.sections ?? [], pathname)

    useEffect(() => {
        if (!isOpen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        closeButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") dismiss()
        }

        window.addEventListener("keydown", handleKeyDown)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [dismiss, isOpen])

    if (!isOpen || !promo) return null

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar anuncio"
                className="absolute inset-0 cursor-default bg-[#001b38]/85 backdrop-blur-sm"
                onClick={dismiss}
            />
            <PromoPopupCard
                data={promo}
                variant="modal"
                onClose={dismiss}
                onLinkClick={dismiss}
                closeButtonRef={closeButtonRef}
            />
        </div>
    )
}
```

- [ ] **Step 2: Cambia el import del layout**

En `src/components/layout/MainLayoutWrapper.tsx`, reemplaza la línea 8:

```tsx
import VocesDelAguaPopup from "@/components/home/VocesDelAguaPopup"
```

por:

```tsx
import PromoPopup from "@/components/promo/PromoPopup"
```

Y en la línea 22 reemplaza `<VocesDelAguaPopup />` por `<PromoPopup />`.

- [ ] **Step 3: Borra el componente viejo**

```bash
git rm src/components/home/VocesDelAguaPopup.tsx
```

- [ ] **Step 4: Comprueba que no quedan referencias**

Run: `grep -rn "VocesDelAgua" src/`
Expected: sin resultados.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes.

- [ ] **Step 5: Verifícalo en el navegador**

Con la migración ya aplicada en tu BD y `npm run dev` corriendo, abre `http://localhost:3000` en una ventana nueva de incógnito.

Expected: sale el popup de "Voces del Agua", idéntico al de producción. Ciérralo, navega a `/eventos` y no debe volver a salir. Abre `/checkout` y no debe salir nunca.

- [ ] **Step 6: Commit**

```bash
git add src/components/promo/PromoPopup.tsx src/components/layout/MainLayoutWrapper.tsx
git commit -m "feat: el popup del sitio lee su contenido desde la API

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Formulario del admin

**Files:**
- Create: `src/components/admin/PromoPopupSettings.tsx`
- Modify: `src/components/ui/image-uploader.tsx:22`
- Modify: `src/app/admin/configuracion/page.tsx`

**Interfaces:**
- Consumes: `PROMO_SECTIONS`, `resolvePromoImage`, `PromoPopupErrors` (Tasks 1 y 3), `PromoPopupCard` (Task 6), `GET`/`PUT /api/admin/promo-popup` (Task 5), `ImageUploader` de `@/components/ui/image-uploader`.
- Produces: `PromoPopupSettings` (export nombrado).

- [ ] **Step 1: Permite el tipo "promo" en el uploader**

En `src/components/ui/image-uploader.tsx`, línea 22, cambia:

```tsx
    type?: "banner" | "logo" | "image" | "merch"
```

por:

```tsx
    type?: "banner" | "logo" | "image" | "merch" | "promo"
```

No hay que tocar nada más: `buildStoredAssetKey` en `src/lib/storage.ts:106` ya acepta cualquier `kind` y lo usa como carpeta.

- [ ] **Step 2: Escribe el formulario**

Crea `src/components/admin/PromoPopupSettings.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImageUploader } from "@/components/ui/image-uploader"
import { PromoPopupCard } from "@/components/promo/PromoPopupCard"
import { PROMO_SECTIONS, resolvePromoImage, type PromoPopupErrors } from "@/lib/promo-popup"
import { AlertCircle, CheckCircle, Loader2, Megaphone } from "lucide-react"

const SECTION_LABELS: Record<string, string> = {
    INICIO: "Inicio",
    EVENTOS: "Eventos",
    MERCH: "Merch",
    MI_CUENTA: "Mi cuenta",
    TODO_PUBLICO: "Todo el sitio público",
}

interface FormState {
    isActive: boolean
    eyebrow: string
    kicker: string
    title: string
    description: string
    imageUrl: string
    linkUrl: string
    linkLabel: string
    mediaCaption: string
    sections: string[]
}

const EMPTY_FORM: FormState = {
    isActive: false,
    eyebrow: "",
    kicker: "",
    title: "",
    description: "",
    imageUrl: "",
    linkUrl: "",
    linkLabel: "",
    mediaCaption: "",
    sections: [],
}

export function PromoPopupSettings() {
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [errors, setErrors] = useState<PromoPopupErrors>({})
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        fetch("/api/admin/promo-popup")
            .then((res) => res.json())
            .then((result) => {
                if (cancelled) return
                if (!result.success) {
                    setLoadError(result.error ?? "No se pudo cargar el popup")
                    return
                }
                if (result.promo) {
                    setForm({
                        isActive: result.promo.isActive,
                        eyebrow: result.promo.eyebrow ?? "",
                        kicker: result.promo.kicker ?? "",
                        title: result.promo.title ?? "",
                        description: result.promo.description ?? "",
                        imageUrl: result.promo.imageUrl ?? "",
                        linkUrl: result.promo.linkUrl ?? "",
                        linkLabel: result.promo.linkLabel ?? "",
                        mediaCaption: result.promo.mediaCaption ?? "",
                        sections: result.promo.sections ?? [],
                    })
                }
            })
            .catch(() => {
                if (!cancelled) setLoadError("No se pudo cargar el popup")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }))
        setSaved(false)
    }

    const toggleSection = (section: string) => {
        setSaved(false)
        setForm((prev) => {
            // "Todo el sitio publico" es excluyente: no tiene sentido combinarlo.
            if (section === "TODO_PUBLICO") {
                return { ...prev, sections: prev.sections.includes(section) ? [] : ["TODO_PUBLICO"] }
            }
            const withoutGlobal = prev.sections.filter((s) => s !== "TODO_PUBLICO")
            return {
                ...prev,
                sections: withoutGlobal.includes(section)
                    ? withoutGlobal.filter((s) => s !== section)
                    : [...withoutGlobal, section],
            }
        })
    }

    const handleSave = async () => {
        setIsSaving(true)
        setErrors({})
        setSaved(false)

        try {
            const res = await fetch("/api/admin/promo-popup", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            const result = await res.json()

            if (!result.success) {
                setErrors(result.errors ?? {})
                if (!result.errors) setLoadError(result.error ?? "No se pudo guardar")
                return
            }

            setSaved(true)
            setTimeout(() => setSaved(false), 4000)
        } catch {
            setLoadError("No se pudo guardar el popup")
        } finally {
            setIsSaving(false)
        }
    }

    const previewData = {
        eyebrow: form.eyebrow || null,
        kicker: form.kicker || null,
        title: form.title || "Título del popup",
        description: form.description || null,
        image: resolvePromoImage(form.linkUrl || null, form.imageUrl || null),
        mediaCaption: form.mediaCaption || null,
        linkUrl: form.linkUrl || null,
        linkLabel: form.linkLabel || null,
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5" />
                    Popup promocional
                </CardTitle>
                <CardDescription>
                    Anuncio que se muestra una vez por sesión a los visitantes. Los cambios tardan
                    hasta un minuto en verse en el sitio.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
                {isLoading ? (
                    <p className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando…
                    </p>
                ) : (
                    <>
                        {loadError ? (
                            <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                                <AlertCircle className="h-4 w-4" />
                                {loadError}
                            </p>
                        ) : null}

                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => update("isActive", e.target.checked)}
                                className="h-5 w-5 rounded border-gray-300"
                            />
                            <span className="text-sm font-semibold">Popup activo</span>
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Etiqueta superior" hint="Ej: Estreno FDNDA">
                                <Input
                                    value={form.eyebrow}
                                    onChange={(e) => update("eyebrow", e.target.value)}
                                />
                            </Field>
                            <Field label="Antetítulo" hint="Ej: Voces del Agua">
                                <Input
                                    value={form.kicker}
                                    onChange={(e) => update("kicker", e.target.value)}
                                />
                            </Field>
                        </div>

                        <Field label="Título" error={errors.title}>
                            <Input
                                value={form.title}
                                onChange={(e) => update("title", e.target.value)}
                            />
                        </Field>

                        <Field label="Descripción">
                            <textarea
                                value={form.description}
                                onChange={(e) => update("description", e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-fdnda-primary focus:outline-none"
                            />
                        </Field>

                        <Field label="Pie de la imagen" hint="Ej: Temporada 1 · Episodio 1">
                            <Input
                                value={form.mediaCaption}
                                onChange={(e) => update("mediaCaption", e.target.value)}
                            />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field
                                label="Enlace"
                                hint="Opcional. Si es de YouTube, la miniatura se saca sola."
                                error={errors.linkUrl}
                            >
                                <Input
                                    value={form.linkUrl}
                                    onChange={(e) => update("linkUrl", e.target.value)}
                                    placeholder="https://www.youtube.com/watch?v=..."
                                />
                            </Field>
                            <Field label="Texto del botón" error={errors.linkLabel}>
                                <Input
                                    value={form.linkLabel}
                                    onChange={(e) => update("linkLabel", e.target.value)}
                                    placeholder="Ver ahora en YouTube"
                                />
                            </Field>
                        </div>

                        <div>
                            <ImageUploader
                                value={form.imageUrl}
                                onChange={(url) => update("imageUrl", url)}
                                type="promo"
                                label="Imagen propia (opcional)"
                            />
                            <p className="mt-2 text-xs text-gray-500">
                                Tamaño recomendado 1200 × 1500 px. Si la dejas vacía y el enlace es
                                de YouTube, se usa la miniatura del video.
                            </p>
                            {errors.imageUrl ? (
                                <p className="mt-1 text-xs text-red-600">{errors.imageUrl}</p>
                            ) : null}
                        </div>

                        <div>
                            <p className="mb-2 text-sm font-semibold">¿Dónde aparece?</p>
                            <div className="flex flex-wrap gap-3">
                                {PROMO_SECTIONS.map((section) => (
                                    <label
                                        key={section}
                                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={form.sections.includes(section)}
                                            disabled={
                                                section !== "TODO_PUBLICO" &&
                                                form.sections.includes("TODO_PUBLICO")
                                            }
                                            onChange={() => toggleSection(section)}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        {SECTION_LABELS[section]}
                                    </label>
                                ))}
                            </div>
                            {errors.sections ? (
                                <p className="mt-1 text-xs text-red-600">{errors.sections}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-gray-500">
                                Nunca aparece en el panel de admin, el escáner, tesorería ni el
                                proceso de pago.
                            </p>
                        </div>

                        <div>
                            <p className="mb-3 text-sm font-semibold">Vista previa</p>
                            <div className="scale-[0.85] overflow-hidden rounded-2xl bg-gray-100 p-4">
                                <PromoPopupCard data={previewData} variant="preview" />
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <Button onClick={handleSave} disabled={isSaving}>
                                {isSaving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Guardando…
                                    </>
                                ) : (
                                    "Guardar popup"
                                )}
                            </Button>
                            {saved ? (
                                <span className="flex items-center gap-1 text-sm text-green-600">
                                    <CheckCircle className="h-4 w-4" />
                                    Guardado
                                </span>
                            ) : null}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}

function Field({
    label,
    hint,
    error,
    children,
}: {
    label: string
    hint?: string
    error?: string
    children: React.ReactNode
}) {
    return (
        <div>
            <label className="mb-1 block text-sm font-semibold">{label}</label>
            {children}
            {hint && !error ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
            {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
    )
}
```

- [ ] **Step 3: Monta la card y quita el botón falso**

En `src/app/admin/configuracion/page.tsx`, cuatro ediciones puntuales.

**a)** Quita `Save,` de la lista de iconos de lucide (línea 15). **Deja `CheckCircle`**: se sigue usando en la línea 81, en otra card.

**b)** Agrega el import del componente nuevo, debajo del de `AbioCatalogControls` (línea 30):

```tsx
import { PromoPopupSettings } from "@/components/admin/PromoPopupSettings"
```

**c)** Borra el estado y el handler falsos. Elimina la línea 33:

```tsx
    const [saved, setSaved] = useState(false)
```

y el bloque de las líneas 58-61:

```tsx
    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
    }
```

Si `useState` deja de usarse en el archivo, quítalo del import de React; si el otro `useState` del tipo de cambio sigue ahí, déjalo.

**d)** Reemplaza el bloque de las líneas 279-294:

```tsx
            {/* Save Button */}
            <div className="flex justify-end">
                <Button onClick={handleSave} className="gap-2">
                    {saved ? (
                        <>
                            <CheckCircle className="h-4 w-4" />
                            Guardado
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4" />
                            Guardar Cambios
                        </>
                    )}
                </Button>
            </div>
```

por la card nueva:

```tsx
            <PromoPopupSettings />
```

El popup queda al final de la página, con su propio botón de guardar que sí persiste. Si `Button` deja de usarse en el archivo, quítalo del import.

Confirma que no quedó nada suelto:

Run: `grep -n "saved\|handleSave\|Save," src/app/admin/configuracion/page.tsx`
Expected: sin resultados.

- [ ] **Step 4: Comprueba que compila y pasa el lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: solo los 4 errores preexistentes.

Run: `npx eslint src/components/admin/PromoPopupSettings.tsx src/app/admin/configuracion/page.tsx src/components/promo`
Expected: sin errores.

- [ ] **Step 5: Pruébalo a mano**

Con `npm run dev` y sesión de admin, entra a `/admin/configuracion`:

1. El formulario aparece cargado con "Voces del Agua" y la vista previa se ve igual que el popup real.
2. Cambia el título → la vista previa cambia al instante.
3. Guarda, abre el sitio en incógnito → sale el título nuevo.
4. Desmarca todas las secciones con el popup activo y guarda → sale el error bajo las casillas y no guarda.
5. Borra el enlace y el texto del botón, guarda → el popup sale sin botón y la imagen no es clickeable.
6. Marca "Todo el sitio público" → las otras casillas se deshabilitan.
7. Apaga el popup y guarda → ya no sale en el sitio.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/PromoPopupSettings.tsx src/components/ui/image-uploader.tsx src/app/admin/configuracion/page.tsx
git commit -m "feat: permite editar el popup promocional desde el admin

Quita ademas el boton 'Guardar cambios' de configuracion, que no persistia
nada y se confundia con el guardado real del popup.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cierre

Después de la Task 8, con todo commiteado:

- [ ] Corre la suite de librería completa: `npx tsx --test src/lib/promo-popup.test.ts`
- [ ] Corre el build: `npm run build`. Expected: compila sin errores nuevos.
- [ ] **No pushees.** Deja los commits en local y avísale a Giorgio para que revise antes de mandar a `origin/staging`.

El deploy lo hace Giorgio, y esta vez el paso `migrate` **no es opcional** porque hay migración de Prisma. Los comandos están en la sección "Deploy" del spec.
