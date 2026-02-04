import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"
type UserRole = "USER" | "STAFF" | "ADMIN"

declare module "next-auth" {
    interface User {
        id: string
        role: UserRole
        emailVerified: Date | null
    }
    interface Session {
        user: {
            id: string
            name: string
            email: string
            role: UserRole
            emailVerified: Date | null
        }
    }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null
                }

                const email = credentials.email as string
                const password = credentials.password as string

                const user = await prisma.user.findUnique({
                    where: { email: email.toLowerCase() },
                })

                if (!user) {
                    return null
                }

                const passwordMatch = await bcrypt.compare(password, user.passwordHash)

                if (!passwordMatch) {
                    return null
                }

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    emailVerified: user.emailVerifiedAt ?? null,
                }
            },
        }),
    ],
})

/**
 * Get current user session (server-side)
 */
export async function getCurrentUser() {
    const session = await auth()
    return session?.user
}

/**
 * Check if user has required role
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
        USER: 1,
        STAFF: 2,
        ADMIN: 3,
    }
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}

/**
 * Hash password
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12)
}

/**
 * Generate random token
 */
export function generateToken(): string {
    return crypto.randomUUID() + "-" + Date.now().toString(36)
}
