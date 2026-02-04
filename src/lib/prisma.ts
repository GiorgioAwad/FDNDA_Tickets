import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set")
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

const adapter = new PrismaPg(pool)

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
})

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
  globalForPrisma.pool = pool
}

export default prisma
