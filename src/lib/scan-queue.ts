/**
 * Serializa las lecturas del lector HID sin perder ninguna.
 *
 * En la puerta el operador dispara al siguiente de la fila mientras la pantalla
 * todavia resuelve al anterior. Antes esa lectura se descartaba (la captura se
 * pausaba durante la validacion), asi que el pistoletazo se perdia en silencio y
 * habia que repetirlo: parte de la lentitud percibida no era latencia, era
 * trabajo repetido.
 *
 * Reglas:
 * - Si no hay nada en vuelo, la lectura corre de inmediato.
 * - Si hay una validacion en curso, la lectura queda pendiente y arranca apenas
 *   termine la anterior.
 * - Solo se retiene la ULTIMA pendiente. La fila avanza; no tiene sentido
 *   rebobinar y validar a alguien que ya paso.
 *
 * Se mantiene fuera de React para poder verificar el orden y el descarte sin un
 * DOM, igual que `BarcodeWedgeBuffer`.
 */
export class ScanQueue {
    private running = false
    private pending: string | null = null
    private readonly run: (raw: string) => Promise<void>

    constructor(run: (raw: string) => Promise<void>) {
        this.run = run
    }

    get isRunning() {
        return this.running
    }

    get pendingScan() {
        return this.pending
    }

    /** Encola una lectura. Devuelve la promesa del drenado si esta llamada lo inicia. */
    push(raw: string): Promise<void> {
        if (this.running) {
            this.pending = raw
            return Promise.resolve()
        }

        return this.drain(raw)
    }

    private async drain(first: string): Promise<void> {
        this.running = true

        try {
            let next: string | null = first

            while (next !== null) {
                const current = next
                this.pending = null

                try {
                    await this.run(current)
                } catch {
                    // Una lectura que falla no puede dejar la cola trabada: la
                    // siguiente persona de la fila tiene que poder pasar.
                }

                next = this.pending
            }
        } finally {
            this.running = false
        }
    }
}
