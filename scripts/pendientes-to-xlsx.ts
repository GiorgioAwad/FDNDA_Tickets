/**
 * Convierte scripts/out/membresias-2026-pendientes.csv en un Excel (.xlsx) con
 * columnas ordenadas para contactar, en 2 hojas: "Sin cuenta" y "Revision".
 *
 * Uso:  tsx scripts/pendientes-to-xlsx.ts
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import * as XLSX from "xlsx"

// Parser CSV quote-aware (respeta comas/comillas dentro de campos).
function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let field = ""
    let record: string[] = []
    let quoted = false
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]
        const next = text[i + 1]
        if (quoted) {
            if (ch === '"' && next === '"') { field += '"'; i += 1 }
            else if (ch === '"') quoted = false
            else field += ch
            continue
        }
        if (ch === '"') quoted = true
        else if (ch === ",") { record.push(field); field = "" }
        else if (ch === "\n") { record.push(field); rows.push(record); record = []; field = "" }
        else if (ch !== "\r") field += ch
    }
    if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record) }
    return rows
}

async function main() {
    const inPath = path.resolve("scripts/out/membresias-2026-pendientes.csv")
    const outPath = path.resolve("scripts/out/membresias-2026-pendientes.xlsx")

    const rows = parseCsv(await readFile(inPath, "utf8")).filter((r) => r.some((c) => c.trim()))
    // header original: fila,bucket,motivo,alumno,dniAlumno,correo,celular,apoderado,posibleCuentaPorNombre,metodo,sede,plan
    const data = rows.slice(1)

    // Columnas ordenadas para contactar.
    const HEADER = [
        "Alumno", "DNI", "Correo", "Celular", "Apoderado (menores)",
        "Posible cuenta (verificar)", "Plan", "Sede", "Método", "Motivo", "Fila",
    ]
    const reorder = (r: string[]) => [
        r[3], r[4], r[5], r[6], r[7], r[8], r[11], r[10], r[9], r[2], r[0],
    ]
    const widths = [34, 12, 30, 16, 42, 34, 18, 8, 14, 44, 6].map((w) => ({ wch: w }))

    const sheet = (filtered: string[][]) => {
        const ws = XLSX.utils.aoa_to_sheet([HEADER, ...filtered.map(reorder)])
        ws["!cols"] = widths
        ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: HEADER.length - 1, r: filtered.length } }) }
        return ws
    }

    const sinCuenta = data.filter((r) => r[1] === "SIN-CUENTA")
    const revision = data.filter((r) => r[1] === "REVISION")

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet(sinCuenta), "Sin cuenta")
    XLSX.utils.book_append_sheet(wb, sheet(revision), "Revision")
    XLSX.writeFile(wb, outPath)

    console.log(`Excel generado: ${outPath}`)
    console.log(`  Hoja "Sin cuenta": ${sinCuenta.length} filas`)
    console.log(`  Hoja "Revision":   ${revision.length} filas`)
}

main().catch((e) => { console.error("Error:", e instanceof Error ? e.message : e); process.exit(1) })
