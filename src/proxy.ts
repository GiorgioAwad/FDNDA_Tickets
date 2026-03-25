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

export const config = {
    matcher: [
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)",
    ],
}
