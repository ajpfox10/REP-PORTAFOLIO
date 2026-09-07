import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// El threadpool de libuv (fs.readFile, dns.lookup, zlib, crypto) es de 4 hilos por
// defecto. Bajo la carga del descubrimiento de red se satura y `fs.readFile` (que
// sirve los PDF escaneados en GET /v1/documents/files) queda encolado -> el download
// se cuelga y no se guarda en DOCU. Lo subimos acá, ANTES del primer uso del pool.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = "64";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// api/src -> api -> proyecto raíz scanner_v3
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});