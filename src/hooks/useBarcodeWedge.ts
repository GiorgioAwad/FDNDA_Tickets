"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const DEFAULT_FLUSH_DELAY_MS = 300
const LINE_ENDING_REGEX = /[\r\n]/

type TimeoutHandle = ReturnType<typeof setTimeout>

interface BarcodeWedgeBufferOptions {
    onScan: (raw: string) => void
    flushDelayMs?: number
    schedule?: (callback: () => void, delayMs: number) => TimeoutHandle
    cancel?: (handle: TimeoutHandle) => void
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
    private readonly flushDelayMs: number
    private readonly schedule: (callback: () => void, delayMs: number) => TimeoutHandle
    private readonly cancel: (handle: TimeoutHandle) => void

    constructor({
        onScan,
        flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
        schedule = setTimeout,
        cancel = clearTimeout,
    }: BarcodeWedgeBufferOptions) {
        this.onScan = onScan
        this.flushDelayMs = flushDelayMs
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
    }

    dispose() {
        this.reset()
    }

    private scheduleFlush() {
        if (this.timeout !== null) this.cancel(this.timeout)
        this.timeout = this.schedule(() => {
            this.timeout = null
            const completed = this.buffer
            this.buffer = ""
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
            if (!enabled) return
            if (shouldAutofocusBarcodeWedge(document.activeElement, document.body, inputRef.current)) {
                focusCapture()
                setIsFocused(true)
            }
        }

        window.addEventListener("blur", handleWindowBlur)
        window.addEventListener("focus", handleWindowFocus)
        return () => {
            window.removeEventListener("blur", handleWindowBlur)
            window.removeEventListener("focus", handleWindowFocus)
        }
    }, [enabled, focusCapture])

    useEffect(() => {
        return () => buffer.dispose()
    }, [buffer])

    const handleInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
        const chunk = event.currentTarget.value
        event.currentTarget.value = ""
        buffer.push(chunk)
    }, [buffer])

    return {
        inputRef,
        inputProps: {
            onInput: handleInput,
            onFocus: () => setIsFocused(true),
            onBlur: () => setIsFocused(false),
        },
        isFocused: enabled && isFocused,
        focusCapture,
    }
}
