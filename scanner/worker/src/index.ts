// worker/index.ts — sin Redis
// El API procesa jobs inline (ver api/src/services/queue.ts).
// Este worker queda como stub — instalar Redis 5+ para activar procesamiento async.
import "dotenv/config"

console.log("[worker] Sin Redis configurado.")
console.log("[worker] El API procesa OCR/AI inline al recibir el upload del agente.")
console.log("[worker] Para activar procesamiento async, instalar Redis 5+ y")
console.log("[worker] reemplazar api/src/services/queue.ts con la versión BullMQ.")
