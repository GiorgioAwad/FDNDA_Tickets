import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

const { auth } = NextAuth(authConfig)

// Routes that require authentication
const protectedRoutes = ["/mi-cuenta", "/checkout"]

// Routes that require admin role
const adminRoutes = ["/admin"]

// Routes that require staff role
const staffRoutes = ["/scanner"]

// Auth pages (redirect if already logged in)
const authRoutes = ["/login", "/register"]

export default auth(async (req) => {
    const { nextUrl } = req
    const session = req.auth
    const pathname = nextUrl.pathname

    // Check if accessing auth pages while logged in
    if (authRoutes.some((route) => pathname.startsWith(route))) {
        if (session) {
            return NextResponse.redirect(new URL("/mi-cuenta", nextUrl))
        }
        return NextResponse.next()
    }

    // Check protected routes
    if (protectedRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            const loginUrl = new URL("/login", nextUrl)
            loginUrl.searchParams.set("callbackUrl", pathname)
            return NextResponse.redirect(loginUrl)
        }
    }

    // Check admin routes
    if (adminRoutes.some((route) => pathname.startsWith(route))) {
        if (!session) {
            return NextResponse.redirect(new URL("/login", nextUrl))
        }
        if (session.user.role !== "ADMIN") {
            return NextResponse.redirect(new URL("/", nextUrl))
        }
    }

    // Check staff routes
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
        /*
         * Match all request paths except:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public files
         */
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)",
    ],
}
