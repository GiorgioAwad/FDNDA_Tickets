import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

export type StorageProvider = "r2" | "blob" | "local"

export interface UploadAssetInput {
    key: string
    buffer: Buffer
    contentType: string
    size: number
}

export interface StoredAssetDescriptor {
    provider: StorageProvider
    key: string
    url: string
    contentType: string
    size: number
}

const R2_REGION = process.env.R2_REGION || "auto"
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads"

let r2Client: S3Client | null = null

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "")
}

function getAppBaseUrl(): string {
    return trimTrailingSlash(process.env.NEXT_PUBLIC_APP_URL || "")
}

function getExplicitStorageProvider(): StorageProvider | null {
    const raw = (process.env.STORAGE_PROVIDER || "").trim().toLowerCase()
    if (raw === "r2" || raw === "blob" || raw === "local") return raw
    return null
}

export function getStorageProvider(): StorageProvider {
    const explicit = getExplicitStorageProvider()
    if (explicit) return explicit
    if (process.env.BLOB_READ_WRITE_TOKEN) return "blob"
    return "local"
}

function getR2Endpoint(): string {
    const accountId = process.env.R2_ACCOUNT_ID
    if (!accountId) {
        throw new Error("R2_ACCOUNT_ID no configurado")
    }

    return `https://${accountId}.r2.cloudflarestorage.com`
}

function getR2Client(): S3Client {
    if (r2Client) return r2Client

    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

    if (!accessKeyId || !secretAccessKey) {
        throw new Error("Credenciales R2 incompletas")
    }

    r2Client = new S3Client({
        region: R2_REGION,
        endpoint: getR2Endpoint(),
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    })

    return r2Client
}

function getR2Bucket(): string {
    const bucket = process.env.R2_BUCKET
    if (!bucket) {
        throw new Error("R2_BUCKET no configurado")
    }
    return bucket
}

function getR2PublicBaseUrl(): string {
    const baseUrl = process.env.R2_PUBLIC_BASE_URL
    if (!baseUrl) {
        throw new Error("R2_PUBLIC_BASE_URL no configurado")
    }
    return trimTrailingSlash(baseUrl)
}

function buildLocalPublicUrl(key: string): string {
    const relativePath = `/uploads/${key}`
    const appBaseUrl = getAppBaseUrl()
    return appBaseUrl ? `${appBaseUrl}${relativePath}` : relativePath
}

function ensureUploadDir(filePath: string): Promise<void> {
    return fs.mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined)
}

export function buildStoredAssetKey(
    kind: string | null | undefined,
    originalName: string
): string {
    const ext = originalName.split(".").pop()?.toLowerCase() || "bin"
    const folder = (kind || "images").replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "") || "images"
    return `${folder}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`
}

export async function uploadAsset(input: UploadAssetInput): Promise<StoredAssetDescriptor> {
    const provider = getStorageProvider()

    if (provider === "r2") {
        const client = getR2Client()
        const bucket = getR2Bucket()

        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            Body: input.buffer,
            ContentType: input.contentType,
        }))

        return {
            provider,
            key: input.key,
            url: `${getR2PublicBaseUrl()}/${input.key}`,
            contentType: input.contentType,
            size: input.size,
        }
    }

    if (provider === "blob") {
        const { put } = await import("@vercel/blob")
        const blob = await put(input.key, input.buffer, {
            access: "public",
            addRandomSuffix: false,
            contentType: input.contentType,
        })

        return {
            provider,
            key: blob.pathname,
            url: blob.url,
            contentType: input.contentType,
            size: input.size,
        }
    }

    const filePath = path.join(UPLOAD_DIR, input.key)
    await ensureUploadDir(filePath)
    await fs.writeFile(filePath, input.buffer)

    return {
        provider,
        key: input.key,
        url: buildLocalPublicUrl(input.key),
        contentType: input.contentType,
        size: input.size,
    }
}

function inferProviderFromUrl(url: string): StorageProvider {
    const r2Base = process.env.R2_PUBLIC_BASE_URL
    if (r2Base && trimTrailingSlash(url).startsWith(trimTrailingSlash(r2Base))) {
        return "r2"
    }

    if (url.includes("blob.vercel-storage.com")) {
        return "blob"
    }

    return "local"
}

function inferLocalKeyFromUrl(url: string): string {
    if (url.startsWith("/uploads/")) {
        return url.replace(/^\/uploads\//, "")
    }

    const parsed = new URL(url, "http://localhost")
    return parsed.pathname.replace(/^\/uploads\//, "")
}

function inferR2KeyFromUrl(url: string): string {
    const base = getR2PublicBaseUrl()
    return url.replace(`${base}/`, "")
}

export async function deleteAsset(input: {
    provider?: StorageProvider
    key?: string
    url: string
}): Promise<void> {
    const provider = input.provider || inferProviderFromUrl(input.url)

    if (provider === "r2") {
        const key = input.key || inferR2KeyFromUrl(input.url)
        await getR2Client().send(new DeleteObjectCommand({
            Bucket: getR2Bucket(),
            Key: key,
        }))
        return
    }

    if (provider === "blob") {
        const { del } = await import("@vercel/blob")
        await del(input.url)
        return
    }

    const key = input.key || inferLocalKeyFromUrl(input.url)
    const filePath = path.join(UPLOAD_DIR, key)
    await fs.unlink(filePath).catch(() => {})
}
