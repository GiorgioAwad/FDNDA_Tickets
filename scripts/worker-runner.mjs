import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

function loadEnvFile(fileName) {
    const envPath = path.isAbsolute(fileName) ? fileName : path.join(repoRoot, fileName)
    if (!fs.existsSync(envPath)) return false

    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        if (!line || line.trim().startsWith("#")) continue

        const separatorIndex = line.indexOf("=")
        if (separatorIndex === -1) continue

        const key = line.slice(0, separatorIndex).trim()
        let value = line.slice(separatorIndex + 1).trim()
        value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")

        if (!(key in process.env)) {
            process.env[key] = value
        }
    }

    return true
}

// Next.js loads env files automatically, but this standalone worker does not.
// Keep .env.local precedence while still allowing missing keys to come from .env.
for (const fileName of [".env.local", ".env"]) {
    loadEnvFile(fileName)
}

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no esta configurado. Revisa .env.local o .env antes de iniciar el worker.")
}

await import("../src/worker/index.ts")
