'use strict';

const fs = require('fs/promises');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { createWorker, PSM } = require('tesseract.js');
const eng = require('@tesseract.js-data/eng');
const spa = require('@tesseract.js-data/spa');

const OCR_LANGS = ['spa', 'eng'];
const OCR_TESSDATA_DIR = path.resolve(__dirname, '../../../../.cache/tessdata');
const OCR_MIN_LENGTH = 80;

// Mutex para serializar llamadas OCR concurrentes y evitar saturar CPU.
// T-3: límite de cola para evitar acumulación ilimitada de trabajos en memoria.
const OCR_QUEUE_MAX = parseInt(process.env.OCR_QUEUE_MAX || '50', 10);
let _workerBusy = false;
const _workerQueue = [];

function acquireWorker() {
  return new Promise((resolve, reject) => {
    if (!_workerBusy) {
      _workerBusy = true;
      resolve();
    } else if (_workerQueue.length >= OCR_QUEUE_MAX) {
      reject(Object.assign(new Error('OCR queue llena — intente más tarde'), { http: 503 }));
    } else {
      _workerQueue.push(resolve);
    }
  });
}

function releaseWorker() {
  if (_workerQueue.length > 0) {
    const next = _workerQueue.shift();
    next();
  } else {
    _workerBusy = false;
  }
}

class NodeCanvasFactory {
  create(width, height) {
    if (!(width > 0 && height > 0)) {
      throw new Error('Invalid canvas size');
    }
    const canvas = createCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext('2d'),
    };
  }

  reset(target, width, height) {
    if (!target?.canvas) {
      throw new Error('Canvas target is required');
    }
    target.canvas.width = width;
    target.canvas.height = height;
  }

  destroy(target) {
    if (!target?.canvas) return;
    target.canvas.width = 0;
    target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

function compact(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasUsefulText(text) {
  const cleaned = compact(text);
  if (cleaned.length < OCR_MIN_LENGTH) return false;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount >= 12;
}

async function ensureLanguageData() {
  await fs.mkdir(OCR_TESSDATA_DIR, { recursive: true });

  const languages = [eng, spa];
  for (const lang of languages) {
    const source = path.join(lang.langPath, `${lang.code}.traineddata.gz`);
    const target = path.join(OCR_TESSDATA_DIR, `${lang.code}.traineddata.gz`);
    try {
      await fs.access(target);
    } catch {
      await fs.copyFile(source, target);
    }
  }

  return OCR_TESSDATA_DIR;
}

async function renderPdfPages(pdfBuffer, maxPages = 3) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableWorker: true,
    isEvalSupported: false,
  });

  const document = await loadingTask.promise;
  const canvasFactory = new NodeCanvasFactory();
  const pages = [];

  try {
    const totalPages = Math.min(document.numPages || 0, maxPages);
    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      const page = await document.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const target = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

      try {
        await page.render({
          canvasContext: target.context,
          viewport,
          canvasFactory,
        }).promise;

        pages.push({
          pageNumber: pageNum,
          image: target.canvas.toBuffer('image/png'),
        });
      } finally {
        page.cleanup();
        canvasFactory.destroy(target);
      }
    }
  } finally {
    await document.destroy();
    await loadingTask.destroy();
  }

  return pages;
}

async function extractTextWithOcr(pdfBuffer, options = {}) {
  await acquireWorker();
  const maxPages = Math.max(Number(options.maxPages) || 3, 1);
  let worker;
  try {
    const tessdataDir = await ensureLanguageData();
    worker = await createWorker(OCR_LANGS, 1, {
      langPath: tessdataDir,
      gzip: true,
    });

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    });

    const pages = await renderPdfPages(pdfBuffer, maxPages);
    const texts = [];

    for (const page of pages) {
      const result = await worker.recognize(page.image);
      const text = compact(result?.data?.text);
      if (text) {
        texts.push(`--- page ${page.pageNumber} ---\n${text}`);
      }
    }

    return {
      text: compact(texts.join('\n\n')),
      source: 'ocr',
      pagesProcessed: pages.length,
    };
  } catch (err) {
    throw err;
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* ignorar error de terminate */ }
    }
    releaseWorker();
  }
}

module.exports = {
  extractTextWithOcr,
  hasUsefulText,
};
