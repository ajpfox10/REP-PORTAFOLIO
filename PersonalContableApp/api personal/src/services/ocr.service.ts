// src/services/ocr.service.ts
import { createWorker } from 'tesseract.js';
import fs from 'fs';
import { logger } from '../logging/logger';

let worker: any = null;
let workerInitializing: Promise<any> | null = null;

/**
 * Inicializa el worker de Tesseract.js (singleton lazy)
 */
async function getOcrWorker() {
  if (worker) return worker;
  
  if (!workerInitializing) {
    workerInitializing = (async () => {
      try {
        const { createWorker } = await import('tesseract.js');
        const w = await createWorker('spa'); // Español
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

    const w = await getOcrWorker();
    const { data } = await w.recognize(imagePath);
    
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