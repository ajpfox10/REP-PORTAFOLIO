// src/files/fileScanner.ts
import net from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "../config/env";

const execFileAsync = promisify(execFile);

export type ScanResult = { clean: true } | { clean: false; reason: string; signature?: string };

export class VirusFoundError extends Error {
  status = 423;
  code = "virus_detected";
  signature?: string;
  constructor(message: string, signature?: string) {
    super(message);
    this.signature = signature;
  }
}

async function scanWithClamd(filePath: string): Promise<ScanResult> {
  // Protocolo INSTREAM de clamd
  // Enviamos el path por SCAN (más simple) o INSTREAM (más seguro para contenedores con volumen).
  // Para Docker en Windows, normalmente conviene SCAN si el contenedor ve el mismo path (volumen).
  // Si NO comparten FS, usar INSTREAM (requiere mandar bytes). Acá implemento SCAN por simplicidad.

  const host = env.DOCUMENTS_CLAMD_HOST;
  const port = env.DOCUMENTS_CLAMD_PORT;

  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.write(`SCAN ${filePath}\n`);
    });

    let data = "";
    sock.on("data", (chunk) => (data += chunk.toString("utf8")));
    sock.on("error", (e) => reject(e));
    sock.on("end", () => {
      // Respuesta típica:
      // /path: OK
      // /path: Eicar-Test-Signature FOUND
      const line = data.trim();
      if (!line) return resolve({ clean: true });

      if (line.includes("FOUND")) {
        const sig = line.split(":").pop()?.replace("FOUND", "").trim();
        return resolve({ clean: false, reason: "FOUND", signature: sig || undefined });
      }
      return resolve({ clean: true });
    });

    // timeout para no colgar request
    sock.setTimeout(env.DOCUMENTS_SCAN_TIMEOUT_MS, () => {
      sock.destroy(new Error("clamd timeout"));
    });
  });
}

async function scanWithCli(filePath: string): Promise<ScanResult> {
  // Ejecuta clamscan.exe (Windows) o clamscan (Linux)
  const bin = env.DOCUMENTS_CLAMSCAN_PATH;
  const args = ["--no-summary", filePath];

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: env.DOCUMENTS_SCAN_TIMEOUT_MS });
    const out = `${stdout || ""}\n${stderr || ""}`.trim();

    // Exit codes clamscan:
    // 0 = clean
    // 1 = infected
    // 2 = error
    // Output típico: "file: OK" o "file: Eicar-Test-Signature FOUND"
    if (out.includes("FOUND")) {
      const sig = out.split(":").pop()?.replace("FOUND", "").trim();
      return { clean: false, reason: "FOUND", signature: sig || undefined };
    }
    return { clean: true };
  } catch (e: any) {
    // Si el proceso devuelve exit code 1 (infected), cae acá en algunos sistemas
    const out = String(e?.stdout || "") + "\n" + String(e?.stderr || "");
    if (out.includes("FOUND")) {
      const sig = out.split(":").pop()?.replace("FOUND", "").trim();
      return { clean: false, reason: "FOUND", signature: sig || undefined };
    }
    // Si falla por timeout o bin inexistente: decisión de seguridad (bloquear o permitir)
    if (env.DOCUMENTS_SCAN_FAIL_CLOSED) {
      throw new Error(`Scan error (fail-closed): ${e?.message || e}`);
    }
    return { clean: true };
  }
}

export async function scanFileOrThrow(filePath: string): Promise<void> {
  if (!env.DOCUMENTS_SCAN_ENABLE) return;

  const mode = env.DOCUMENTS_SCAN_MODE;
  const res = mode === "cli" ? await scanWithCli(filePath) : await scanWithClamd(filePath);

  if (!res.clean) {
    throw new VirusFoundError("Archivo bloqueado por seguridad (malware detectado)", res.signature);
  }
}
