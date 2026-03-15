// worker/storage.ts — Acceso al storage desde el worker
import fs from "fs/promises";
import path from "path";
class LocalWorkerStorage {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async get(key) {
        return fs.readFile(path.join(this.dir, key));
    }
    async put(buffer, key) {
        const full = path.join(this.dir, key);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, buffer);
    }
}
let _instance = null;
export function storageWorker() {
    if (!_instance) {
        _instance = new LocalWorkerStorage(process.env.STORAGE_LOCAL_DIR || "./storage");
    }
    return _instance;
}
