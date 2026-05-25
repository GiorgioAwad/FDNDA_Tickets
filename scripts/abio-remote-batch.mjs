#!/usr/bin/env node
// Dispara el endpoint /api/cron/process-invoices en un ambiente desplegado
// (staging o produccion) cada N segundos y guarda evidencia en tmp/.
//
// Uso:
//   npm run abio:remote-batch -- --base https://fdnda-tickets-staging.vercel.app
//   npm run abio:remote-batch -- --base https://... --interval 120 --max 10
//   npm run abio:remote-batch -- --base https://... --once
//
// Variables de entorno requeridas:
//   CRON_SECRET   Bearer secret usado por el endpoint protegido.
//
// Las variables se cargan de .env.local, .env.staging y .env (en ese orden).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

function getArg(name, fallback = null) {
    const index = process.argv.indexOf(name)
    if (index === -1) return fallback
    return process.argv[index + 1] || fallback
}

function hasFlag(name) {
    return process.argv.includes(name)
}

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
        if (!(key in process.env)) process.env[key] = value
    }
    return true
}

function loadEnv() {
    for (const f of [".env.local", ".env.staging", ".env"]) loadEnvFile(f)
}

function timestampForFile(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-")
}

function nowIso() {
    return new Date().toISOString()
}

function logLine(prefix, payload) {
    const line = JSON.stringify({ t: nowIso(), tag: prefix, ...payload })
    process.stdout.write(line + "\n")
    return line
}

async function pingOnce({ base, secret, label }) {
    const url = `${base.replace(/\/$/, "")}/api/cron/process-invoices`
    const startedAt = nowIso()
    let httpStatus = null
    let bodyText = null
    let error = null

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                authorization: `Bearer ${secret}`,
                "content-type": "application/json",
                "x-abio-evidence-label": label || "",
            },
        })
        httpStatus = response.status
        bodyText = await response.text()
    } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }

    const finishedAt = nowIso()
    let parsedBody = null
    if (bodyText) {
        try {
            parsedBody = JSON.parse(bodyText)
        } catch {
            parsedBody = { raw: bodyText.slice(0, 2000) }
        }
    }

    return {
        url,
        startedAt,
        finishedAt,
        httpStatus,
        error,
        body: parsedBody,
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
    loadEnv()

    const base = getArg("--base", process.env.STAGING_BASE_URL || process.env.NEXT_PUBLIC_APP_URL)
    const secret = getArg("--secret", process.env.CRON_SECRET)
    const intervalSec = Number(getArg("--interval", "120"))
    const maxRuns = Number(getArg("--max", "0")) // 0 = sin limite
    const once = hasFlag("--once")
    const label = getArg("--label", `abio-test-${timestampForFile()}`)

    if (!base) {
        console.error("Falta --base o STAGING_BASE_URL/NEXT_PUBLIC_APP_URL")
        process.exit(2)
    }
    if (!secret) {
        console.error("Falta --secret o CRON_SECRET en env")
        process.exit(2)
    }
    if (!Number.isFinite(intervalSec) || intervalSec < 60) {
        console.error("--interval debe ser >= 60 (recomendado 120 para coincidir con ABIO)")
        process.exit(2)
    }

    const sessionStart = new Date()
    const outDir = path.join(repoRoot, "tmp")
    fs.mkdirSync(outDir, { recursive: true })
    const ndjsonPath = path.join(outDir, `abio-remote-batch-${timestampForFile(sessionStart)}.ndjson`)

    logLine("session.start", { base, intervalSec, once, maxRuns, label, log: ndjsonPath })

    let run = 0
    let shouldStop = false
    const stop = () => {
        shouldStop = true
        logLine("session.stopping", { reason: "signal" })
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)

    while (!shouldStop) {
        run += 1
        logLine("batch.start", { run, label })
        const result = await pingOnce({ base, secret, label })
        const line = logLine("batch.end", { run, ...result })
        fs.appendFileSync(ndjsonPath, line + "\n")

        if (once) break
        if (maxRuns > 0 && run >= maxRuns) break

        const waitMs = intervalSec * 1000
        logLine("batch.sleep", { run, waitSeconds: intervalSec })
        const start = Date.now()
        while (!shouldStop && Date.now() - start < waitMs) {
            await sleep(1000)
        }
    }

    logLine("session.end", { runs: run, log: ndjsonPath })
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
