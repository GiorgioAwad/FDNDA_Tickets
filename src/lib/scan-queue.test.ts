import assert from "node:assert/strict"
import test from "node:test"

import { ScanQueue } from "@/lib/scan-queue"

function deferred() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

test("scan queue runs a lone scan immediately", async () => {
    const validated: string[] = []
    const queue = new ScanQueue(async (raw) => {
        validated.push(raw)
    })

    await queue.push("ticket-1")

    assert.deepEqual(validated, ["ticket-1"])
    assert.equal(queue.isRunning, false)
})

test("scan queue does not drop a scan that arrives mid-validation", async () => {
    const validated: string[] = []
    const first = deferred()
    const queue = new ScanQueue(async (raw) => {
        validated.push(raw)
        if (raw === "ticket-1") await first.promise
    })

    const drained = queue.push("ticket-1")
    // El operador dispara al siguiente de la fila mientras el primero valida.
    void queue.push("ticket-2")

    assert.deepEqual(validated, ["ticket-1"], "la segunda espera, no se pierde")

    first.resolve()
    await drained

    assert.deepEqual(validated, ["ticket-1", "ticket-2"])
    assert.equal(queue.isRunning, false)
})

test("scan queue keeps only the latest pending scan", async () => {
    const validated: string[] = []
    const first = deferred()
    const queue = new ScanQueue(async (raw) => {
        validated.push(raw)
        if (raw === "ticket-1") await first.promise
    })

    const drained = queue.push("ticket-1")
    void queue.push("ticket-2")
    void queue.push("ticket-3")

    first.resolve()
    await drained

    // La fila avanza: no se rebobina a validar a alguien que ya paso.
    assert.deepEqual(validated, ["ticket-1", "ticket-3"])
})

test("scan queue keeps draining after a failed validation", async () => {
    const validated: string[] = []
    const first = deferred()
    const queue = new ScanQueue(async (raw) => {
        validated.push(raw)
        if (raw === "ticket-1") {
            await first.promise
            throw new Error("network down")
        }
    })

    const drained = queue.push("ticket-1")
    void queue.push("ticket-2")

    first.resolve()
    await drained

    assert.deepEqual(validated, ["ticket-1", "ticket-2"], "un error no traba la fila")
    assert.equal(queue.isRunning, false)
})
