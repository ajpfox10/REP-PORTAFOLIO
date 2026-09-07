// src/services/ocr.service.ts
import { createWorker } from 'tesseract.js';
import fs from 'fs';
import { logger } from '../logging/logger';

let worker: any = null;
let workerInitializing: Promise<any> | null = null;

// tesseract.js acumula estado por cada recognize y, tras muchas lecturas seguidas,
// tira "RangeError: Too many properties to enumerate" (throw no atrapable en
// process.nextTick → crashea el proceso). Reciclamos el worker cada N lecturas.
let recognitionCount = 0;
const MAX_RECOGNITIONS_PER_WORKER = 40;

async function recycleWorkerIfNeeded() {
  if (recognitionCount >= MAX_RECOGNITIONS_PER_WORKER && worker) {
    try { await worker.terminate(); } catch { /* noop */ }
    worker = null;
    workerInitializing = null;
    recognitionCount = 0;
    logger.info({ msg: '[OCR] Worker reciclado (límite de lecturas)' });
  }
}

/**
 * Inicializa el worker de Tesseract.js (singleton lazy)
 */
async function getOcrWorker() {
  if (worker) return worker;
  
  if (!workerInitializing) {
    workerInitializing = (async () => {
      try {
        const { createWorker, OEM } = await import('tesseract.js');
        // errorHandler evita el `throw` sincrónico no atrapable de tesseract.js
        // cuando un recognize falla (p.ej. "Too many properties to enumerate"):
        // así el error se propaga como rechazo normal y no crashea el proceso.
        const w = await createWorker('spa', OEM.LSTM_ONLY, {
          errorHandler: (e: any) => logger.warn({ msg: '[OCR] recognize error (manejado)', error: String(e) }),
        });
        logger.info({ msg: '[OCR] Worker initialized' });
        return w;
      } catch (err) {
        logger.error({ msg: '[OCR] Failed to initialize worker', err });
        throw err;
      }
    })();
  }
  
  worker = await workerInitializing;
  return worker;
}

/**
 * Ejecuta OCR sobre una imagen y devuelve el texto extraído
 */
export async function extractTextFromImage(imagePath: string): Promise<string> {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error('Archivo no encontrado');
    }

    await recycleWorkerIfNeeded();
    const w = await getOcrWorker();
    // Pedir SOLO texto: el objeto por defecto (blocks/hocr/tsv) es enorme y en
    // documentos densos rompe el worker con "Too many properties to enumerate".
    const { data } = await w.recognize(imagePath, {}, { text: true, blocks: false, hocr: false, tsv: false });
    recognitionCount += 1;

    logger.info({
      msg: '[OCR] Text extracted',
      path: imagePath,
      length: data.text.length,
      confidence: data.confidence
    });
    
    return data.text || '';
  } catch (err: unknown) {
    // ✅ Manejo seguro de error tipo 'unknown'
    const errorMessage = err instanceof Error 
      ? err.message 
      : typeof err === 'string' 
        ? err 
        : 'Error desconocido en OCR';
    
    logger.error({
      msg: '[OCR] Extraction failed',
      path: imagePath,
      error: errorMessage
    });

    // El worker pudo quedar en mal estado tras el error: forzar recreación.
    try { if (worker) await worker.terminate(); } catch { /* noop */ }
    worker = null;
    workerInitializing = null;
    recognitionCount = 0;

    throw new Error(`Error al procesar OCR: ${errorMessage}`);
  }
}

/**
 * Libera recursos del worker (útil en graceful shutdown)
 */
export async function terminateOcrWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerInitializing = null;
    logger.info({ msg: '[OCR] Worker terminated' });
  }
}
// ── Worker "mono" (listados de terminal: ANSES, SIAPE) ────────────────────────
// El worker principal usa 'spa' + el modelo de lenguaje español, que en impresiones
// monoespaciadas de terminal confunde dígitos de forma sistemática (0 → 6: "01 09 1984"
// sale "61 69 1984"). Para esos listados se usa un worker aparte con 'eng', segmentación
// de bloque único y whitelist de caracteres: las fechas salen casi perfectas.
// Es un worker separado a propósito: cambiar el principal rompería el OCR de Trámites.
let monoWorker: any = null;
let monoWorkerInitializing: Promise<any> | null = null;
let monoRecognitionCount = 0;

async function getMonoOcrWorker() {
  if (monoWorker) return monoWorker;

  if (!monoWorkerInitializing) {
    monoWorkerInitializing = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const w = await createWorker('eng', OEM.LSTM_ONLY, {
        errorHandler: (e: any) => logger.warn({ msg: '[OCR/mono] recognize error (manejado)', error: String(e) }),
      });
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist:
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/!.:,-* ',
      });
      logger.info({ msg: '[OCR/mono] Worker initialized' });
      return w;
    })().catch((err) => {
      monoWorkerInitializing = null;
      logger.error({ msg: '[OCR/mono] Failed to initialize worker', err });
      throw err;
    });
  }

  monoWorker = await monoWorkerInitializing;
  return monoWorker;
}

/**
 * OCR pensado para listados impresos en monoespaciado (ANSES, SIAPE).
 * Devuelve el texto crudo, respetando en lo posible la disposición de columnas.
 */
export async function extractTextFromMonoImage(imagePath: string): Promise<string> {
  try {
    if (!fs.existsSync(imagePath)) throw new Error('Archivo no encontrado');

    if (monoRecognitionCount >= MAX_RECOGNITIONS_PER_WORKER && monoWorker) {
      try { await monoWorker.terminate(); } catch { /* noop */ }
      monoWorker = null;
      monoWorkerInitializing = null;
      monoRecognitionCount = 0;
      logger.info({ msg: '[OCR/mono] Worker reciclado (límite de lecturas)' });
    }

    const w = await getMonoOcrWorker();
    const { data } = await w.recognize(imagePath, {}, { text: true, blocks: false, hocr: false, tsv: false });
    monoRecognitionCount += 1;

    logger.info({ msg: '[OCR/mono] Text extracted', path: imagePath, length: data.text?.length ?? 0, confidence: data.confidence });
    return data.text || '';
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error desconocido en OCR';
    logger.error({ msg: '[OCR/mono] Extraction failed', path: imagePath, error: errorMessage });
    try { if (monoWorker) await monoWorker.terminate(); } catch { /* noop */ }
    monoWorker = null;
    monoWorkerInitializing = null;
    monoRecognitionCount = 0;
    throw new Error(`Error al procesar OCR: ${errorMessage}`);
  }
}

export async function terminateMonoOcrWorker() {
  if (monoWorker) {
    await monoWorker.terminate();
    monoWorker = null;
    monoWorkerInitializing = null;
    logger.info({ msg: '[OCR/mono] Worker terminated' });
  }
}
