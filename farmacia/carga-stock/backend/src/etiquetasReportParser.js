const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const LINE_PATTERN = /^(\S+)\s+(.*?)\s+(-|[\d.,]+)\s+(-|[\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)$/;
const AMPOLLA_PATTERN = /AMPOLLA/i;
const COMPRIMIDO_PATTERN = /\bCOMPRIMIDOS?\b/gi;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanNombre(value) {
  return normalizeText(String(value ?? '').replace(COMPRIMIDO_PATTERN, ' '));
}

async function extractPdfText(buffer) {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false });
  const doc = await loadingTask.promise;
  let allText = '';
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    let lastY = null;
    let line = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        allText += `${line.trim()}\n`;
        line = '';
      }
      line += `${item.str} `;
      lastY = y;
    }
    if (line.trim()) allText += `${line.trim()}\n`;
  }
  return allText;
}

async function parseEtiquetasReport(filePath, { excludeAmpollas = true } = {}) {
  const buffer = fs.readFileSync(filePath);
  const text = await extractPdfText(buffer);
  const rawLines = text.split('\n').map((line) => normalizeText(line)).filter(Boolean);

  let hospital = '';
  let sector = '';
  const items = [];
  const seen = new Set();

  for (const line of rawLines) {
    if (!hospital && /^HOSPITAL/i.test(line)) {
      hospital = line;
      continue;
    }
    if (!sector && /^SECTOR:/i.test(line)) {
      sector = line.replace(/^SECTOR:\s*/i, '');
      continue;
    }
    const match = LINE_PATTERN.exec(line);
    if (!match) continue;
    const codigo = match[1];
    const nombre = cleanNombre(match[2]);
    if (!nombre || seen.has(codigo)) continue;
    if (excludeAmpollas && AMPOLLA_PATTERN.test(nombre)) continue;
    seen.add(codigo);
    items.push({ codigo, nombre });
  }

  return { hospital, sector, items };
}

module.exports = { parseEtiquetasReport };
