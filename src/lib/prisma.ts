import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

const databaseUrl = process.env.DATABASE_URL
const isProduction = process.env.NODE_ENV === "production"

function parsePoolValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function createPrismaClient(): PrismaClient {
  if (!databaseUrl) {
    // Durante build, retornar cliente sin adapter para evitar romper el build.
    return new PrismaClient()
  }

  const poolMax = parsePoolValue(process.env.DB_POOL_MAX, isProduction ? 5 : 10)
  const poolMin = Math.min(
    parsePoolValue(process.env.DB_POOL_MIN, isProduction ? 0 : 2),
    poolMax
  )

  const pool = globalForPrisma.pool ?? new Pool({
    connectionString: databaseUrl,
    // En serverless cada invocacion puede crear su propio pool.
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxUses: 7500,
  })

  if (!isProduction) {
    globalForPrisma.pool = pool
  }

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!isProduction) {
  globalForPrisma.prisma = prisma
}

export default prisma
