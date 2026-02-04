"use client"

import { useState, useRef, useCallback } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
    Upload, 
    X, 
    Image as ImageIcon, 
    Link as LinkIcon,
    Loader2,
    Info,
    CheckCircle,
    AlertCircle
} from "lucide-react"

// ==================== TYPES ====================

interface ImageUploaderProps {
    value: string
    onChange: (url: string) => void
    type?: "banner" | "logo" | "image"
    label?: string
    placeholder?: string
    showUrlInput?: boolean
    className?: string
}

interface UploadResponse {
    success: boolean
    url?: string
    error?: string
    dimensions?: {
        width: number
        height: number
        aspectRatio: string
    }
}

// ==================== CONSTANTS ====================

const BANNER_SPECS = {
    width: 1200,
    height: 630,
    aspectRatio: "1200 × 630 px",
    description: "Proporción 1.9:1 (similar a redes sociales)",
}

const MAX_FILE_SIZE_MB = 5

// ==================== COMPONENT ====================

export function ImageUploader({
    value,
    onChange,
    type = "banner",
    label = "Imagen",
    placeholder = "https://ejemplo.com/imagen.jpg",
    showUrlInput = true,
    className = "",
}: ImageUploaderProps) {
    const [isUploading, setIsUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploadSuccess, setUploadSuccess] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [showUrlMode, setShowUrlMode] = useState(false)
    const [previewError, setPreviewError] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileUpload = useCallback(async (file: File) => {
        setUploadError(null)
        setUploadSuccess(false)
        setPreviewError(false)

        // Validate file type
        const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
        if (!validTypes.includes(file.type)) {
            setUploadError("Tipo de archivo no válido. Usa JPG, PNG, WebP o GIF.")
            return
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            setUploadError(`El archivo es muy grande. Máximo: ${MAX_FILE_SIZE_MB}MB`)
            return
        }

        setIsUploading(true)

        try {
            const formData = new FormData()
            formData.append("file", file)
            formData.append("type", type)

            const response = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            })

            const data: UploadResponse = await response.json()

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Error al subir imagen")
            }

            onChange(data.url!)
            setUploadSuccess(true)
            setTimeout(() => setUploadSuccess(false), 3000)
        } catch (err) {
            setUploadError((err as Error).message)
        } finally {
            setIsUploading(false)
        }
    }, [type, onChange])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            handleFileUpload(file)
        }
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        const file = e.dataTransfer.files?.[0]
        if (file) {
            handleFileUpload(file)
        }
    }, [handleFileUpload])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const clearImage = () => {
        onChange("")
        setPreviewError(false)
        setUploadError(null)
        if (fileInputRef.current) {
            fileInputRef.current.value = ""
        }
    }

    const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPreviewError(false)
        onChange(e.target.value)
    }

    return (
        <div className={`space-y-3 ${className}`}>
            {/* Label */}
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{label}</label>
                {showUrlInput && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowUrlMode(!showUrlMode)}
                        className="text-xs h-7"
                    >
                        {showUrlMode ? (
                            <>
                                <Upload className="h-3 w-3 mr-1" />
                                Subir archivo
                            </>
                        ) : (
                            <>
                                <LinkIcon className="h-3 w-3 mr-1" />
                                Usar URL
                            </>
                        )}
                    </Button>
                )}
            </div>

            {/* Specs info */}
            {type === "banner" && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Tamaño recomendado: {BANNER_SPECS.aspectRatio}</p>
                        <p className="text-blue-600 mt-0.5">{BANNER_SPECS.description}</p>
                    </div>
                </div>
            )}

            {/* URL Input Mode */}
            {showUrlMode ? (
                <div className="space-y-2">
                    <Input
                        value={value}
                        onChange={handleUrlChange}
                        placeholder={placeholder}
                        className="font-mono text-sm"
                    />
                </div>
            ) : (
                /* Upload Drop Zone */
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`
                        relative border-2 border-dashed rounded-lg transition-all cursor-pointer
                        ${isDragging 
                            ? "border-blue-500 bg-blue-50" 
                            : "border-gray-300 hover:border-gray-400 bg-gray-50"
                        }
                        ${isUploading ? "pointer-events-none opacity-60" : ""}
                    `}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleFileChange}
                        className="hidden"
                    />

                    <div className="p-6 text-center">
                        {isUploading ? (
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                                <p className="text-sm text-gray-600">Subiendo imagen...</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <div className={`p-3 rounded-full ${isDragging ? "bg-blue-100" : "bg-gray-100"}`}>
                                    <Upload className={`h-6 w-6 ${isDragging ? "text-blue-600" : "text-gray-400"}`} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-700">
                                        {isDragging ? "Suelta la imagen aquí" : "Arrastra una imagen o haz clic"}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        JPG, PNG, WebP o GIF • Máx. {MAX_FILE_SIZE_MB}MB
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Error message */}
            {uploadError && (
                <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{uploadError}</span>
                </div>
            )}

            {/* Success message */}
            {uploadSuccess && (
                <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-600">
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    <span>Imagen subida correctamente</span>
                </div>
            )}

            {/* Preview */}
            {value && (
                <div className="relative">
                    <div className="relative rounded-lg overflow-hidden border bg-gray-100" 
                         style={{ aspectRatio: type === "banner" ? "1200/630" : "1/1" }}>
                        {previewError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                                <ImageIcon className="h-8 w-8 mb-2" />
                                <p className="text-xs">No se pudo cargar la imagen</p>
                                <p className="text-xs text-gray-500 mt-1 font-mono truncate max-w-full px-4">
                                    {value}
                                </p>
                            </div>
                        ) : (
                            <Image
                                src={value}
                                alt="Preview"
                                fill
                                sizes="(max-width: 768px) 100vw, 400px"
                                unoptimized
                                className="object-cover"
                                onError={() => setPreviewError(true)}
                            />
                        )}
                    </div>
                    
                    {/* Remove button */}
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={(e) => {
                            e.stopPropagation()
                            clearImage()
                        }}
                        className="absolute top-2 right-2 h-8 w-8 p-0 rounded-full shadow-lg"
                    >
                        <X className="h-4 w-4" />
                    </Button>

                    {/* Image URL display */}
                    <div className="mt-2 p-2 bg-gray-50 rounded border text-xs font-mono text-gray-600 truncate">
                        {value}
                    </div>
                </div>
            )}
        </div>
    )
}
