// worker/storage.ts — Acceso al storage desde el worker
import fs from "fs/promises"
import path from "path"

interface WorkerStorage {
  get(key: string): Promise<Buffer>
  put(buffer: Buffer, key: string): Promise<void>
}

class LocalWorkerStorage implements WorkerStorage {
  constructor(private dir: string) {}
  async get(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.dir, key))
  }
  async put(buffer: Buffer, key: string): Promise<void> {
    const full = path.join(this.dir, key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, buffer)
  }
}

let _instance: WorkerStorage | null = null
export function storageWorker(): WorkerStorage {
  if (!_instance) {
    _instance = new LocalWorkerStorage(process.env.STORAGE_LOCAL_DIR || "./storage")
  }
  return _instance
}
