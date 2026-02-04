import type { NextAuthConfig } from "next-auth"

type UserRole = "USER" | "STAFF" | "ADMIN"

// Session duration: 10 minutes of inactivity = session expires
const SESSION_MAX_AGE = 10 * 60 // 10 minutes in seconds
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
            }
            
            // Update last activity on session refresh
            if (trigger === "update") {
                token.lastActivity = Date.now()
            }
            
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
