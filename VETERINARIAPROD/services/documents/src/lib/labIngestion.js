'use strict';

const pdfParse = require('pdf-parse');
const { extractTextWithOcr, hasUsefulText } = require('./pdfOcr');

const EXTERNAL_INTERPRETATION = 'Importado desde PDF externo';
const LAB_TEST_DEFINITIONS = [
  {
    canonical: 'Glucosa',
    type: 'numeric',
    aliases: ['Glucosa', 'Glucose', 'Glu', 'Glucemia', 'Glucosa en sangre'],
  },
  {
    canonical: 'Urea',
    type: 'numeric',
    aliases: ['Urea', 'BUN', 'Uremia'],
  },
  {
    canonical: 'Creatinina',
    type: 'numeric',
    aliases: ['Creatinina', 'Creatinine', 'Crea'],
  },
  {
    canonical: 'Hemograma completo',
    type: 'panel',
    signals: ['hemograma', 'hematocrito', 'hemoglobina', 'eritrocitos', 'leucocitos', 'plaquetas'],
    sectionKeywords: ['Hemograma', 'Hematocrito', 'Hemoglobina', 'Eritrocitos', 'Leucocitos', 'Plaquetas', 'VCM', 'HCM', 'CHCM'],
    minimumSignalCount: 3,
    fallbackText: 'Hemograma detectado en PDF externo',
    interpretation: 'Panel hematologico importado desde PDF externo',
  },
  {
    canonical: 'Análisis de orina',
    type: 'panel',
    signals: ['analisis de orina', 'uroanalisis', 'urinalisis', 'orina', 'densidad urinaria', 'sedimento'],
    sectionKeywords: ['Orina', 'Uroanalisis', 'Urinalisis', 'Densidad', 'pH', 'Proteinas', 'Glucosa', 'Cetonas', 'Sedimento', 'Leucocitos'],
    minimumSignalCount: 2,
    fallbackText: 'Uroanalisis detectado en PDF externo',
    interpretation: 'Resultado de orina importado desde PDF externo',
  },
  {
    canonical: 'Coproparasitario',
    type: 'panel',
    signals: ['coproparasitario', 'parasito', 'parasitos', 'quistes', 'huevos', 'materia fecal'],
    sectionKeywords: ['Coproparasitario', 'Parasitos', 'Huevos', 'Quistes', 'Trofozoitos', 'Materia fecal'],
    minimumSignalCount: 2,
    fallbackText: 'Coproparasitario detectado en PDF externo',
    interpretation: 'Resultado coproparasitario importado desde PDF externo',
  },
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compact(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ');
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(item.canonical);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findNumericAnalyte(text, labels = []) {
  for (const label of labels) {
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`(?:^|\\b)${escaped}\\b\\s*[:=-]?\\s*(\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z/%µ\\-\\d]*)`, 'im'),
      new RegExp(`(?:^|\\b)${escaped}\\b\\s*[\\r\\n]+\\s*(\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z/%µ\\-\\d]*)`, 'im'),
      new RegExp(`(?:^|\\b)${escaped}\\b[^\\n\\r\\d]{0,20}(\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z/%µ\\-\\d]*)`, 'im'),
    ];

    for (const regex of patterns) {
      const match = text.match(regex);
      if (match) {
        return {
          value: Number(String(match[1]).replace(',', '.')),
          unit: match[2] || null,
          raw: match[0],
        };
      }
    }
  }
  return null;
}

function extractSection(text, keywords = []) {
  const lines = compact(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const hits = lines.filter((line) => keywords.some((keyword) => normalize(line).includes(normalize(keyword))));
  return hits.slice(0, 25).join('\n') || null;
}

function detectNumericTests(text) {
  return LAB_TEST_DEFINITIONS
    .filter((definition) => definition.type === 'numeric')
    .map((definition) => {
      const result = findNumericAnalyte(text, definition.aliases);
      if (!result) return null;
      return {
        canonical: definition.canonical,
        numericValue: result.value,
        unit: result.unit,
        rawSnippet: result.raw,
        interpretation: EXTERNAL_INTERPRETATION,
      };
    })
    .filter(Boolean);
}

function detectPanelTests(text, normalized) {
  return LAB_TEST_DEFINITIONS
    .filter((definition) => definition.type === 'panel')
    .map((definition) => {
      const hitCount = definition.signals.filter((signal) => normalized.includes(signal)).length;
      if (hitCount < definition.minimumSignalCount) return null;

      return {
        canonical: definition.canonical,
        textValue: extractSection(text, definition.sectionKeywords) || definition.fallbackText,
        interpretation: definition.interpretation,
      };
    })
    .filter(Boolean);
}

function detectLabPayload(text) {
  const normalized = normalize(text);
  const extractedTests = dedupe([
    ...detectNumericTests(text),
    ...detectPanelTests(text, normalized),
  ]);

  return {
    summary: {
      extractedCount: extractedTests.length,
      source: 'pdf-text',
      matchedTests: extractedTests.map((item) => item.canonical),
    },
    extractedTests,
  };
}

async function getActiveLabTestsByName(conn) {
  const rows = await conn.query(
    `SELECT id, name, code
       FROM lab_tests
      WHERE is_active = 1`
  );

  const map = new Map();
  for (const row of rows) {
    map.set(normalize(row.name), row);
    if (row.code) map.set(normalize(row.code), row);
  }
  return map;
}

async function extractLabPayloadFromPdf(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  let text = compact(parsed.text);
  let extractionSource = 'pdf-text';

  if (!hasUsefulText(text)) {
    const ocrResult = await extractTextWithOcr(pdfBuffer);
    text = compact(ocrResult.text);
    extractionSource = ocrResult.source || 'ocr';
  }

  if (!hasUsefulText(text)) {
    throw new Error('The PDF does not contain extractable text or OCR-readable content');
  }

  const payload = detectLabPayload(text);
  if (!payload.extractedTests.length) {
    throw new Error('No supported laboratory analytes were detected in the PDF');
  }

  return { text, extractionSource, payload };
}

async function createLabOrderFromDocument({ conn, document, pdfBuffer, extraction, user }) {
  const prepared = extraction || await extractLabPayloadFromPdf(pdfBuffer);
  const { text, extractionSource, payload } = prepared;

  if (!user.branchId) {
    throw new Error('Current user branch is required to create lab orders');
  }
  if (!document.patient_id) {
    throw new Error('Document must be associated to a patient before ingestion');
  }

  const testsByName = await getActiveLabTestsByName(conn);
  const matchedTests = payload.extractedTests
    .map((item) => ({
      extracted: item,
      test: testsByName.get(normalize(item.canonical)) || null,
    }))
    .filter((entry) => entry.test);

  if (!matchedTests.length) {
    throw new Error('No active lab tests matched the extracted PDF content');
  }

  const [nextRow] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(order_number,4) AS UNSIGNED)),0)+1 AS nextNum
       FROM lab_orders
      WHERE branch_id = :bid FOR UPDATE`,
    { bid: user.branchId }
  );
  const orderNumber = `LAB${String(nextRow.nextNum || 1).padStart(6, '0')}`;

  const [orderResult] = await conn.query(
    `INSERT INTO lab_orders
       (branch_id, patient_id, medical_record_id, order_number, priority, clinical_notes, ordered_by, status)
     VALUES
       (:branchId, :patientId, :medicalRecordId, :orderNumber, 'routine', :clinicalNotes, :orderedBy, 'completed')`,
    {
      branchId: user.branchId,
      patientId: document.patient_id,
      medicalRecordId: null,
      orderNumber,
      clinicalNotes: `Importado desde documento externo: ${document.filename}`,
      orderedBy: user.userId,
    }
  );
  const orderId = orderResult.insertId;

  const createdItems = [];
  for (const entry of matchedTests) {
    const [itemResult] = await conn.query(
      `INSERT INTO lab_order_items (lab_order_id, lab_test_id, status, notes)
       VALUES (:orderId, :labTestId, 'completed', :notes)`,
      {
        orderId,
        labTestId: entry.test.id,
        notes: `Documento ${document.id}: ${document.filename}`,
      }
    );

    await conn.query(
      `INSERT INTO lab_results
         (lab_order_item_id, value_numeric, value_text, unit, reference_range_used, is_critical, interpretation, reported_by, reported_at)
       VALUES
         (:itemId, :valueNumeric, :valueText, :unit, NULL, 0, :interpretation, :reportedBy, NOW())`,
      {
        itemId: itemResult.insertId,
        valueNumeric: entry.extracted.numericValue ?? null,
        valueText: entry.extracted.textValue || entry.extracted.rawSnippet || null,
        unit: entry.extracted.unit || null,
        interpretation: entry.extracted.interpretation || EXTERNAL_INTERPRETATION,
        reportedBy: user.userId,
      }
    );

    createdItems.push({
      itemId: itemResult.insertId,
      testId: entry.test.id,
      testName: entry.test.name,
    });
  }

  return {
    orderId,
    orderNumber,
    extractedText: text,
    extractedSummary: {
      ...payload.summary,
      source: extractionSource,
    },
    createdItems,
  };
}

module.exports = {
  createLabOrderFromDocument,
  extractLabPayloadFromPdf,
  detectLabPayload,
};
