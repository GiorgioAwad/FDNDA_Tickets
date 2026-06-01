import type { NextAuthConfig } from "next-auth"

type UserRole = "USER" | "STAFF" | "TREASURY" | "ADMIN"

// STAFF necesita sesiones largas porque escanean durante jornadas completas.
// El resto de roles (incluido ADMIN/TREASURY, que ven datos sensibles) mantiene
// un timeout corto de inactividad por seguridad.
const STAFF_SESSION_HOURS = Number(process.env.STAFF_SESSION_MAX_AGE_HOURS) || 12

// Timeout de inactividad por rol, en segundos.
const INACTIVITY_LIMITS: Record<UserRole, number> = {
    STAFF: STAFF_SESSION_HOURS * 60 * 60, // jornada completa de escaneo
    USER: 10 * 60,
    ADMIN: 10 * 60,
    TREASURY: 10 * 60,
}
const DEFAULT_INACTIVITY = 10 * 60 // 10 minutos

// El cookie/JWT debe poder vivir tanto como el rol mas largo (STAFF). El timeout
// real, mas corto, se reimpone por rol en el callback `jwt`.
const SESSION_MAX_AGE = Math.max(...Object.values(INACTIVITY_LIMITS))
const SESSION_UPDATE_AGE = 60 // Refresh session every 1 minute of activity

export const authConfig = {
    pages: {
        signIn: "/login",
        error: "/login",
    },
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE,
        updateAge: SESSION_UPDATE_AGE,
    },
    callbacks: {
        async jwt({ token, user, trigger }) {
            if (user) {
                token.id = user.id
                token.role = user.role as UserRole
                token.emailVerified = user.emailVerified
                    ? user.emailVerified.toISOString()
                    : null
                token.lastActivity = Date.now()
                return token
            }

            // Refresh explicito desde el cliente (useSession().update()).
            if (trigger === "update") {
                token.lastActivity = Date.now()
                return token
            }

            // Token existente: aplicar timeout de inactividad por rol.
            const role = (token.role as UserRole) ?? "USER"
            const limitMs = (INACTIVITY_LIMITS[role] ?? DEFAULT_INACTIVITY) * 1000
            const last =
                typeof token.lastActivity === "number"
                    ? token.lastActivity
                    : Date.now()

            if (Date.now() - last > limitMs) {
                // Inactivo mas alla del limite de su rol -> cerrar sesion.
                return null
            }

            // Sigue activo: deslizar la ventana de inactividad.
            token.lastActivity = Date.now()
            return token
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string
                session.user.role = token.role as UserRole
                session.user.emailVerified =
                    typeof token.emailVerified === "string"
                        ? new Date(token.emailVerified)
                        : null
            }
            return session
        },
    },
    providers: [], // Configured in auth.ts
} satisfies NextAuthConfig
