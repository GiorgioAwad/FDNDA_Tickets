/**
 * Chequeo de SOLO LECTURA contra la API de consulta de Izipay.
 *
 * Sirve para validar si el endpoint de consulta (`searchIzipayTransaction`)
 * "ve" los pagos hechos con el formulario embebido. Consulta el estado de una
 * orden por su número de orden (= order.id en el flujo embebido) e imprime lo
 * que devuelve Izipay. NO escribe nada en la base ni confirma/cancela nada.
 *
 * Uso (dentro del contenedor con env de producción):
 *   tsx scripts/izipay-query-check.ts <ORDEN|CODIGO>
 *
 *   <ORDEN>  id completo (cuid) o el código corto del panel, p.ej. SQEZMHBX
 *
 * Recomendado: correrlo primero sobre una orden que SABÉS está pagada. Si
 * Izipay devuelve status PAID, el auto-heal del worker funcionará para los
 * pagos embebidos. Si devuelve otra cosa, la consulta no cubre ese producto.
 */
import { prisma } from "@/lib/prisma"
import { getIzipayQueryLanguage, searchIzipayTransaction } from "@/lib/izipay"

async function main() {
    const ref = process.argv[2]
    if (!ref) {
        console.error("Uso: tsx scripts/izipay-query-check.ts <ORDEN|CODIGO>")
        process.exit(1)
    }

    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    if (!merchantCode) {
        console.error("Falta IZIPAY_MERCHANT_CODE en el entorno.")
        process.exit(1)
    }

    const norm = ref.replace(/^#/, "").trim()
    const order = await prisma.order.findFirst({
        where: { OR: [{ id: norm }, { id: { endsWith: norm.toLowerCase() } }] },
        select: {
            id: true,
            status: true,
            providerOrderNumber: true,
            providerTransactionId: true,
            user: { select: { name: true, email: true } },
        },
    })

    if (!order) {
        console.error(`No se encontró ninguna orden para "${ref}".`)
        process.exit(1)
    }

    // En el flujo embebido la referencia que conoce Izipay es el order.id.
    // Si ya hay providerOrderNumber guardado, usamos ese.
    const orderNumber = order.providerOrderNumber || order.id
    const transactionId = order.providerTransactionId || order.id

    console.log("──────────────────────────────────────────")
    console.log(`Orden:    #${order.id.slice(-8).toUpperCase()}  (id: ${order.id})`)
    console.log(`Cliente:  ${order.user.name} <${order.user.email}>`)
    console.log(`Estado DB: ${order.status}`)
    console.log(`Consultando Izipay con numberOrden = ${orderNumber}`)
    console.log("──────────────────────────────────────────")

    const result = await searchIzipayTransaction({
        merchantCode,
        orderNumber,
        transactionId,
        language: getIzipayQueryLanguage(),
    })

    console.log("Resultado de Izipay:")
    console.log(JSON.stringify(result, null, 2))

    if (result.success && result.status === "PAID") {
        console.log("\n✅ Izipay reconoce este pago como PAID → el auto-heal SÍ cubre pagos embebidos.")
    } else if (result.success) {
        console.log(`\n⚠️ Izipay respondió status=${result.status}. Si esta orden está realmente pagada, la consulta NO ve el pago embebido.`)
    } else {
        console.log(`\n❌ La consulta falló: ${result.error ?? "error desconocido"} (retryable=${result.retryable ?? "?"})`)
    }
}

main()
    .catch((e) => {
        console.error("Error fatal:", e)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
