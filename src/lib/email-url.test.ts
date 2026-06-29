import assert from "node:assert/strict"
import test from "node:test"
import {
    buildEmailUrl,
    canonicalizeQueuedEmailUrl,
    resolveEmailBaseUrl,
} from "./email-url"

test("prioriza el dominio explicito para links de email", () => {
    const url = resolveEmailBaseUrl({
        EMAIL_LINK_BASE_URL: "https://emails.ticketingfdnda.pe/",
        NEXT_PUBLIC_APP_URL: "https://ticketingfdnda.pe",
        NEXTAUTH_URL: "https://fdnda-tickets.vercel.app",
        NODE_ENV: "production",
    })

    assert.equal(url, "https://emails.ticketingfdnda.pe")
})

test("usa NEXT_PUBLIC_APP_URL antes que un NEXTAUTH_URL de Vercel", () => {
    const url = buildEmailUrl("/mi-cuenta/entradas", {
        NEXT_PUBLIC_APP_URL: "https://ticketingfdnda.pe/",
        NEXTAUTH_URL: "https://fdnda-tickets.vercel.app/",
        NODE_ENV: "production",
    })

    assert.equal(url, "https://ticketingfdnda.pe/mi-cuenta/entradas")
})

test("reescribe links antiguos de Vercel conservando el token", () => {
    const url = canonicalizeQueuedEmailUrl(
        "https://fdnda-tickets.vercel.app/verify-email?token=abc123",
        "/verify-email",
        {
            NEXT_PUBLIC_APP_URL: "https://ticketingfdnda.pe",
            NODE_ENV: "production",
        }
    )

    assert.equal(url, "https://ticketingfdnda.pe/verify-email?token=abc123")
})

test("no permite que un job altere la ruta esperada", () => {
    const url = canonicalizeQueuedEmailUrl(
        "https://example.com/phishing?token=abc123",
        "/reset-password",
        {
            NEXT_PUBLIC_APP_URL: "https://ticketingfdnda.pe",
            NODE_ENV: "production",
        }
    )

    assert.equal(url, "https://ticketingfdnda.pe/reset-password?token=abc123")
})

test("usa el dominio productivo seguro cuando no hay configuracion", () => {
    assert.equal(
        resolveEmailBaseUrl({ NODE_ENV: "production" }),
        "https://ticketingfdnda.pe"
    )
})

test("rechaza Vercel y localhost como origen de emails en produccion", () => {
    assert.equal(
        resolveEmailBaseUrl({
            NEXT_PUBLIC_APP_URL: "http://localhost:3000",
            NEXTAUTH_URL: "https://fdnda-tickets.vercel.app",
            NODE_ENV: "production",
        }),
        "https://ticketingfdnda.pe"
    )
})

test("rechaza Vercel tambien fuera de produccion (nunca emite links .vercel.app)", () => {
    // Sin NODE_ENV=production, un NEXTAUTH_URL de Vercel NO debe ganar.
    assert.equal(
        resolveEmailBaseUrl({
            NEXTAUTH_URL: "https://fdnda-tickets.vercel.app",
        }),
        "http://localhost:3000"
    )
    // Y si hay dominio oficial, ese gana sobre el de Vercel.
    assert.equal(
        resolveEmailBaseUrl({
            NEXT_PUBLIC_APP_URL: "https://ticketingfdnda.pe",
            NEXTAUTH_URL: "https://fdnda-tickets.vercel.app",
        }),
        "https://ticketingfdnda.pe"
    )
})
