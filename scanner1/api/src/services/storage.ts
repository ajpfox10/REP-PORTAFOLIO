// services/storage.ts — Local + S3/MinIO storage provider
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import { Readable } from "stream"

export type StoredObject = { key: string; url: string; size_bytes: number }

export interface StorageProvider {
  put(buffer: Buffer, ext: string, contentType: string, prefix?: string): Promise<StoredObject>
  get(key: string): Promise<Buffer>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

// ── Local filesystem ──────────────────────────────────────────────────────────
class LocalStorage implements StorageProvider {
  constructor(private dir: string) {}

  private fullPath(key: string) { return path.join(this.dir, key) }

  async put(buffer: Buffer, ext: string, _ct: string, prefix = ""): Promise<StoredObject> {
    const subdir = path.join(this.dir, prefix)
    await fs.mkdir(subdir, { recursive: true })
    const key = `${prefix ? prefix + "/" : ""}${crypto.randomUUID()}${ext}`
    await fs.writeFile(path.join(this.dir, key), buffer)
    return { key, url: `/v1/documents/files/${key}`, size_bytes: buffer.length }
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.fullPath(key))
  }

  async del(key: string): Promise<void> {
    await fs.unlink(this.fullPath(key)).catch(() => {})
  }

  async exists(key: string): Promise<boolean> {
    return fs.access(this.fullPath(key)).then(() => true).catch(() => false)
  }
}

// ── S3 / MinIO (stub — activar con AWS SDK) ───────────────────────────────────
class S3Storage implements StorageProvider {
  constructor(private bucket: string, private endpoint?: string) {}

  async put(_buf: Buffer, _ext: string, _ct: string): Promise<StoredObject> {
    throw new Error("S3Storage: install @aws-sdk/client-s3 and implement")
  }
  async get(_key: string): Promise<Buffer> { throw new Error("S3Storage: not implemented") }
  async del(_key: string): Promise<void>   { throw new Error("S3Storage: not implemented") }
  async exists(_key: string): Promise<boolean> { return false }
}

// ── Factory ───────────────────────────────────────────────────────────────────
let _instance: StorageProvider | null = null

export function storage(): StorageProvider {
  if (_instance) return _instance
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase()
  if (provider === "local") {
    _instance = new LocalStorage(process.env.STORAGE_LOCAL_DIR || "./storage")
  } else if (provider === "s3" || provider === "minio") {
    _instance = new S3Storage(
      process.env.STORAGE_S3_BUCKET || "scanner",
      process.env.STORAGE_S3_ENDPOINT
    )
  } else {
    throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`)
  }
  return _instance
}
