import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
    console.error("DATABASE_URL is not set")
    process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const CATALOG: Array<{
    codigo: string
    indicador: string
    disciplina: string
    sede: string
    clases: number | null
    descripcion: string
}> = [
    { codigo: "HAQB12", indicador: "AC", disciplina: "AQUABEBE", sede: "HUANCHACO", clases: 12, descripcion: "AQUABEBE 12 clases - HUANCHACO" },
    { codigo: "HNAT08", indicador: "AC", disciplina: "NATACION", sede: "HUANCHACO", clases: 8, descripcion: "NATACION 8 clases - HUANCHACO" },
    { codigo: "HNAT12", indicador: "AC", disciplina: "NATACION", sede: "HUANCHACO", clases: 12, descripcion: "NATACION 12 clases - HUANCHACO" },
    { codigo: "HNAT20", indicador: "AC", disciplina: "NATACION", sede: "HUANCHACO", clases: 20, descripcion: "NATACION 20 clases - HUANCHACO" },
    { codigo: "HOTRXX", indicador: "AC", disciplina: "OTROS", sede: "HUANCHACO", clases: null, descripcion: "OTROS - HUANCHACO" },
    { codigo: "LART08", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "LIMA", clases: 8, descripcion: "NAT ARTISTICA 8 clases - LIMA" },
    { codigo: "LART12", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "LIMA", clases: 12, descripcion: "NAT ARTISTICA 12 clases - LIMA" },
    { codigo: "LBCAXX", indicador: "AC", disciplina: "BECA", sede: "LIMA", clases: null, descripcion: "BECA - LIMA" },
    { codigo: "LCLV04", indicador: "AC", disciplina: "CLAVADOS", sede: "LIMA", clases: 4, descripcion: "CLAVADOS 4 clases - LIMA" },
    { codigo: "LCLV08", indicador: "AC", disciplina: "CLAVADOS", sede: "LIMA", clases: 8, descripcion: "CLAVADOS 8 clases - LIMA" },
    { codigo: "LCLV12", indicador: "AC", disciplina: "CLAVADOS", sede: "LIMA", clases: 12, descripcion: "CLAVADOS 12 clases - LIMA" },
    { codigo: "LCLV20", indicador: "AC", disciplina: "CLAVADOS", sede: "LIMA", clases: 20, descripcion: "CLAVADOS 20 clases - LIMA" },
    { codigo: "LCLVXX", indicador: "AC", disciplina: "CLAVADOS", sede: "LIMA", clases: null, descripcion: "CLAVADOS - LIMA" },
    { codigo: "LMASXX", indicador: "AC", disciplina: "MASTER", sede: "LIMA", clases: null, descripcion: "MASTER - LIMA" },
    { codigo: "LNAT02", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 2, descripcion: "NATACION 2 clases - LIMA" },
    { codigo: "LNAT03", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 3, descripcion: "NATACION 3 clases - LIMA" },
    { codigo: "LNAT04", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 4, descripcion: "NATACION 4 clases - LIMA" },
    { codigo: "LNAT06", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 6, descripcion: "NATACION 6 clases - LIMA" },
    { codigo: "LNAT08", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 8, descripcion: "NATACION 8 clases - LIMA" },
    { codigo: "LNAT09", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 9, descripcion: "NATACION 9 clases - LIMA" },
    { codigo: "LNAT11", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 11, descripcion: "NATACION 11 clases - LIMA" },
    { codigo: "LNAT12", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 12, descripcion: "NATACION 12 clases - LIMA" },
    { codigo: "LNAT20", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 20, descripcion: "NATACION 20 clases - LIMA" },
    { codigo: "LNAT26", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: 26, descripcion: "NATACION 26 clases - LIMA" },
    { codigo: "LNATXX", indicador: "AC", disciplina: "NATACION", sede: "LIMA", clases: null, descripcion: "NATACION - LIMA" },
    { codigo: "LOTR02", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: 2, descripcion: "OTROS 2 clases - LIMA" },
    { codigo: "LOTR03", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: 3, descripcion: "OTROS 3 clases - LIMA" },
    { codigo: "LOTR04", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: 4, descripcion: "OTROS 4 clases - LIMA" },
    { codigo: "LOTR08", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: 8, descripcion: "OTROS 8 clases - LIMA" },
    { codigo: "LOTR12", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: 12, descripcion: "OTROS 12 clases - LIMA" },
    { codigo: "LOTRXX", indicador: "AC", disciplina: "OTROS", sede: "LIMA", clases: null, descripcion: "OTROS - LIMA" },
    { codigo: "LPOL08", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "LIMA", clases: 8, descripcion: "POLO ACUATICO 8 clases - LIMA" },
    { codigo: "LPOL12", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "LIMA", clases: 12, descripcion: "POLO ACUATICO 12 clases - LIMA" },
    { codigo: "LPOLXX", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "LIMA", clases: null, descripcion: "POLO ACUATICO - LIMA" },
    { codigo: "LRNTXX", indicador: "AC", disciplina: "REINTEGRO", sede: "LIMA", clases: null, descripcion: "REINTEGRO - LIMA" },
    { codigo: "LSEMXX", indicador: "AC", disciplina: "SEMILLERO", sede: "LIMA", clases: null, descripcion: "SEMILLERO - LIMA" },
    { codigo: "TAQB12", indicador: "AC", disciplina: "AQUABEBE", sede: "TRUJILLO", clases: 12, descripcion: "AQUABEBE 12 clases - TRUJILLO" },
    { codigo: "TAQBXX", indicador: "AC", disciplina: "AQUABEBE", sede: "TRUJILLO", clases: null, descripcion: "AQUABEBE - TRUJILLO" },
    { codigo: "TART06", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "TRUJILLO", clases: 6, descripcion: "NAT ARTISTICA 6 clases - TRUJILLO" },
    { codigo: "TART08", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "TRUJILLO", clases: 8, descripcion: "NAT ARTISTICA 8 clases - TRUJILLO" },
    { codigo: "TART12", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "TRUJILLO", clases: 12, descripcion: "NAT ARTISTICA 12 clases - TRUJILLO" },
    { codigo: "TART20", indicador: "AC", disciplina: "NAT_ARTISTICA", sede: "TRUJILLO", clases: 20, descripcion: "NAT ARTISTICA 20 clases - TRUJILLO" },
    { codigo: "TINC04", indicador: "AC", disciplina: "INCLUSION", sede: "TRUJILLO", clases: 4, descripcion: "INCLUSION 4 clases - TRUJILLO" },
    { codigo: "TINC08", indicador: "AC", disciplina: "INCLUSION", sede: "TRUJILLO", clases: 8, descripcion: "INCLUSION 8 clases - TRUJILLO" },
    { codigo: "TINC12", indicador: "AC", disciplina: "INCLUSION", sede: "TRUJILLO", clases: 12, descripcion: "INCLUSION 12 clases - TRUJILLO" },
    { codigo: "TNAT04", indicador: "AC", disciplina: "NATACION", sede: "TRUJILLO", clases: 4, descripcion: "NATACION 4 clases - TRUJILLO" },
    { codigo: "TNAT08", indicador: "AC", disciplina: "NATACION", sede: "TRUJILLO", clases: 8, descripcion: "NATACION 8 clases - TRUJILLO" },
    { codigo: "TNAT12", indicador: "AC", disciplina: "NATACION", sede: "TRUJILLO", clases: 12, descripcion: "NATACION 12 clases - TRUJILLO" },
    { codigo: "TNAT20", indicador: "AC", disciplina: "NATACION", sede: "TRUJILLO", clases: 20, descripcion: "NATACION 20 clases - TRUJILLO" },
    { codigo: "TNATXX", indicador: "AC", disciplina: "NATACION", sede: "TRUJILLO", clases: null, descripcion: "NATACION - TRUJILLO" },
    { codigo: "TOTR12", indicador: "AC", disciplina: "OTROS", sede: "TRUJILLO", clases: 12, descripcion: "OTROS 12 clases - TRUJILLO" },
    { codigo: "TOTRXX", indicador: "AC", disciplina: "OTROS", sede: "TRUJILLO", clases: null, descripcion: "OTROS - TRUJILLO" },
    { codigo: "TPOL06", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "TRUJILLO", clases: 6, descripcion: "POLO ACUATICO 6 clases - TRUJILLO" },
    { codigo: "TPOL08", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "TRUJILLO", clases: 8, descripcion: "POLO ACUATICO 8 clases - TRUJILLO" },
    { codigo: "TPOL12", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "TRUJILLO", clases: 12, descripcion: "POLO ACUATICO 12 clases - TRUJILLO" },
    { codigo: "TPOL20", indicador: "AC", disciplina: "POLO_ACUATICO", sede: "TRUJILLO", clases: 20, descripcion: "POLO ACUATICO 20 clases - TRUJILLO" },
    { codigo: "TRHB04", indicador: "AC", disciplina: "REHABILITACION", sede: "TRUJILLO", clases: 4, descripcion: "REHABILITACION 4 clases - TRUJILLO" },
    { codigo: "TRHB08", indicador: "AC", disciplina: "REHABILITACION", sede: "TRUJILLO", clases: 8, descripcion: "REHABILITACION 8 clases - TRUJILLO" },
    { codigo: "TRHB12", indicador: "AC", disciplina: "REHABILITACION", sede: "TRUJILLO", clases: 12, descripcion: "REHABILITACION 12 clases - TRUJILLO" },
    { codigo: "TRNT08", indicador: "AC", disciplina: "REINTEGRO", sede: "TRUJILLO", clases: 8, descripcion: "REINTEGRO 8 clases - TRUJILLO" },
    { codigo: "VNAT04", indicador: "AC", disciplina: "NATACION", sede: "VMT", clases: 4, descripcion: "NATACION 4 clases - VMT" },
    { codigo: "VNAT08", indicador: "AC", disciplina: "NATACION", sede: "VMT", clases: 8, descripcion: "NATACION 8 clases - VMT" },
    { codigo: "VNAT12", indicador: "AC", disciplina: "NATACION", sede: "VMT", clases: 12, descripcion: "NATACION 12 clases - VMT" },
    { codigo: "VNATXX", indicador: "AC", disciplina: "NATACION", sede: "VMT", clases: null, descripcion: "NATACION - VMT" },
    { codigo: "VSEM20", indicador: "AC", disciplina: "SEMILLERO", sede: "VMT", clases: 20, descripcion: "SEMILLERO 20 clases - VMT" },
    { codigo: "VSEMXX", indicador: "AC", disciplina: "SEMILLERO", sede: "VMT", clases: null, descripcion: "SEMILLERO - VMT" },
]

async function main() {
    console.log("Seeding ServilexService catalog...")
    console.log(`Total services to upsert: ${CATALOG.length}`)

    let created = 0
    let updated = 0

    for (const item of CATALOG) {
        const result = await prisma.servilexService.upsert({
            where: { codigo: item.codigo },
            update: {
                indicador: item.indicador,
                disciplina: item.disciplina,
                sede: item.sede,
                clases: item.clases,
                descripcion: item.descripcion,
                isActive: true,
            },
            create: {
                codigo: item.codigo,
                indicador: item.indicador,
                disciplina: item.disciplina,
                sede: item.sede,
                clases: item.clases,
                descripcion: item.descripcion,
                isActive: true,
            },
        })

        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            created++
        } else {
            updated++
        }
    }

    // Mark services not in catalog as inactive
    const catalogCodes = CATALOG.map(c => c.codigo)
    const deactivated = await prisma.servilexService.updateMany({
        where: {
            codigo: { notIn: catalogCodes },
            isActive: true,
        },
        data: { isActive: false },
    })

    console.log(`\nResults:`)
    console.log(`  Created: ${created}`)
    console.log(`  Updated: ${updated}`)
    console.log(`  Deactivated: ${deactivated.count}`)

    // Summary by discipline
    const byDiscipline = await prisma.servilexService.groupBy({
        by: ["disciplina"],
        where: { isActive: true },
        _count: true,
        orderBy: { _count: { disciplina: "desc" } },
    })
    console.log(`\nActive services by discipline:`)
    for (const row of byDiscipline) {
        console.log(`  ${row.disciplina}: ${row._count}`)
    }
}

main()
    .then(() => {
        console.log("\nDone.")
        process.exit(0)
    })
    .catch((error) => {
        console.error("Seed failed:", error)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
