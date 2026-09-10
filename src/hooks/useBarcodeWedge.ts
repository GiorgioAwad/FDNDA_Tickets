"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { looksLikeSignedQrAttempt } from "@/lib/scan-payload"
import { getScannedJsonCandidates } from "@/lib/scanner-input"
import { looksLikeQRToken, QR_TOKEN_LENGTH, QR_TOKEN_PREFIX } from "@/lib/qr-token-format"

const DEFAULT_FLUSH_DELAY_MS = 180
// Techo de espera cuando el buffer trae un JSON a medio llegar. Acota cuanto se
// aguanta una transmision estancada antes de despachar lo que haya (que el
// parser rechazara), para que una lectura rota aflore en vez de colgarse.
const DEFAULT_MAX_PARTIAL_WAIT_MS = 2500
const LINE_ENDING_REGEX = /[\r\n]/

type TimeoutHandle = ReturnType<typeof setTimeout>

interface BarcodeWedgeBufferOptions {
    onScan: (raw: string) => void
    flushDelayMs?: number
    maxPartialWaitMs?: number
    schedule?: (callback: () => void, delayMs: number) => TimeoutHandle
    cancel?: (handle: TimeoutHandle) => void
}

/** Un JSON que empezo a llegar pero todavia no cierra. */
function isIncompletePayload(buffer: string): boolean {
    const trimmed = buffer.trim()
    if (trimmed && QR_TOKEN_PREFIX.startsWith(trimmed.toUpperCase())) return true
    if (looksLikeQRToken(trimmed)) return trimmed.length < QR_TOKEN_LENGTH
    if (!trimmed || !looksLikeSignedQrAttempt(trimmed)) return false

    return !getScannedJsonCandidates(trimmed).some((candidate) => {
        try {
            return typeof JSON.parse(candidate) === "object"
        } catch {
            return false
        }
    })
}

/**
 * Accumulates text produced by a HID barcode reader. Kept independent from
 * React so the timing and pause rules can be verified without a browser DOM.
 */
export class BarcodeWedgeBuffer {
    private buffer = ""
    private paused = false
    private timeout: TimeoutHandle | null = null
    private onScan: (raw: string) => void
    private stalledMs = 0
    private readonly flushDelayMs: number
    private readonly maxPartialWaitMs: number
    private readonly schedule: (callback: () => void, delayMs: number) => TimeoutHandle
    private readonly cancel: (handle: TimeoutHandle) => void

    constructor({
        onScan,
        flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
        maxPartialWaitMs = DEFAULT_MAX_PARTIAL_WAIT_MS,
        schedule = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        cancel = (handle) => globalThis.clearTimeout(handle),
    }: BarcodeWedgeBufferOptions) {
        this.onScan = onScan
        this.flushDelayMs = flushDelayMs
        this.maxPartialWaitMs = maxPartialWaitMs
        this.schedule = schedule
        this.cancel = cancel
    }

    updateOnScan(onScan: (raw: string) => void) {
        this.onScan = onScan
    }

    setPaused(paused: boolean) {
        this.paused = paused
        if (paused) this.reset()
    }

    push(chunk: string) {
        if (this.paused) {
            this.reset()
            return
        }

        this.buffer += chunk
        const terminatorIndex = this.buffer.search(LINE_ENDING_REGEX)
        if (terminatorIndex >= 0) {
            const completed = this.buffer.slice(0, terminatorIndex)
            this.reset()
            this.emit(completed)
            return
        }

        // Llegaron caracteres nuevos: la transmision avanza, el techo de espera
        // por estancamiento vuelve a cero.
        this.stalledMs = 0
        this.scheduleFlush()
    }

    flush() {
        if (this.paused) {
            this.reset()
            return
        }

        const completed = this.buffer
        this.reset()
        this.emit(completed)
    }

    reset() {
        if (this.timeout !== null) {
            this.cancel(this.timeout)
            this.timeout = null
        }
        this.buffer = ""
        this.stalledMs = 0
    }

    dispose() {
        this.reset()
    }

    private scheduleFlush() {
        if (this.timeout !== null) this.cancel(this.timeout)
        this.timeout = this.schedule(() => {
            this.timeout = null

            // El DS2278 en "Emulate Keypad" manda cada caracter como una
            // composicion Alt+numpad y deja pausas mayores a `flushDelayMs` a
            // media transmision. Despachar ahi partia el QR firmado por la mitad,
            // y esa mitad se colaba por el camino sin firma (`/api/scans/lookup`)
            // registrando la asistencia. Mientras el buffer sea un JSON a medio
            // llegar seguimos esperando; un codigo corto sigue saliendo al toque.
            if (
                isIncompletePayload(this.buffer) &&
                this.stalledMs + this.flushDelayMs < this.maxPartialWaitMs
            ) {
                this.stalledMs += this.flushDelayMs
                this.scheduleFlush()
                return
            }

            const completed = this.buffer
            this.buffer = ""
            this.stalledMs = 0
            this.emit(completed)
        }, this.flushDelayMs)
    }

    private emit(value: string) {
        const raw = value.trim()
        if (raw) this.onScan(raw)
    }
}

export function shouldAutofocusBarcodeWedge(
    activeElement: Element | null,
    body: HTMLElement | null,
    captureElement: HTMLTextAreaElement | null
) {
    return activeElement === null || activeElement === body || activeElement === captureElement
}

function isManualEditingTarget(
    target: EventTarget | null,
    captureElement: HTMLTextAreaElement | null
) {
    if (!(target instanceof HTMLElement) || target === captureElement) return false
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

interface UseBarcodeWedgeOptions {
    enabled: boolean
    paused: boolean
    onScan: (raw: string) => void
    flushDelayMs?: number
}

export function useBarcodeWedge({
    enabled,
    paused,
    onScan,
    flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
}: UseBarcodeWedgeOptions) {
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    const [isFocused, setIsFocused] = useState(false)
    const [isReceiving, setIsReceiving] = useState(false)
    const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [buffer] = useState(
        () => new BarcodeWedgeBuffer({ onScan, flushDelayMs })
    )

    useEffect(() => {
        buffer.updateOnScan(onScan)
    }, [buffer, onScan])

    const focusCapture = useCallback(() => {
        if (!enabled) return
        inputRef.current?.focus({ preventScroll: true })
    }, [enabled])

    const markActivity = useCallback(() => {
        setIsReceiving(true)
        if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current)
        activityTimerRef.current = setTimeout(() => {
            activityTimerRef.current = null
            setIsReceiving(false)
        }, flushDelayMs)
    }, [flushDelayMs])

    useEffect(() => {
        buffer.setPaused(paused || !enabled)

        if (!enabled) {
            if (document.activeElement === inputRef.current) inputRef.current?.blur()
            return
        }

        if (shouldAutofocusBarcodeWedge(document.activeElement, document.body, inputRef.current)) {
            focusCapture()
        }
    }, [buffer, enabled, paused, focusCapture])

    useEffect(() => {
        const handleWindowBlur = () => setIsFocused(false)
        const handleWindowFocus = () => {
            if (!enabled || isManualEditingTarget(document.activeElement, inputRef.current)) return
            setTimeout(focusCapture, 0)
        }

        const handleDocumentClick = (event: MouseEvent) => {
            if (!enabled || isManualEditingTarget(event.target, inputRef.current)) return
            setTimeout(focusCapture, 0)
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible" || !enabled) return
            if (isManualEditingTarget(document.activeElement, inputRef.current)) return
            setTimeout(focusCapture, 0)
        }

        window.addEventListener("blur", handleWindowBlur)
        window.addEventListener("focus", handleWindowFocus)
        document.addEventListener("click", handleDocumentClick, true)
        document.addEventListener("visibilitychange", handleVisibilityChange)
        return () => {
            window.removeEventListener("blur", handleWindowBlur)
            window.removeEventListener("focus", handleWindowFocus)
            document.removeEventListener("click", handleDocumentClick, true)
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
    }, [enabled, focusCapture])

    useEffect(() => {
        if (!enabled) return

        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            if (paused || event.target === inputRef.current) return
            if (isManualEditingTarget(event.target, inputRef.current)) return

            if (event.key === "Enter") {
                event.preventDefault()
                markActivity()
                buffer.flush()
                focusCapture()
                return
            }

            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault()
                markActivity()
                buffer.push(event.key)
                focusCapture()
                return
            }

            // Keypad emulation composes punctuation with Alt+numpad. Moving
            // focus on the first Alt event lets the browser insert the final
            // composed character into the capture textarea.
            if (event.key === "Alt" || event.altKey) focusCapture()
        }

        window.addEventListener("keydown", handleGlobalKeyDown, true)
        return () => window.removeEventListener("keydown", handleGlobalKeyDown, true)
    }, [buffer, enabled, focusCapture, markActivity, paused])

    useEffect(() => {
        return () => {
            buffer.dispose()
            if (activityTimerRef.current !== null) clearTimeout(activityTimerRef.current)
        }
    }, [buffer])

    const handleBeforeInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
        const nativeEvent = event.nativeEvent as InputEvent
        const chunk = nativeEvent.inputType === "insertLineBreak" ? "\n" : nativeEvent.data
        if (!chunk) return

        event.preventDefault()
        markActivity()
        buffer.push(chunk)
    }, [buffer, markActivity])

    const handleInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
        const chunk = event.currentTarget.value
        event.currentTarget.value = ""
        markActivity()
        buffer.push(chunk)
    }, [buffer, markActivity])

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter") return

        event.preventDefault()
        markActivity()
        const pendingChunk = event.currentTarget.value
        event.currentTarget.value = ""
        if (pendingChunk) buffer.push(pendingChunk)
        buffer.flush()
    }, [buffer, markActivity])

    return {
        inputRef,
        inputProps: {
            onBeforeInput: handleBeforeInput,
            onInput: handleInput,
            onKeyDown: handleKeyDown,
            onFocus: () => setIsFocused(true),
            onBlur: () => setIsFocused(false),
        },
        isFocused: enabled && isFocused,
        isReceiving: enabled && isReceiving,
        focusCapture,
    }
}
