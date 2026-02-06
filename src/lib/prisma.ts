import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

const databaseUrl = process.env.DATABASE_URL

// Solo crear el cliente si hay DATABASE_URL (evita errores en build de Vercel)
function createPrismaClient(): PrismaClient {
  if (!databaseUrl) {
    // Durante build, retornar un cliente mock que será reemplazado en runtime
    return new PrismaClient()
  }

  // Pool de conexiones optimizado para producción
  const pool = globalForPrisma.pool ?? new Pool({ 
    connectionString: databaseUrl,
    // Configuración para alta concurrencia
    max: process.env.NODE_ENV === "production" ? 20 : 10,  // Máximo de conexiones
    min: process.env.NODE_ENV === "production" ? 5 : 2,    // Mínimo de conexiones
    idleTimeoutMillis: 30000,        // Cerrar conexiones idle después de 30s
    connectionTimeoutMillis: 5000,   // Timeout para obtener conexión
    maxUses: 7500,                   // Reciclar conexión después de N usos
  })

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool
  }

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}

export default prisma
