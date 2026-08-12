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
