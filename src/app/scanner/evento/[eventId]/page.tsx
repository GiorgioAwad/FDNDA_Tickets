"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
    Loader2
} from "lucide-react"
import type { Html5Qrcode, Html5QrcodeCameraScanConfig } from "html5-qrcode"

// ==================== TYPES ====================

interface ScanResult {
    valid: boolean
    success?: boolean
    reason?: string
    message?: string
    scannedAt?: string
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
}

interface ScanHistoryItem {
    id: string
    timestamp: Date
    ticketCode: string
    attendeeName: string | null
    valid: boolean
    reason?: string
}

// ==================== CONSTANTS ====================

const SCAN_DEBOUNCE_MS = 300 // Ultra-fast response between scans
const MAX_HISTORY_ITEMS = 50
const STORAGE_KEY_HISTORY = "scan-history"
const STORAGE_KEY_SOUND = "scan-sound-enabled"

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
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const audioSuccessRef = useRef<HTMLAudioElement | null>(null)
    const audioErrorRef = useRef<HTMLAudioElement | null>(null)
    const wakeLockRef = useRef<WakeLockSentinel | null>(null)

    // State
    const [scanning, setScanning] = useState(false)
    const [cameraActive, setCameraActive] = useState(false)
    const [scanResult, setScanResult] = useState<ScanResult | null>(null)
    const [manualCode, setManualCode] = useState("")
    const [cameraError, setCameraError] = useState("")
    const [isOnline, setIsOnline] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)
    const [soundEnabled, setSoundEnabled] = useState(true)
    const [torchEnabled, setTorchEnabled] = useState(false)
    const [torchSupported, setTorchSupported] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([])
    const [eventName, setEventName] = useState<string>("")
    const [scanCount, setScanCount] = useState({ today: 0, valid: 0 })

    const scannerId = useMemo(() => `qr-reader-${eventId}`, [eventId])

    // ==================== EFFECTS ====================

    // Load settings and history from localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            const savedSound = localStorage.getItem(STORAGE_KEY_SOUND)
            if (savedSound !== null) {
                setSoundEnabled(savedSound === "true")
            }

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

            // Preload audio files
            audioRef.current = new Audio("/beep.mp3")
            audioSuccessRef.current = new Audio("/success.mp3")
            audioErrorRef.current = new Audio("/error.mp3")
            
            // Preload
            audioRef.current.load()
            audioSuccessRef.current?.load()
            audioErrorRef.current?.load()
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
                    const data = await response.json()
                    setEventName(data.title || "Evento")
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

    // Start camera on mount
    useEffect(() => {
        startCamera()
        
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
                // Also restart camera if it was stopped
                if (!scannerRef.current?.isScanning) {
                    startCamera()
                }
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
            let audio: HTMLAudioElement | null = null
            switch (type) {
                case "success":
                    audio = audioSuccessRef.current
                    break
                case "error":
                    audio = audioErrorRef.current
                    break
                default:
                    audio = audioRef.current
            }
            
            if (audio) {
                audio.currentTime = 0
                audio.play().catch(() => {})
            }
        } catch {
            // Ignore audio errors
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

            const { Html5Qrcode } = await import("html5-qrcode")
            
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
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true // Use native barcode detector for faster scanning
                }
            })

            // Ultra-optimized config for INSTANT scanning
            const config: Html5QrcodeCameraScanConfig = {
                fps: 30, // Balanced FPS - too high can cause lag
                qrbox: (viewfinderWidth, viewfinderHeight) => {
                    // Large scan area - 85% for good detection
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
                    const size = Math.floor(minEdge * 0.85)
                    return { width: size, height: size }
                },
                aspectRatio: 1.0,
                disableFlip: true, // Disable flip for faster processing
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
                    
                    if (scanLockedRef.current || isProcessing) {
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
    }, [scannerId, stopCamera, isProcessing])
    
    // Fallback camera start without exact constraint
    const startCameraFallback = useCallback(async () => {
        const { Html5Qrcode } = await import("html5-qrcode")
        
        if (!scannerRef.current) {
            scannerRef.current = new Html5Qrcode(scannerId, { verbose: false })
        }
        
        const config: Html5QrcodeCameraScanConfig = {
            fps: 30,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
                return { width: Math.floor(minEdge * 0.85), height: Math.floor(minEdge * 0.85) }
            },
            aspectRatio: 1.0,
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

    // ==================== SCAN HANDLERS ====================

    const handleScan = useCallback(async (qrData: string) => {
        // Prevent duplicate processing
        if (scanLockedRef.current || isProcessing) {
            return
        }
        
        lastScannedCodeRef.current = qrData
        setScanning(false)
        scanLockedRef.current = true
        setIsProcessing(true)

        // Immediate feedback
        playSound("beep")
        vibrate(50)

        try {
            const trimmed = qrData.trim()
            const isJsonPayload = trimmed.startsWith("{") && trimmed.endsWith("}")
            const endpoint = isJsonPayload ? "/api/scans/validate" : "/api/scans/lookup"
            const body = isJsonPayload
                ? { qrData: trimmed, eventId }
                : { ticketCode: trimmed, eventId }

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })

            const data = await response.json() as ScanResult
            setScanResult(data)
            addToHistory(data, trimmed)

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
                message: isOnline ? "Error de conexión" : "Sin conexión a internet",
            }
            setScanResult(errorResult)
            playSound("error")
            vibrate([300, 100, 300])
        } finally {
            setIsProcessing(false)
        }
    }, [eventId, isOnline, playSound, vibrate, addToHistory])

    const handleManualSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault()
        const ticketCode = manualCode.trim().toUpperCase()
        if (!ticketCode) return

        setScanning(false)
        lastScannedCodeRef.current = ticketCode
        scanLockedRef.current = true
        setIsProcessing(true)

        try {
            const response = await fetch("/api/scans/lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketCode, eventId }),
            })

            const data = await response.json() as ScanResult
            setScanResult(data)
            addToHistory(data, ticketCode)
            setManualCode("")

            if (data.valid) {
                playSound("success")
                vibrate([100, 50, 100])
            } else {
                playSound("error")
                vibrate([200, 100, 200])
            }
        } catch (err) {
            console.error("Manual lookup error:", err)
            setScanResult({
                valid: false,
                reason: "ERROR",
                message: "Error de conexión",
            })
            playSound("error")
        } finally {
            setIsProcessing(false)
        }
    }, [manualCode, eventId, playSound, vibrate, addToHistory])

    const resetScan = useCallback(() => {
        setScanResult(null)
        lastScannedCodeRef.current = null
        setScanning(true)
        scanLockedRef.current = false
        if (!cameraActive) {
            startCamera()
        }
    }, [cameraActive, startCamera])

    const restartCamera = useCallback(async () => {
        await stopCamera()
        // Small delay to ensure camera is released
        setTimeout(() => startCamera(), 100)
    }, [stopCamera, startCamera])

    // ==================== RENDER ====================

    return (
        <div className="min-h-screen bg-black text-white flex flex-col">
            {/* Header */}
            <div className="p-3 flex items-center justify-between bg-gray-900 border-b border-gray-800">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => router.push("/scanner")} 
                    className="text-white hover:bg-white/10"
                >
                    <ArrowLeft className="h-5 w-5 mr-1" />
                    Salir
                </Button>
                
                <div className="text-center flex-1 mx-2">
                    <div className="font-bold text-sm truncate">{eventName || "Scanner"}</div>
                    <div className="text-xs text-gray-400">
                        Hoy: {scanCount.valid}/{scanCount.today} válidos
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {/* Network status */}
                    <div className={`p-1.5 rounded ${isOnline ? "text-green-400" : "text-red-400"}`}>
                        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    </div>
                    
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
                </div>
            </div>

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

            {/* Camera View */}
            <div className="flex-1 relative bg-black" style={{ minHeight: 0 }}>
                {/* Camera inactive state */}
                {!cameraActive && !scanResult && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
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
                                className="absolute w-64 h-64"
                                style={{
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)'
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
                                Centra el QR en el recuadro
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
                                                <span className="text-white/60 text-xs uppercase tracking-wide">Asistencias</span>
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

                                {/* Action button */}
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
                                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                                placeholder="Código manual..."
                                className="bg-gray-800 border-gray-700 text-white uppercase font-mono"
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
