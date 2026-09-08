"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useBarcodeWedge } from "@/hooks/useBarcodeWedge"
import { ScanQueue } from "@/lib/scan-queue"
import { getScannedJsonCandidates } from "@/lib/scanner-input"
import { parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { 
    Camera, 
    CheckCircle, 
    XCircle, 
    Search, 
    ArrowLeft, 
    RefreshCw,
    Flashlight,
    FlashlightOff,
    History,
    Wifi,
    WifiOff,
    Volume2,
    VolumeX,
    Loader2,
    BarChart3,
    ShieldAlert,
    ScanLine
} from "lucide-react"
import type { Html5Qrcode, Html5QrcodeCameraScanConfig } from "html5-qrcode"

// ==================== TYPES ====================

interface ScanResult {
    valid: boolean
    success?: boolean
    reason?: string
    message?: string
    scannedAt?: string
    isPiscina?: boolean
    allowOverride?: boolean
    overridden?: boolean
    ticket?: {
        id: string
        ticketCode: string
        attendeeName: string
        attendeeDni: string
        eventTitle: string
        ticketTypeName: string
        entryDate: string
        usedAt?: string
    }
    attendance?: {
        total: number
        used: number
        remaining: number
    }
    isMembership?: boolean
}

interface ScanHistoryItem {
    id: string
    timestamp: Date
    ticketCode: string
    attendeeName: string | null
    valid: boolean
    reason?: string
}

interface SalesSummary {
    eventTitle: string
    isPoolFree: boolean
    date: string | null
    totalSold: number
    totalCapacity: number
    slots: Array<{ ticketTypeId: string; name: string; sold: number; capacity: number }>
}

// ==================== CONSTANTS ====================

// Motivos de rechazo (día/turno) que el forzado de emergencia de piscina puede sobrepasar.
const FORCEABLE_REASONS = new Set([
    "QR_EXPIRED",
    "WRONG_DAY",
    "WRONG_SHIFT",
    "INVALID_SHIFT",
    "NO_CLASSES",
    "SHIFT_REQUIRED",
    "MEMBERSHIP_WRONG_DAY",
    "MEMBERSHIP_WRONG_TIME",
])

const SCAN_DEBOUNCE_MS = 300 // Ultra-fast response between scans
const MAX_HISTORY_ITEMS = 50
const STORAGE_KEY_HISTORY = "scan-history"
const STORAGE_KEY_SOUND = "scan-sound-enabled"
const STORAGE_KEY_READER_MODE = "scan-reader-mode"
const READER_SUCCESS_RESET_MS = 2500
const TICKET_CODE_REGEX = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/
const TICKET_CODE_COMPACT_REGEX = /^[A-Z2-9]{12}$/
const TICKET_CODE_GROUP_FINDER_REGEX = /([A-Z2-9]{4}(?:-[A-Z2-9]{4}){2})/i
const TICKET_CODE_COMPACT_FINDER_REGEX = /([A-Z2-9]{12})/i
const CUID_REGEX = /^c[a-z0-9]{24}$/i
const SIGNED_QR_FIELDS = ["ticketId", "eventId", "userId", "date", "ticketCode", "nonce", "signature"] as const

type ParsedScanPayload =
    | {
          kind: "signed-qr"
          qrData: string
          displayCode: string
      }
    | {
          kind: "lookup"
          ticketCode?: string
          ticketId?: string
          displayCode: string
      }

function normalizeTicketCode(value?: string | null): string | null {
    if (!value) return null
    const upper = value.trim().toUpperCase()
    if (!upper) return null
    if (TICKET_CODE_REGEX.test(upper)) return upper

    const compact = upper.replace(/[^A-Z2-9]/g, "")
    if (!TICKET_CODE_COMPACT_REGEX.test(compact)) return null

    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`
}

function extractTicketCodeCandidate(value?: string | null): string | null {
    if (!value) return null
    const direct = normalizeTicketCode(value)
    if (direct) return direct

    const upper = value.toUpperCase()
    const grouped = upper.match(TICKET_CODE_GROUP_FINDER_REGEX)?.[1]
    if (grouped) {
        const normalized = normalizeTicketCode(grouped)
        if (normalized) return normalized
    }

    const compact = upper.match(TICKET_CODE_COMPACT_FINDER_REGEX)?.[1]
    if (compact) {
        const normalized = normalizeTicketCode(compact)
        if (normalized) return normalized
    }

    return null
}

function normalizeTicketId(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || !CUID_REGEX.test(trimmed)) return null
    return trimmed
}

function parseJsonObject(input: string): Record<string, unknown> | null {
    const trimmed = input.trim()
    if (!trimmed) return null

    const candidates = getScannedJsonCandidates(trimmed)

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            // Ignore invalid JSON candidate
        }
    }

    return null
}

function parseSignedQrPayload(input: string): { qrData: string; displayCode: string } | null {
    const parsed = parseJsonObject(input)
    if (!parsed) return null

    const hasRequiredFields = SIGNED_QR_FIELDS.every((field) => {
        const value = parsed[field]
        return typeof value === "string" && value.trim().length > 0
    })
    if (!hasRequiredFields) return null

    const normalizedTicketCode = normalizeTicketCode(String(parsed.ticketCode)) ?? String(parsed.ticketCode).trim()
    return {
        qrData: JSON.stringify(parsed),
        displayCode: normalizedTicketCode.slice(0, 20),
    }
}

function extractLookupFromUrl(input: string): { ticketCode?: string; ticketId?: string } | null {
    try {
        const url = new URL(input)
        const queryCode =
            extractTicketCodeCandidate(url.searchParams.get("ticketCode")) ??
            extractTicketCodeCandidate(url.searchParams.get("code")) ??
            extractTicketCodeCandidate(url.searchParams.get("ticket"))

        const queryId =
            normalizeTicketId(url.searchParams.get("ticketId")) ??
            normalizeTicketId(url.searchParams.get("id")) ??
            normalizeTicketId(url.searchParams.get("ticket"))

        if (queryCode || queryId) {
            return { ticketCode: queryCode ?? undefined, ticketId: queryId ?? undefined }
        }

        const pathSegments = url.pathname
            .split("/")
            .map((part) => decodeURIComponent(part))
            .filter(Boolean)
        const lastSegment = pathSegments[pathSegments.length - 1]
        const pathCode = extractTicketCodeCandidate(lastSegment)
        const pathId = normalizeTicketId(lastSegment)
        if (pathCode || pathId) {
            return { ticketCode: pathCode ?? undefined, ticketId: pathId ?? undefined }
        }
    } catch {
        // Not a URL
    }

    return null
}

function parseLookupPayload(input: string): ParsedScanPayload | null {
    const ticketCodeFromText = extractTicketCodeCandidate(input)
    const ticketIdFromText = normalizeTicketId(input)
    if (ticketCodeFromText || ticketIdFromText) {
        const displayCode = ticketCodeFromText ?? ticketIdFromText ?? input.slice(0, 20)
        return {
            kind: "lookup",
            ticketCode: ticketCodeFromText ?? undefined,
            ticketId: ticketIdFromText ?? undefined,
            displayCode,
        }
    }

    const fromUrl = extractLookupFromUrl(input)
    if (fromUrl?.ticketCode || fromUrl?.ticketId) {
        return {
            kind: "lookup",
            ticketCode: fromUrl.ticketCode,
            ticketId: fromUrl.ticketId,
            displayCode: fromUrl.ticketCode ?? fromUrl.ticketId ?? input.slice(0, 20),
        }
    }

    const parsedJson = parseJsonObject(input)
    if (parsedJson) {
        const jsonCode =
            extractTicketCodeCandidate(String(parsedJson.ticketCode ?? "")) ??
            extractTicketCodeCandidate(String(parsedJson.code ?? "")) ??
            extractTicketCodeCandidate(String(parsedJson.ticket ?? ""))

        const jsonId =
            normalizeTicketId(parsedJson.ticketId) ??
            normalizeTicketId(parsedJson.id) ??
            normalizeTicketId(parsedJson.ticket)

        if (jsonCode || jsonId) {
            return {
                kind: "lookup",
                ticketCode: jsonCode ?? undefined,
                ticketId: jsonId ?? undefined,
                displayCode: jsonCode ?? jsonId ?? input.slice(0, 20),
            }
        }
    }

    return null
}

function parseScannedPayload(rawData: string): ParsedScanPayload | null {
    const trimmed = rawData.trim()
    if (!trimmed) return null

    const signedPayload = parseSignedQrPayload(trimmed)
    if (signedPayload) {
        return {
            kind: "signed-qr",
            qrData: signedPayload.qrData,
            displayCode: signedPayload.displayCode,
        }
    }

    return parseLookupPayload(trimmed)
}

// ==================== COMPONENT ====================

export default function EventScannerPage() {
    const params = useParams()
    const router = useRouter()
    const eventId = params.eventId as string

    // Refs
    const scannerRef = useRef<Html5Qrcode | null>(null)
    const isStartingRef = useRef(false)
    const scanLockedRef = useRef(false)
    const lastScanTimeRef = useRef<number>(0)
    const lastScannedCodeRef = useRef<string | null>(null)
    // Último input crudo (QR o código) para poder reintentar con forzado de ingreso.
    const lastScannedRawRef = useRef<string | null>(null)
    const currentShiftRef = useRef("")

    const wakeLockRef = useRef<WakeLockSentinel | null>(null)
    const autoResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Espejo sincrono de `isProcessing`: el estado de React llega un render tarde
    // y la pistola dispara mas rapido que eso.
    const isProcessingRef = useRef(false)

    // State
    const [scanning, setScanning] = useState(false)
    const [cameraActive, setCameraActive] = useState(false)
    const [scanResult, setScanResult] = useState<ScanResult | null>(null)
    const [manualCode, setManualCode] = useState("")
    const [cameraError, setCameraError] = useState("")
    const [isOnline, setIsOnline] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)
    const [soundEnabled, setSoundEnabled] = useState(true)
    const [readerMode, setReaderMode] = useState(false)
    const [settingsLoaded, setSettingsLoaded] = useState(false)
    const [torchEnabled, setTorchEnabled] = useState(false)
    const [torchSupported, setTorchSupported] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([])
    const [eventName, setEventName] = useState<string>("")
    const [isPiscina, setIsPiscina] = useState(false)
    const [availableShifts, setAvailableShifts] = useState<string[]>([])
    const [currentShift, setCurrentShift] = useState("")
    const [scanCount, setScanCount] = useState({ today: 0, valid: 0 })
    const [showSales, setShowSales] = useState(false)
    const [salesLoading, setSalesLoading] = useState(false)
    const [salesData, setSalesData] = useState<SalesSummary | null>(null)
    const [salesDate, setSalesDate] = useState<string>(() =>
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Lima",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date())
    )

    const scannerId = useMemo(() => `qr-reader-${eventId}`, [eventId])

    // ==================== EFFECTS ====================

    useEffect(() => {
        currentShiftRef.current = currentShift
    }, [currentShift])

    // Load settings and history from localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            const savedSound = localStorage.getItem(STORAGE_KEY_SOUND)
            if (savedSound !== null) {
                setSoundEnabled(savedSound === "true")
            }

            setReaderMode(localStorage.getItem(STORAGE_KEY_READER_MODE) === "true")

            const savedHistory = localStorage.getItem(`${STORAGE_KEY_HISTORY}-${eventId}`)
            if (savedHistory) {
                try {
                    const parsed = JSON.parse(savedHistory) as ScanHistoryItem[]
                    setScanHistory(parsed.map(item => ({
                        ...item,
                        timestamp: new Date(item.timestamp)
                    })))
                } catch {
                    // Invalid history, ignore
                }
            }


            setSettingsLoaded(true)
        }
    }, [eventId])

    // Save history to localStorage
    useEffect(() => {
        if (typeof window !== "undefined" && scanHistory.length > 0) {
            localStorage.setItem(
                `${STORAGE_KEY_HISTORY}-${eventId}`,
                JSON.stringify(scanHistory.slice(0, MAX_HISTORY_ITEMS))
            )
        }
    }, [scanHistory, eventId])

    // Save sound preference
    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY_SOUND, String(soundEnabled))
        }
    }, [soundEnabled])

    // Reader mode belongs to this device, not to the user or event.
    useEffect(() => {
        if (settingsLoaded) {
            localStorage.setItem(STORAGE_KEY_READER_MODE, String(readerMode))
        }
    }, [readerMode, settingsLoaded])

    // Warm the authenticated validation function and database connection
    // while the operator prepares the first ticket.
    useEffect(() => {
        if (!settingsLoaded || !readerMode) return

        const controller = new AbortController()
        void fetch("/api/scans/validate", {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
        }).catch(() => {})

        return () => controller.abort()
    }, [readerMode, settingsLoaded])

    // Network status
    useEffect(() => {
        const handleOnline = () => setIsOnline(true)
        const handleOffline = () => setIsOnline(false)

        window.addEventListener("online", handleOnline)
        window.addEventListener("offline", handleOffline)
        setIsOnline(navigator.onLine)

        return () => {
            window.removeEventListener("online", handleOnline)
            window.removeEventListener("offline", handleOffline)
        }
    }, [])

    // Fetch event info
    useEffect(() => {
        const fetchEventInfo = async () => {
            try {
                const response = await fetch(`/api/events/${eventId}`)
                if (response.ok) {
                    const payload = await response.json() as {
                        data?: {
                            title?: string
                            category?: string
                            ticketTypes?: Array<{ validDays?: unknown }>
                        }
                    }
                    const eventData = payload?.data

                    setEventName(eventData?.title || "Evento")
                    setIsPiscina(eventData?.category === "PISCINA_LIBRE")

                    const shiftSet = new Set<string>()
                    for (const ticketType of eventData?.ticketTypes ?? []) {
                        const schedule = parseTicketScheduleConfig(ticketType.validDays)
                        for (const shift of schedule.shifts) {
                            shiftSet.add(shift)
                        }
                    }

                    const nextShifts = Array.from(shiftSet)
                    setAvailableShifts(nextShifts)
                    setCurrentShift((previous) =>
                        previous && nextShifts.includes(previous)
                            ? previous
                            : (nextShifts[0] ?? "")
                    )
                }
            } catch {
                // Ignore errors
            }
        }
        fetchEventInfo()
    }, [eventId])

    // Calculate today's scan count
    useEffect(() => {
        const today = new Date().toDateString()
        const todayScans = scanHistory.filter(
            (s) => new Date(s.timestamp).toDateString() === today
        )
        setScanCount({
            today: todayScans.length,
            valid: todayScans.filter((s) => s.valid).length,
        })
    }, [scanHistory])

    // Keep the screen awake in both camera and reader modes.
    useEffect(() => {
        // Request Wake Lock to keep screen on
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLockRef.current = await navigator.wakeLock.request('screen')
                    console.log('Wake Lock active - screen will stay on')
                }
            } catch (err) {
                console.log('Wake Lock not available:', err)
            }
        }
        requestWakeLock()

        // Re-request wake lock if page becomes visible again
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && !wakeLockRef.current) {
                await requestWakeLock()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            void stopCamera()
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            // Release wake lock
            if (wakeLockRef.current) {
                wakeLockRef.current.release()
                wakeLockRef.current = null
            }
        }
        // stopCamera is intentionally stable and declared below this mount-only effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ==================== HELPER FUNCTIONS ====================

    const formatScanTime = (value?: string) => {
        if (!value) return null
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return null
        return new Intl.DateTimeFormat("es-PE", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date)
    }

    const playSound = useCallback((type: "beep" | "success" | "error") => {
        if (!soundEnabled) return

        try {
            const context = new AudioContext()
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            const now = context.currentTime
            const frequency = type === "success" ? 1047 : type === "error" ? 220 : 880
            const duration = type === "error" ? 0.18 : type === "success" ? 0.12 : 0.06

            oscillator.type = type === "error" ? "square" : "sine"
            oscillator.frequency.setValueAtTime(frequency, now)
            gain.gain.setValueAtTime(0.0001, now)
            gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(now)
            oscillator.stop(now + duration)
            oscillator.addEventListener("ended", () => void context.close(), { once: true })
        } catch {
            // Sound feedback must never interrupt ticket validation.
        }
    }, [soundEnabled])

    const vibrate = useCallback((pattern: number | number[]) => {
        if ("vibrate" in navigator) {
            navigator.vibrate(pattern)
        }
    }, [])

    const addToHistory = useCallback((result: ScanResult, code: string) => {
        const historyItem: ScanHistoryItem = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            ticketCode: result.ticket?.ticketCode || code.substring(0, 20),
            attendeeName: result.ticket?.attendeeName || null,
            valid: result.valid,
            reason: result.reason,
        }

        setScanHistory((prev) => [historyItem, ...prev].slice(0, MAX_HISTORY_ITEMS))
    }, [])

    const loadSales = useCallback(async () => {
        setSalesLoading(true)
        try {
            const qs = new URLSearchParams({ eventId })
            if (salesDate) qs.set("date", salesDate)
            const res = await fetch(`/api/scans/sales-summary?${qs.toString()}`, { cache: "no-store" })
            const json = (await res.json()) as { data?: SalesSummary }
            setSalesData(json.data ?? null)
        } catch {
            setSalesData(null)
        } finally {
            setSalesLoading(false)
        }
    }, [eventId, salesDate])

    // Cargar/recargar el resumen cuando se abre el panel o cambia la fecha.
    useEffect(() => {
        if (showSales) void loadSales()
    }, [showSales, salesDate, loadSales])

    // ==================== CAMERA FUNCTIONS ====================

    const stopCamera = useCallback(async () => {
        if (scannerRef.current) {
            try {
                if (scannerRef.current.isScanning) {
                    await scannerRef.current.stop()
                }
                await scannerRef.current.clear()
            } catch {
                // Ignore
            }
        }
        setCameraActive(false)
        setScanning(false)
        isStartingRef.current = false
        scanLockedRef.current = false
        setTorchEnabled(false)
    }, [])

    const toggleTorch = useCallback(async () => {
        if (!scannerRef.current || !torchSupported) return

        try {
            const track = scannerRef.current.getRunningTrackCameraCapabilities()
            if (track?.torchFeature()?.isSupported()) {
                const newState = !torchEnabled
                await track.torchFeature().apply(newState)
                setTorchEnabled(newState)
            }
        } catch (err) {
            console.error("Error toggling torch:", err)
        }
    }, [torchEnabled, torchSupported])

    const startCamera = useCallback(async () => {
        if (isStartingRef.current) return
        isStartingRef.current = true
        
        try {
            setCameraError("")
            setScanResult(null)
            
            if (!window.isSecureContext) {
                throw new Error("El escáner necesita HTTPS para acceder a la cámara.")
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error("Tu navegador no permite acceso a la cámara.")
            }

            const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode")
            
            // Clear previous instance if exists
            if (scannerRef.current) {
                try {
                    if (scannerRef.current.isScanning) {
                        await scannerRef.current.stop()
                    }
                    await scannerRef.current.clear()
                } catch {
                    // Ignore cleanup errors
                }
            }
            
            scannerRef.current = new Html5Qrcode(scannerId, {
                verbose: false,
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true,
                }
            })

            // Ultra-optimized config for INSTANT scanning
            const config: Html5QrcodeCameraScanConfig = {
                fps: 30,
                qrbox: (viewfinderWidth, viewfinderHeight) => {
                    // Scan area covers nearly the full frame for easy detection
                    const w = Math.floor(viewfinderWidth * 0.95)
                    const h = Math.floor(viewfinderHeight * 0.95)
                    return { width: w, height: h }
                },
                disableFlip: true,
            }

            setCameraActive(true)
            setScanning(true)

            // Auto-select back camera with high resolution for better distance scanning
            await scannerRef.current.start(
                { 
                    facingMode: { exact: "environment" }
                },
                config,
                (decodedText) => {
                    // Quick debounce check
                    const now = Date.now()
                    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
                        return
                    }
                    
                    if (scanLockedRef.current) {
                        return
                    }
                    
                    // Process immediately without checking lastScannedCode
                    // This fixes the "double scan" issue
                    lastScanTimeRef.current = now
                    handleScan(decodedText)
                },
                () => {
                    // Ignore scan errors (no QR in frame)
                }
            )

            // Check torch support
            try {
                const track = scannerRef.current.getRunningTrackCameraCapabilities()
                setTorchSupported(track?.torchFeature()?.isSupported() ?? false)
            } catch {
                setTorchSupported(false)
            }

        } catch (err) {
            console.error("Error accessing camera:", err)
            const errorMsg = (err as Error).message || "No se pudo acceder a la cámara."
            // Try with simple facingMode if exact fails
            if (errorMsg.includes("exact") || errorMsg.includes("constraint")) {
                try {
                    await startCameraFallback()
                    return
                } catch {
                    // Fallback also failed
                }
            }
            setCameraError(errorMsg)
            await stopCamera()
        } finally {
            isStartingRef.current = false
        }
    }, [scannerId, stopCamera])
    
    // Fallback camera start without exact constraint
    const startCameraFallback = useCallback(async () => {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode")
        
        if (!scannerRef.current) {
            scannerRef.current = new Html5Qrcode(scannerId, {
                verbose: false,
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: false,
                },
            })
        }
        
        const config: Html5QrcodeCameraScanConfig = {
            fps: 30,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const w = Math.floor(viewfinderWidth * 0.95)
                const h = Math.floor(viewfinderHeight * 0.95)
                return { width: w, height: h }
            },
            disableFlip: true,
        }
        
        setCameraActive(true)
        setScanning(true)
        
        await scannerRef.current.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
                const now = Date.now()
                if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS || scanLockedRef.current) {
                    return
                }
                lastScanTimeRef.current = now
                handleScan(decodedText)
            },
            () => {}
        )
    }, [scannerId])

    // Camera remains the default on phones. A device that remembers reader
    // mode never requests webcam permission when this page opens.
    useEffect(() => {
        if (!settingsLoaded) return

        const handleVisibilityChange = () => {
            if (
                document.visibilityState === "visible" &&
                !readerMode &&
                !scannerRef.current?.isScanning
            ) {
                void startCamera()
            }
        }

        if (readerMode) {
            void stopCamera()
        } else {
            void startCamera()
        }

        document.addEventListener("visibilitychange", handleVisibilityChange)
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
    }, [readerMode, settingsLoaded, startCamera, stopCamera])

    // ==================== SCAN HANDLERS ====================

    const handleScan = useCallback(async (qrData: string, opts?: { override?: boolean }) => {
        const override = opts?.override === true

        // Prevent duplicate processing (el forzado de emergencia sí puede reintentar).
        // Se lee del ref y no del estado: `isProcessing` no esta en las deps de
        // este callback, asi que la variable capturada quedaba congelada en su
        // valor inicial y el guard dependia solo de `scanLockedRef`.
        if (!override && (scanLockedRef.current || isProcessingRef.current)) {
            return
        }

        const parsedPayload = parseScannedPayload(qrData)
        if (!parsedPayload) {
            setScanning(false)
            setScanResult({
                valid: false,
                reason: "INVALID",
                message: "Lectura no reconocida. Vuelve a escanear el QR.",
            })
            playSound("error")
            vibrate([200, 100, 200])
            return
        }

        lastScannedCodeRef.current = parsedPayload.displayCode
        lastScannedRawRef.current = qrData
        setScanning(false)
        scanLockedRef.current = true
        isProcessingRef.current = true
        setIsProcessing(true)

        // Immediate feedback
        playSound("beep")
        vibrate(50)

        try {
            const endpoint = parsedPayload.kind === "signed-qr" ? "/api/scans/validate" : "/api/scans/lookup"
            const selectedShift = currentShiftRef.current || null
            const body =
                parsedPayload.kind === "signed-qr"
                    ? { qrData: parsedPayload.qrData, eventId, currentShift: selectedShift, override }
                    : {
                          ticketCode: parsedPayload.ticketCode,
                          ticketId: parsedPayload.ticketId,
                          rawInput: qrData,
                          eventId,
                          currentShift: selectedShift,
                          override,
                      }

            const validationStartedAt = performance.now()
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const serverTiming = response.headers.get("Server-Timing")
            const data = await response.json() as ScanResult
            const validationDurationMs = Math.round(performance.now() - validationStartedAt)
            // El desglose del servidor llega por `Server-Timing`. Restarlo del
            // total de ida y vuelta separa el tiempo de red del de la base de
            // datos, que es lo que no se podía distinguir desde la puerta.
            console.info(
                `[scanner] ${endpoint}: ${validationDurationMs} ms total` +
                    (serverTiming ? ` | servidor: ${serverTiming}` : "")
            )
            setScanResult(data)
            addToHistory(data, parsedPayload.displayCode)

            // Result feedback
            if (data.valid) {
                playSound("success")
                vibrate([100, 50, 100])
            } else {
                playSound("error")
                vibrate([200, 100, 200])
            }
        } catch (err) {
            console.error("Validation error:", err)
            const errorResult: ScanResult = {
                valid: false,
                reason: "ERROR",
                message: navigator.onLine ? "Error de conexión" : "Sin conexión a internet",
            }
            setScanResult(errorResult)
            playSound("error")
            vibrate([300, 100, 300])
        } finally {
            isProcessingRef.current = false
            setIsProcessing(false)
        }
    }, [eventId, playSound, vibrate, addToHistory])

    // Forzado de ingreso (emergencia) para piscina libre: reintenta el último
    // escaneo omitiendo la validación de día/turno. Confirmación previa.
    const forceLastScan = useCallback(() => {
        const raw = lastScannedRawRef.current
        if (!raw || isProcessing) return
        const confirmed = window.confirm(
            "¿Forzar el ingreso de este ticket fuera de su día/horario comprado? Se registrará como ingreso de emergencia."
        )
        if (!confirmed) return
        scanLockedRef.current = false
        handleScan(raw, { override: true })
    }, [handleScan, isProcessing])

    const handleManualSubmit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault()
        const raw = manualCode
        if (!parseScannedPayload(raw)) {
            setScanResult({
                valid: false,
                reason: "INVALID",
                message: "Código inválido",
            })
            return
        }

        setManualCode("")
        await handleScan(raw)
    }, [manualCode, handleScan])

    const resetScan = useCallback(() => {
        if (autoResetTimerRef.current !== null) {
            clearTimeout(autoResetTimerRef.current)
            autoResetTimerRef.current = null
        }
        setScanResult(null)
        lastScannedCodeRef.current = null
        setScanning(!readerMode)
        scanLockedRef.current = false
        if (!readerMode && !cameraActive) {
            void startCamera()
        }
    }, [cameraActive, readerMode, startCamera])

    const runReaderScan = useCallback(async (raw: string) => {
        if (autoResetTimerRef.current !== null) {
            clearTimeout(autoResetTimerRef.current)
            autoResetTimerRef.current = null
        }

        // A new trigger pull replaces any result left on screen, including a
        // rejection, without requiring the operator to touch the laptop.
        setScanResult(null)
        scanLockedRef.current = false
        await handleScan(raw)
    }, [handleScan])

    const runReaderScanRef = useRef(runReaderScan)
    useEffect(() => {
        runReaderScanRef.current = runReaderScan
    }, [runReaderScan])

    // Una lectura que llega mientras la anterior sigue validandose se ENCOLA, no
    // se descarta (ver `ScanQueue`). La cola vive en un ref para sobrevivir a los
    // renders sin reiniciarse a media fila.
    const scanQueueRef = useRef<ScanQueue | null>(null)
    if (scanQueueRef.current === null) {
        scanQueueRef.current = new ScanQueue((raw) => runReaderScanRef.current(raw))
    }

    const handleReaderScan = useCallback((raw: string) => {
        void scanQueueRef.current?.push(raw)
    }, [])

    const {
        inputRef: readerInputRef,
        inputProps: readerInputProps,
        isFocused: readerInputFocused,
        isReceiving: readerInputReceiving,
        focusCapture,
    } = useBarcodeWedge({
        enabled: settingsLoaded && readerMode,
        // La captura NO se pausa durante la validacion. Pausarla hacia que
        // `BarcodeWedgeBuffer` descartara los caracteres que llegaran mientras el
        // fetch estaba en vuelo, asi que un pistoletazo disparado en ese lapso se
        // perdia en silencio. Ahora se captura siempre y la re-entrada se resuelve
        // encolando en `handleReaderScan`.
        paused: false,
        onScan: handleReaderScan,
    })

    useEffect(() => {
        if (autoResetTimerRef.current !== null) {
            clearTimeout(autoResetTimerRef.current)
            autoResetTimerRef.current = null
        }

        if (!readerMode || !scanResult?.valid) return

        autoResetTimerRef.current = setTimeout(() => {
            autoResetTimerRef.current = null
            resetScan()
        }, READER_SUCCESS_RESET_MS)

        return () => {
            if (autoResetTimerRef.current !== null) {
                clearTimeout(autoResetTimerRef.current)
                autoResetTimerRef.current = null
            }
        }
    }, [readerMode, resetScan, scanResult])

    const toggleReaderMode = useCallback(() => {
        const nextReaderMode = !readerMode
        setCameraError("")
        setScanResult(null)
        scanLockedRef.current = false
        setReaderMode(nextReaderMode)

        if (nextReaderMode) {
            void stopCamera()
            setTimeout(() => readerInputRef.current?.focus({ preventScroll: true }), 0)
        }
    }, [readerInputRef, readerMode, stopCamera])

    const restartCamera = useCallback(async () => {
        await stopCamera()
        // Small delay to ensure camera is released
        setTimeout(() => startCamera(), 100)
    }, [stopCamera, startCamera])

    // ==================== RENDER ====================

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            <textarea
                ref={readerInputRef}
                {...readerInputProps}
                aria-hidden="true"
                tabIndex={-1}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="fixed -left-[9999px] top-0 h-px w-px opacity-0 pointer-events-none"
            />

            {/* Header */}
            <div className="p-3 flex items-center justify-between bg-gray-900 border-b border-gray-800">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => router.push("/scanner")}
                    className="text-white hover:bg-white/10 shrink-0"
                >
                    <ArrowLeft className="h-5 w-5 mr-1" />
                    Salir
                </Button>
                
                <div className="text-center flex-1 min-w-0 mx-2">
                    <div className="font-bold text-sm truncate">{eventName || "Scanner"}</div>
                    <div className="text-xs text-gray-400">
                        Hoy: {scanCount.valid}/{scanCount.today} válidos
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {/* Network status */}
                    <div className={`p-1.5 rounded ${isOnline ? "text-green-400" : "text-red-400"}`}>
                        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    </div>
                    
                    {/* Reader mode */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleReaderMode}
                        aria-pressed={readerMode}
                        aria-label={readerMode ? "Desactivar modo lector" : "Activar modo lector"}
                        title={readerMode ? "Modo lector activo" : "Activar modo lector"}
                        className={
                            readerMode
                                ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 px-2"
                                : "text-white hover:bg-white/10 px-2"
                        }
                    >
                        <ScanLine className="h-4 w-4" />
                        <span className="hidden sm:inline ml-1.5 text-xs font-semibold">
                            {readerMode ? "Lector activo" : "Modo lector"}
                        </span>
                    </Button>

                    {/* Sound toggle */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className="text-white hover:bg-white/10 p-1.5"
                    >
                        {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                    </Button>

                    {/* History */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowHistory(!showHistory)}
                        className="text-white hover:bg-white/10 p-1.5 relative"
                    >
                        <History className="h-4 w-4" />
                        {scanHistory.length > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 bg-blue-500 text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                                {scanHistory.length > 99 ? "99+" : scanHistory.length}
                            </span>
                        )}
                    </Button>

                    {/* Vendidas por horario */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSales(true)}
                        className="text-white hover:bg-white/10 p-1.5"
                        aria-label="Vendidas por horario"
                    >
                        <BarChart3 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {availableShifts.length > 0 && (
                <div className="px-3 py-2 bg-gray-950 border-b border-gray-800 flex items-center gap-2">
                    <label htmlFor="scanner-shift" className="text-xs text-gray-400 whitespace-nowrap">
                        Turno actual
                    </label>
                    <select
                        id="scanner-shift"
                        value={currentShift}
                        onChange={(event) => setCurrentShift(event.target.value)}
                        className="h-8 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 text-sm text-white"
                        disabled={isProcessing}
                    >
                        <option value="">Seleccionar turno</option>
                        {availableShifts.map((shift) => (
                            <option key={shift} value={shift}>
                                {shift}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {readerMode && !readerInputFocused && !isProcessing && (
                <button
                    type="button"
                    onClick={focusCapture}
                    className="flex w-full items-center justify-center gap-2 border-b border-amber-700 bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 outline-none transition-colors hover:bg-amber-300 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                >
                    <ScanLine className="h-4 w-4 shrink-0" />
                    Lectura pausada. Haz clic aquí para reactivarla.
                </button>
            )}

            {/* History Panel */}
            {showHistory && (
                <div className="absolute inset-0 z-30 bg-gray-900 overflow-auto">
                    <div className="sticky top-0 bg-gray-900 p-4 border-b border-gray-800 flex items-center justify-between">
                        <h2 className="font-bold text-lg">Historial de hoy</h2>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowHistory(false)}
                            className="text-white hover:bg-white/10"
                        >
                            <ArrowLeft className="h-5 w-5 mr-1" />
                            Volver
                        </Button>
                    </div>
                    <div className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 180px)" }}>
                        {scanHistory.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No hay escaneos aún</p>
                        ) : (
                            scanHistory.map((item) => (
                                <div
                                    key={item.id}
                                    className={`p-3 rounded-lg border ${
                                        item.valid 
                                            ? "bg-green-900/30 border-green-700" 
                                            : "bg-red-900/30 border-red-700"
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-sm">{item.ticketCode}</span>
                                        <Badge variant={item.valid ? "default" : "destructive"}>
                                            {item.valid ? "Válido" : item.reason || "Inválido"}
                                        </Badge>
                                    </div>
                                    {item.attendeeName && (
                                        <p className="text-sm text-gray-300 mt-1">{item.attendeeName}</p>
                                    )}
                                    <p className="text-xs text-gray-500 mt-1">
                                        {new Intl.DateTimeFormat("es-PE", {
                                            timeStyle: "medium",
                                        }).format(new Date(item.timestamp))}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                    
                    {/* Bottom button to return to camera */}
                    <div className="p-4 border-t border-gray-800">
                        <Button
                            onClick={() => setShowHistory(false)}
                            className="w-full bg-blue-600 hover:bg-blue-700"
                        >
                            <Camera className="h-5 w-5 mr-2" />
                            Volver a Escanear
                        </Button>
                    </div>
                </div>
            )}

            {/* Sales-by-slot Panel */}
            {showSales && (
                <div className="absolute inset-0 z-30 bg-gray-900 overflow-auto">
                    <div className="sticky top-0 bg-gray-900 p-4 border-b border-gray-800 flex items-center justify-between">
                        <h2 className="font-bold text-lg">Vendidas por horario</h2>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSales(false)}
                            className="text-white hover:bg-white/10"
                        >
                            <ArrowLeft className="h-5 w-5 mr-1" />
                            Volver
                        </Button>
                    </div>
                    <div className="p-4 space-y-3" style={{ maxHeight: "calc(100vh - 72px)" }}>
                        <div className="flex items-center gap-2">
                            {salesData?.isPoolFree && (
                                <input
                                    type="date"
                                    value={salesDate}
                                    onChange={(e) => setSalesDate(e.target.value)}
                                    className="h-9 rounded-md border border-gray-700 bg-gray-800 px-2 text-sm text-white"
                                />
                            )}
                            <Button variant="secondary" size="sm" onClick={() => loadSales()} disabled={salesLoading}>
                                {salesLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                                <span className="ml-1">Actualizar</span>
                            </Button>
                        </div>

                        {salesData && (
                            <div className="text-sm text-gray-300">
                                Total vendidas: <span className="font-bold text-white">{salesData.totalSold}</span>
                                {salesData.totalCapacity > 0 && (
                                    <span className="text-gray-500"> / {salesData.totalCapacity} cupos</span>
                                )}
                                {salesData.isPoolFree && salesData.date && (
                                    <span className="text-gray-500"> · {salesData.date}</span>
                                )}
                            </div>
                        )}

                        {salesLoading && !salesData ? (
                            <p className="text-gray-500 text-center py-8">Cargando...</p>
                        ) : !salesData || salesData.slots.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">Sin horarios para mostrar.</p>
                        ) : (
                            <div className="space-y-2">
                                {salesData.slots.map((s) => {
                                    const pct = s.capacity > 0 ? Math.min((s.sold / s.capacity) * 100, 100) : 0
                                    const full = s.capacity > 0 && s.sold >= s.capacity
                                    return (
                                        <div key={s.ticketTypeId} className="rounded-lg border border-gray-700 bg-gray-800 p-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-medium">{s.name}</span>
                                                <span className={`font-bold ${full ? "text-red-400" : "text-green-400"}`}>
                                                    {s.sold}{s.capacity > 0 ? ` / ${s.capacity}` : ""}
                                                </span>
                                            </div>
                                            {s.capacity > 0 && (
                                                <div className="bg-gray-700 rounded-full h-2">
                                                    <div
                                                        className={`rounded-full h-2 ${full ? "bg-red-500" : "bg-green-500"}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Volver al escaner */}
                    <div className="p-4 border-t border-gray-800">
                        <Button
                            onClick={() => setShowSales(false)}
                            className="w-full bg-blue-600 hover:bg-blue-700"
                        >
                            <Camera className="h-5 w-5 mr-2" />
                            Volver a Escanear
                        </Button>
                    </div>
                </div>
            )}

            {/* Camera View */}
            <div className="flex-1 relative bg-black" style={{ minHeight: 0 }}>
                {/* Camera inactive state */}
                {!cameraActive && !scanResult && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        {readerMode ? (
                            <div className="max-w-md px-6 text-center">
                                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                                    {isProcessing ? (
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                    ) : (
                                        <ScanLine className="h-10 w-10" />
                                    )}
                                </div>
                                <h1 className="text-2xl font-bold text-white">
                                    {isProcessing
                                        ? "Validando ingreso"
                                        : readerInputReceiving
                                          ? "Recibiendo lectura…"
                                          : "Listo para leer"}
                                </h1>
                                <p aria-live="polite" className="mt-2 text-sm leading-6 text-gray-400">
                                    {isProcessing
                                        ? "Espera la señal antes de leer el siguiente ticket."
                                        : readerInputFocused
                                          ? "Apunta el Zebra al QR y presiona el gatillo."
                                          : "La captura perdió el foco. Reactívala en la banda amarilla."}
                                </p>
                                {!isProcessing && (
                                    <Button
                                        onClick={toggleReaderMode}
                                        variant="outline"
                                        className="mt-6 border-gray-700 bg-gray-900 text-white hover:bg-gray-800 hover:text-white"
                                    >
                                        <Camera className="h-5 w-5 mr-2" />
                                        Usar cámara
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="text-center p-6">
                                <Camera className="h-16 w-16 mx-auto text-gray-500 mb-4" />
                                <p className="text-gray-400 mb-6">La cámara está desactivada</p>
                                <Button
                                    onClick={startCamera}
                                    size="lg"
                                    className="bg-blue-600 hover:bg-blue-700"
                                >
                                    <Camera className="h-5 w-5 mr-2" />
                                    Activar Cámara
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {/* Scanner container */}
                <div 
                    id={scannerId} 
                    className="absolute inset-0"
                    style={{ 
                        display: cameraActive ? 'flex' : 'none',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                />

                {/* Scanning overlay */}
                {cameraActive && !scanResult && (
                    <>
                        {/* Scan frame overlay - fixed position */}
                        <div
                            className="absolute inset-0 pointer-events-none"
                            style={{ zIndex: 10 }}
                        >
                            <div
                                className="absolute"
                                style={{
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '80%',
                                    height: '50%',
                                    maxWidth: '360px',
                                    maxHeight: '360px',
                                }}
                            >
                                {/* Corner decorations */}
                                <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-green-400 rounded-tl-lg" />
                                <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-green-400 rounded-tr-lg" />
                                <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-green-400 rounded-bl-lg" />
                                <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-green-400 rounded-br-lg" />
                                
                                {/* Scanning line animation */}
                                {scanning && !isProcessing && (
                                    <div className="absolute inset-x-4 h-1 bg-green-400 rounded animate-scan" style={{ top: '50%' }} />
                                )}
                            </div>
                        </div>

                        {/* Processing indicator */}
                        {isProcessing && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center" style={{ zIndex: 20 }}>
                                <div className="bg-gray-900 rounded-xl p-6 flex flex-col items-center">
                                    <Loader2 className="h-10 w-10 animate-spin text-green-400" />
                                    <p className="mt-3 text-white font-medium">Validando...</p>
                                </div>
                            </div>
                        )}

                        {/* Instructions */}
                        <div 
                            className="absolute left-0 right-0 flex justify-center"
                            style={{ bottom: '80px', zIndex: 10 }}
                        >
                            <p className="text-white text-sm font-medium bg-black/70 px-4 py-2 rounded-full">
                                Apunta al QR
                            </p>
                        </div>

                        {/* Torch button */}
                        {torchSupported && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={toggleTorch}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white"
                                style={{ zIndex: 10 }}
                            >
                                {torchEnabled ? (
                                    <FlashlightOff className="h-5 w-5" />
                                ) : (
                                    <Flashlight className="h-5 w-5" />
                                )}
                            </Button>
                        )}
                    </>
                )}

                {/* Scan Result Modal */}
                {scanResult && (
                    <div className="absolute inset-0 bg-black/95 z-20 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
                        <Card className={`w-full max-w-sm border-0 shadow-2xl ${
                            scanResult.valid 
                                ? "bg-gradient-to-br from-green-600 to-green-700" 
                                : "bg-gradient-to-br from-red-600 to-red-700"
                        } text-white`}>
                            <CardContent className="pt-8 pb-6 text-center">
                                {/* Status icon */}
                                <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${
                                    scanResult.valid ? "bg-green-500/30" : "bg-red-500/30"
                                }`}>
                                    {scanResult.valid ? (
                                        <CheckCircle className="h-12 w-12" />
                                    ) : (
                                        <XCircle className="h-12 w-12" />
                                    )}
                                </div>

                                {/* Status text */}
                                <h2 className="text-3xl font-black mb-1">
                                    {scanResult.valid ? "✓ VÁLIDO" : "✗ INVÁLIDO"}
                                </h2>

                                <p className="text-white/90 text-base mb-4">
                                    {scanResult.message}
                                </p>

                                {/* Ticket details */}
                                {scanResult.ticket && (
                                    <div className="bg-white/15 backdrop-blur rounded-xl p-4 text-left space-y-3 mb-4">
                                        <div>
                                            <span className="text-white/60 text-xs uppercase tracking-wide">Asistente</span>
                                            <div className="font-bold text-lg">{scanResult.ticket.attendeeName}</div>
                                        </div>
                                        
                                        {scanResult.ticket.attendeeDni && (
                                            <div>
                                                <span className="text-white/60 text-xs uppercase tracking-wide">DNI</span>
                                                <div className="font-medium">{scanResult.ticket.attendeeDni}</div>
                                            </div>
                                        )}
                                        
                                        <div>
                                            <span className="text-white/60 text-xs uppercase tracking-wide">Tipo</span>
                                            <div className="font-medium">{scanResult.ticket.ticketTypeName}</div>
                                        </div>
                                        
                                        {scanResult.attendance && (
                                            <div className="pt-2 border-t border-white/20">
                                                <span className="text-white/60 text-xs uppercase tracking-wide">{scanResult.isMembership ? "Clases (este mes)" : "Asistencias"}</span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <div className="flex-1 bg-white/20 rounded-full h-2">
                                                        <div 
                                                            className="bg-white rounded-full h-2 transition-all"
                                                            style={{ 
                                                                width: `${Math.min((scanResult.attendance.used / scanResult.attendance.total) * 100, 100)}%` 
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="text-sm font-medium">
                                                        {scanResult.attendance.used}/{scanResult.attendance.total}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-white/70 mt-1">
                                                    {scanResult.attendance.remaining} restantes
                                                </p>
                                            </div>
                                        )}
                                        
                                        {formatScanTime(scanResult.scannedAt) && (
                                            <div className="pt-2 border-t border-white/20">
                                                <span className="text-white/60 text-xs uppercase tracking-wide">Hora</span>
                                                <div className="font-medium">{formatScanTime(scanResult.scannedAt)}</div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Forzar ingreso (emergencia) — piscina/membresía y rechazos de día/turno/horario */}
                                {!scanResult.valid &&
                                    (isPiscina || scanResult.isPiscina || scanResult.allowOverride) &&
                                    FORCEABLE_REASONS.has(scanResult.reason ?? "") && (
                                        <Button
                                            onClick={forceLastScan}
                                            disabled={isProcessing}
                                            className="w-full bg-amber-500 text-white hover:bg-amber-600 font-bold h-12 text-base shadow-lg mb-3"
                                        >
                                            {isProcessing ? (
                                                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                            ) : (
                                                <ShieldAlert className="h-5 w-5 mr-2" />
                                            )}
                                            Forzar ingreso (emergencia)
                                        </Button>
                                    )}

                                {/* Action button */}
                                {readerMode && scanResult.valid && (
                                    <p className="mb-3 text-sm font-medium text-white/80" aria-live="polite">
                                        Preparando la siguiente lectura…
                                    </p>
                                )}

                                <Button
                                    onClick={resetScan}
                                    className="w-full bg-white text-gray-900 hover:bg-white/90 font-bold h-12 text-lg shadow-lg"
                                >
                                    <RefreshCw className="h-5 w-5 mr-2" />
                                    Escanear siguiente
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Bottom controls */}
                {!scanResult && (
                    <div className="bg-gray-900 p-4 pb-6 border-t border-gray-800">
                        {/* Error message */}
                        {cameraError && (
                            <div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded-lg text-xs text-red-200">
                                {cameraError}
                                <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    onClick={restartCamera}
                                    className="ml-2 text-red-200 hover:text-white"
                                >
                                    Reintentar
                                </Button>
                            </div>
                        )}
                        
                        {/* Manual code input */}
                        <form onSubmit={handleManualSubmit} className="flex gap-2">
                            <Input
                                value={manualCode}
                                onChange={(event) => {
                                    const nextValue = event.target.value
                                    setManualCode(nextValue.trimStart().startsWith("{") ? nextValue : nextValue.toUpperCase())
                                }}
                                placeholder="Código manual..."
                                className="bg-gray-800 border-gray-700 text-white font-mono"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="characters"
                            />
                            <Button 
                                type="submit" 
                                variant="secondary"
                                disabled={!manualCode.trim() || isProcessing}
                                className="px-4"
                            >
                                {isProcessing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Search className="h-4 w-4" />
                                )}
                            </Button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    )
}
