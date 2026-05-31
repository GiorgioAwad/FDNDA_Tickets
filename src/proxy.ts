import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

const protectedRoutes = ["/mi-cuenta"]
const adminRoutes = ["/admin"]
const treasuryRoutes = ["/tesoreria"]
const staffRoutes = ["/scanner"]
const authRoutes = ["/login", "/register"]

export default auth(async (req) => {
    const { nextUrl } = req
    const session = req.auth
    const pathname = nextUrl.pathname

    if (authRoutes.some((route) => pathname.startsWith(route))) {
        if (session) {
            return NextResponse.redirect(new URL("/", nextUrl))
        }
        return NextResponse.next()
    }

    if (protectedRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            const loginUrl = new URL("/login", nextUrl)
            loginUrl.searchParams.set("callbackUrl", pathname)
            return NextResponse.redirect(loginUrl)
        }
    }

    if (adminRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            return NextResponse.redirect(new URL("/login", nextUrl))
        }
        if (session.user.role !== "ADMIN") {
            return NextResponse.redirect(new URL("/", nextUrl))
        }
    }

    if (treasuryRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            return NextResponse.redirect(new URL("/login", nextUrl))
        }
        if (session.user.role !== "TREASURY" && session.user.role !== "ADMIN") {
            return NextResponse.redirect(new URL("/", nextUrl))
        }
    }

    if (staffRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            return NextResponse.redirect(new URL("/login", nextUrl))
        }
        if (session.user.role !== "STAFF" && session.user.role !== "ADMIN") {
            return NextResponse.redirect(new URL("/", nextUrl))
        }
    }

    return NextResponse.next()
})

// Solo corremos el middleware en las rutas que realmente protege. Antes el
// matcher cubria TODO (menos assets), lo que hacia que NextAuth `auth()` seteara
// cookies CSRF en cada request — incluida la home publica — y eso impedia que
// Cloudflare cacheara el HTML (cf-cache-status: BYPASS por el Set-Cookie). Las
// rutas publicas (/, /eventos, ...) ya no pasan por aqui -> sin cookie, cacheables.
export const config = {
    matcher: [
        "/mi-cuenta/:path*",
        "/admin/:path*",
        "/tesoreria/:path*",
        "/scanner/:path*",
        "/login/:path*",
        "/register/:path*",
    ],
}
