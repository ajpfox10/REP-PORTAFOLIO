// services/storage.ts — Local + S3/MinIO storage provider
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
// ── Local filesystem ──────────────────────────────────────────────────────────
class LocalStorage {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    fullPath(key) { return path.join(this.dir, key); }
    async put(buffer, ext, _ct, prefix = "") {
        const subdir = path.join(this.dir, prefix);
        await fs.mkdir(subdir, { recursive: true });
        const key = `${prefix ? prefix + "/" : ""}${crypto.randomUUID()}${ext}`;
        await fs.writeFile(path.join(this.dir, key), buffer);
        return { key, url: `/v1/documents/files/${key}`, size_bytes: buffer.length };
    }
    async get(key) {
        return fs.readFile(this.fullPath(key));
    }
    async del(key) {
        await fs.unlink(this.fullPath(key)).catch(() => { });
    }
    async exists(key) {
        return fs.access(this.fullPath(key)).then(() => true).catch(() => false);
    }
}
// ── S3 / MinIO (stub — activar con AWS SDK) ───────────────────────────────────
class S3Storage {
    bucket;
    endpoint;
    constructor(bucket, endpoint) {
        this.bucket = bucket;
        this.endpoint = endpoint;
    }
    async put(_buf, _ext, _ct) {
        throw new Error("S3Storage: install @aws-sdk/client-s3 and implement");
    }
    async get(_key) { throw new Error("S3Storage: not implemented"); }
    async del(_key) { throw new Error("S3Storage: not implemented"); }
    async exists(_key) { return false; }
}
// ── Factory ───────────────────────────────────────────────────────────────────
let _instance = null;
export function storage() {
    if (_instance)
        return _instance;
    const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
    if (provider === "local") {
        _instance = new LocalStorage(process.env.STORAGE_LOCAL_DIR || "./storage");
    }
    else if (provider === "s3" || provider === "minio") {
        _instance = new S3Storage(process.env.STORAGE_S3_BUCKET || "scanner", process.env.STORAGE_S3_ENDPOINT);
    }
    else {
        throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`);
    }
    return _instance;
}
