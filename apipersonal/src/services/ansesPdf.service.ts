/**
 * @file services/ansesPdf.service.ts
 * Lectura del listado de servicios de ANSES (consulta de historia laboral / PBU-PC-PAP)
 * para volcarlo en la calculadora de jubilación.
 *
 * El papel que trae el agente es una impresión de terminal en monoespaciado, escaneada:
 *
 *   Tram:    004            PBU/PC/PAP              CUIL 20 - 20249337 - 9
 *   Ape Nom: PICCA ALEJANDRO HORAC FNac: 12 04 1968 Sexo: M ...
 *     B. Serv. E.L. Empresa ! F.Desde  -  F.Hasta   Hs.Ds ! Tiempo !RC C  Ac
 *     NB  009 65/30 CARDINA ! 01 09 1984  30 11 1984      !    3   ! R 11  *
 *
 * De cada renglón sólo interesan F.Desde y F.Hasta: el período lo recalcula la
 * calculadora. Las columnas de "Tiempo" salen sucias del OCR y se ignoran.
 *
 * El servicio NO escribe nada: devuelve las líneas detectadas para que el operador
 * las revise y confirme en pantalla antes de cargarlas.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../logging/logger';
import { extractTextFromMonoImage } from './ocr.service';

// `import()` real (evita que TS lo compile a require en CJS): pdfjs-dist es ESM puro.
const dynamicImport: (specifier: string) => Promise<any> = new Function('s', 'return import(s)') as any;

export type LineaANSES = {
  orden:            number;
  codigo_servicio:  string | null;   // 009 / 103 / 286 / 102 ...
  el:               string | null;   // 65/30, 55/30
  empresa:          string | null;   // truncada a 7 caracteres por el propio listado
  tipo:             'DEPENDENCIA' | 'AUTONOMO';
  fecha_desde:      string | null;   // YYYY-MM-DD
  fecha_hasta:      string | null;   // YYYY-MM-DD
  sugerida:         boolean;         // viene tildada en la pantalla de revisión
  // Tiempo que el propio documento computó para el renglón (columnas A/M/D de la
  // resolución). La pantalla lo compara con el que sale de Desde/Hasta.
  tiempo_documento: { anios: number; meses: number; dias: number } | null;
  // Por qué el renglón no computa tiempo (monotributo sin aportes, Ley 25.321, Ap. "no"...).
  // Ese 0 es un dato del documento, no un error de lectura: no se corrige con las fechas.
  causa_sin_computo: string | null;
  motivos:          string[];        // por qué hay que mirarla
  crudo:            string;
};

export type ParseANSESResult = {
  cuil:             string | null;
  dni:              number | null;
  nombre:           string | null;
  fecha_nacimiento: string | null;   // YYYY-MM-DD
  lineas:           LineaANSES[];
  descartadas:      number;
  advertencias:     string[];
  origen:           'texto' | 'ocr';
  texto:            string;
};

const ANIO_MIN = 1930;

// ── PDF → texto ───────────────────────────────────────────────────────────────
// Se rasteriza acá en vez de reusar los helpers de tramitesDocumentales.routes.ts
// (que no están exportados) para no tocar el OCR de Trámites, que ya está en producción.

async function loadPdfJs() {
  const pdfjsFile = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  return dynamicImport(pathToFileURL(pdfjsFile).href);
}

// pdfjs libera sus canvas con `canvas.width = 0`, que con @napi-rs/canvas tira
// "Failed to unwrap exclusive reference of CanvasElement". Este factory libera sin ese seteo.
function makeSafeCanvasFactory() {
  const { createCanvas } = require('@napi-rs/canvas');
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width) || 1, Math.ceil(height) || 1);
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(cc: any, width: number, height: number) {
      cc.canvas.width = Math.ceil(width) || 1;
      cc.canvas.height = Math.ceil(height) || 1;
    },
    destroy(cc: any) { cc.canvas = null; cc.context = null; },
  };
}

async function safeDestroyPdf(pdf: any) {
  try { await pdf?.destroy?.(); } catch { /* el teardown del canvas nativo a veces tira */ }
}

// Ancho objetivo del render: el listado es texto chico; con ~2000 px de ancho el OCR
// lee bien sin gastar memoria de más en escaneos que ya vienen en alta resolución.
const ANCHO_OBJETIVO_PX = 2000;
// Por debajo de esto la hoja no da para OCR. No importa si es foto o escaneo: importa el
// ancho en píxeles. Una foto derecha de 1706 px se lee bien; la misma hoja pasada por
// WhatsApp queda en 900 px y ahí los dígitos miden ~8 px, insuficiente para tesseract.
const ANCHO_MINIMO_UTIL_PX = 1400;

/**
 * Ancho en píxeles de la imagen escaneada más grande del PDF, leyendo los diccionarios
 * de imagen del archivo. Es "mejor esfuerzo" (devuelve 0 si el PDF los trae comprimidos):
 * sólo se usa para no rasterizar por encima de la resolución real y para avisar cuando
 * el PDF es una foto de baja resolución.
 */
function anchoImagenEscaneada(pdfPath: string): number {
  try {
    const crudo = fs.readFileSync(pdfPath).toString('latin1');
    let mayor = 0;
    const re = /\/Subtype\s*\/Image/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(crudo)) !== null) {
      const dict = crudo.slice(Math.max(0, m.index - 300), m.index + 300);
      const w = Number(dict.match(/\/Width\s+(\d+)/)?.[1] ?? 0);
      if (w > mayor) mayor = w;
    }
    return mayor;
  } catch {
    return 0;
  }
}

async function renderPageToJpg(pdf: any, pageNo: number, tempDir: string, anchoObjetivo = ANCHO_OBJETIVO_PX, formato: 'jpeg' | 'png' = 'jpeg'): Promise<string> {
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
  (globalThis as any).DOMMatrix  = (globalThis as any).DOMMatrix  ?? DOMMatrix;
  (globalThis as any).Path2D     = (globalThis as any).Path2D     ?? Path2D;
  (globalThis as any).ImageData  = (globalThis as any).ImageData  ?? ImageData;

  const page  = await pdf.getPage(pageNo);
  const base  = page.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1, anchoObjetivo / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();

  // PNG para la lectura por grilla: el JPEG ensucia los bordes de las líneas de la tabla.
  const out = path.join(tempDir, `anses_${String(pageNo).padStart(3, '0')}.${formato === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(out, formato === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg', 92));
  return out;
}

type TextoPdf = { texto: string; origen: 'texto' | 'ocr'; avisos: string[]; tabla: LineaANSES[] };

/** Texto del PDF: primero la capa de texto; si el PDF es un escaneo, OCR página por página. */
async function pdfATexto(pdfPath: string, maxPages: number): Promise<TextoPdf> {
  const pdfjs = await loadPdfJs();
  const data  = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf   = await pdfjs.getDocument({ data, disableWorker: true, canvasFactory: makeSafeCanvasFactory() }).promise;
  const paginas = Math.min(pdf.numPages, maxPages);

  try {
    // 1) Capa de texto (PDF generado digitalmente).
    const conTexto: string[] = [];
    for (let p = 1; p <= paginas; p += 1) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Reconstruir renglones por coordenada Y: el listado es tabular y sin esto
      // se mezclan las columnas de todas las filas en una sola línea.
      const filas = new Map<number, { x: number; s: string }[]>();
      for (const item of (content.items || []) as any[]) {
        const s = String(item?.str ?? '');
        if (!s.trim()) continue;
        const y = Math.round(item?.transform?.[5] ?? 0);
        const x = Number(item?.transform?.[4] ?? 0);
        const key = Math.round(y / 3) * 3;   // tolerancia de 3pt entre trozos del mismo renglón
        if (!filas.has(key)) filas.set(key, []);
        filas.get(key)!.push({ x, s });
      }
      const lineas = [...filas.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, trozos]) => trozos.sort((a, b) => a.x - b.x).map(t => t.s).join(' ').trim())
        .filter(Boolean);
      if (lineas.length) conTexto.push(lineas.join('\n'));
      page.cleanup();
    }

    const texto = conTexto.join('\n');
    if (contarFechas(texto) >= 2) return { texto, origen: 'texto', avisos: [], tabla: [] };

    // 2) Escaneo: rasterizar + OCR monoespaciado.
    const avisos: string[] = [];
    const anchoNativo = anchoImagenEscaneada(pdfPath);
    if (anchoNativo && anchoNativo < ANCHO_MINIMO_UTIL_PX) {
      avisos.push(
        `La imagen del PDF es chica (${anchoNativo} px de ancho): a esa resolución las fechas no se ` +
        'pueden leer. Una foto sirve, pero tiene que tener al menos 1600 px de ancho — si pasó por ' +
        'WhatsApp queda reducida a 900. Pasá el archivo original (cable, mail o escáner).',
      );
    }
    // Rasterizar por encima de la resolución real del escaneo no agrega información.
    const anchoObjetivo = anchoNativo ? Math.min(ANCHO_OBJETIVO_PX, Math.round(anchoNativo * 1.3)) : ANCHO_OBJETIVO_PX;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anses-ocr-'));
    try {
      const partes: string[] = [];
      const tabla: LineaANSES[] = [];
      for (let p = 1; p <= paginas; p += 1) {
        try {
          const img = await renderPageToJpg(pdf, p, tempDir, anchoObjetivo, 'png');
          // La página entera sigue haciendo falta para el encabezado (nombre, DU) y para
          // el listado de terminal, que no tiene grilla.
          const t = await extractTextFromMonoImage(img);
          if (t?.trim()) partes.push(t);
          const filas = await leerTablaConGrilla(img);
          if (filas) tabla.push(...filas.lineas);
          if (filas?.advertencias.length) avisos.push(...filas.advertencias);
        } catch (err: any) {
          logger.warn({ msg: '[anses-pdf] OCR de pagina fallo', page: p, error: err?.message });
        }
      }
      return { texto: partes.join('\n'), origen: 'ocr', avisos, tabla };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } finally {
    await safeDestroyPdf(pdf);
  }
}

// ── Parser del listado ────────────────────────────────────────────────────────

// Los dos formatos que emite ANSES: el listado de terminal ("01 09 1984") y la tabla
// de la resolución de reconocimiento de servicios ("01/09/1998").
const RE_FECHA_SRC       = String.raw`(\d{1,2})\s+(\d{1,2})\s+((?:19|20)\d{2})`;
const RE_FECHA_BARRA_SRC = String.raw`(\d{1,2})[\/.-](\d{1,2})[\/.-]((?:19|20)\d{2})`;
// Algunas resoluciones informan sólo mes y año ("09/1998"). El año de 4 dígitos evita
// confundirlo con números de norma ("366/09", "2741/91").
const RE_MES_ANIO_SRC    = String.raw`(\d{1,2})[\/.-]((?:19|20)\d{2})`;

function contarFechas(texto: string): number {
  return (texto.match(new RegExp(RE_FECHA_SRC, 'g')) || []).length
       + (texto.match(new RegExp(RE_FECHA_BARRA_SRC, 'g')) || []).length;
}

/**
 * El OCR de listados monoespaciados falla casi siempre en el primer dígito de día/mes
 * (0 leído como 8/6/9). Si el número no puede ser un día/mes, se prueba con otra decena:
 * "81" → "01". Devuelve null si no hay corrección posible.
 */
function corregirDosDigitos(valor: number, max: number): { valor: number; corregido: boolean } | null {
  if (valor >= 1 && valor <= max) return { valor, corregido: false };
  const unidad = valor % 10;
  for (const decena of [0, 1, 2, 3]) {
    const cand = decena * 10 + unidad;
    if (cand >= 1 && cand <= max) return { valor: cand, corregido: true };
  }
  return null;
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Arma la fecha ISO. `f.sinDia` (el documento informó sólo mes y año) resuelve el día
 * según sea alta o baja, y deja constancia para que el operador lo confirme.
 */
function armarFechaDetectada(f: FechaDetectada, motivos: string[], etiqueta: 'Desde' | 'Hasta'): string | null {
  if (!f.sinDia) return armarFecha(f.d, f.m, f.a, motivos, etiqueta);

  const anio = Number(f.a);
  const mes = corregirDosDigitos(Number(f.m), 12);
  if (!mes || !(anio >= ANIO_MIN && anio <= new Date().getFullYear() + 1)) {
    motivos.push(`${etiqueta}: no se pudo interpretar "${f.m}/${f.a}"`);
    return null;
  }
  const dia = etiqueta === 'Desde' ? 1 : ultimoDiaDelMes(anio, mes.valor);
  motivos.push(`${etiqueta}: el documento sólo indica mes y año, se asumió el día ${dia}`);
  return `${anio}-${String(mes.valor).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function armarFecha(d: string, m: string, a: string, motivos: string[], etiqueta: string): string | null {
  const anio = Number(a);
  const anioMax = new Date().getFullYear() + 1;
  if (!(anio >= ANIO_MIN && anio <= anioMax)) {
    motivos.push(`${etiqueta}: año ${a} fuera de rango`);
    return null;
  }

  const mes = corregirDosDigitos(Number(m), 12);
  const dia = corregirDosDigitos(Number(d), 31);
  if (!mes || !dia) {
    motivos.push(`${etiqueta}: no se pudo interpretar "${d} ${m} ${a}"`);
    return null;
  }
  if (mes.corregido) motivos.push(`${etiqueta}: mes corregido por OCR (${m} → ${String(mes.valor).padStart(2, '0')})`);
  if (dia.corregido) motivos.push(`${etiqueta}: día corregido por OCR (${d} → ${String(dia.valor).padStart(2, '0')})`);

  const iso = `${anio}-${String(mes.valor).padStart(2, '0')}-${String(dia.valor).padStart(2, '0')}`;
  // Rebote de días inexistentes (31 de abril, 30 de febrero).
  const chk = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(chk.getTime()) || chk.getUTCDate() !== dia.valor) {
    motivos.push(`${etiqueta}: la fecha ${iso} no existe`);
    return null;
  }
  return iso;
}

// El OCR pega letras a los números ("01 12 2006" leído como "O11 12 2006"). Se normalizan
// las confusiones típicas token por token y, si aun así el número no queda limpio, la fecha
// se marca dudosa: la fila llega destildada a la pantalla de revisión en vez de entrar mal.
const MAPA_OCR: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  l: '1', I: '1', i: '1', '|': '1',
  S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', b: '6',
};

function normalizarToken(t: string, conSeparadores = false): string {
  const limpio = conSeparadores
    ? t.replace(/[^0-9A-Za-z|\/.-]/g, '')
    : t.replace(/[^0-9A-Za-z|]/g, '');
  return limpio.replace(/[A-Za-z|]/g, (c) => MAPA_OCR[c] ?? c);
}

type FechaDetectada = {
  d: string; m: string; a: string;
  dudosa: boolean;
  sinDia: boolean;       // el documento informó sólo mes y año
  tokenInicio: number;   // primer token de la fecha
  tokenFin: number;      // último token de la fecha (inclusive)
};

const sucio = (raw: string, norm: string, conSeparadores = false) =>
  (conSeparadores ? raw.replace(/[^0-9A-Za-z|\/.-]/g, '') : raw.replace(/[^0-9A-Za-z|]/g, '')) !== norm;

/**
 * Busca fechas sobre los tokens del renglón, en los dos formatos de ANSES:
 * "01/09/1998" (tabla de la resolución) y "01 09 1984" (listado de terminal).
 * Devuelve como mucho las dos primeras (Desde y Hasta): lo que sigue son las columnas
 * de tiempo computado, que no se usan.
 */
function extraerFechas(tokens: string[], max = 2): FechaDetectada[] {
  const out: FechaDetectada[] = [];
  const reBarra   = new RegExp(`^${RE_FECHA_BARRA_SRC}$`);
  const reMesAnio = new RegExp(`^${RE_MES_ANIO_SRC}$`);

  for (let i = 0; i < tokens.length && out.length < max; i += 1) {
    // Formato con barras: la fecha entera es un solo token.
    const conBarras = normalizarToken(tokens[i], true);
    const mb = conBarras.match(reBarra);
    if (mb) {
      out.push({
        d: mb[1], m: mb[2], a: mb[3],
        dudosa: sucio(tokens[i], conBarras, true),
        sinDia: false,
        tokenInicio: i, tokenFin: i,
      });
      continue;
    }

    // Sólo mes y año: el día lo pone el parser (1 para el alta, fin de mes para la baja).
    const mma = conBarras.match(reMesAnio);
    if (mma) {
      out.push({
        d: '', m: mma[1], a: mma[2],
        dudosa: sucio(tokens[i], conBarras, true),
        sinDia: true,
        tokenInicio: i, tokenFin: i,
      });
      continue;
    }

    // Formato del listado: día, mes y año como tokens separados, anclando en el año.
    if (i < 2) continue;
    const a = normalizarToken(tokens[i]);
    if (!/^(19|20)\d{2}$/.test(a)) continue;

    const dRaw = normalizarToken(tokens[i - 2]);
    const mRaw = normalizarToken(tokens[i - 1]);
    if (!/^\d{1,3}$/.test(dRaw) || !/^\d{1,3}$/.test(mRaw)) continue;

    // Dudosa si al número le sobran dígitos o si hubo que reinterpretar letras como números.
    const dudosa =
      dRaw.length > 2 || mRaw.length > 2 ||
      sucio(tokens[i - 2], dRaw) || sucio(tokens[i - 1], mRaw) || sucio(tokens[i], a);

    out.push({ d: dRaw.slice(-2), m: mRaw.slice(-2), a, dudosa, sinDia: false, tokenInicio: i - 2, tokenFin: i });
  }
  return out;
}

// Cada resolución arma la tabla a su manera, pero después del empleador siempre vienen
// columnas de cierre: el carácter de las tareas y el tiempo computado (A M D, o "3 9 0",
// o porcentajes). Se recortan por forma, no por posición fija.
const RUIDO_COLA = /^(comun(es)?|fehaciente|insalubre|diferencial|simult[aá]neo|total|si|no|s|n|-{1,3}|\d{1,4}([.,]\d{1,2})?%?)\.?$/i;

function quitarColumnasDeCola(cols: string[]): string[] {
  const out = [...cols];
  while (out.length && RUIDO_COLA.test(out[out.length - 1])) out.pop();
  return out;
}

function limpiarEmpresa(txt: string): string | null {
  const s = txt
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.slice(0, 60) : null;
}

/** Parsea el texto (de la capa de texto o del OCR) del listado de ANSES. */
export function parsearTextoANSES(texto: string): Omit<ParseANSESResult, 'origen' | 'texto'> {
  const advertencias: string[] = [];
  const plano = texto.replace(/\r/g, '');

  // Encabezado. Es sólo informativo: los servicios se cargan siempre al agente que
  // el operador tiene abierto, así que no leer el CUIL no es un problema.
  const mCuil = plano.match(/CUIL\s*[:\s]\s*(\d{2})\s*-\s*(\d{6,8})\s*-\s*(\d)/i);
  const cuil = mCuil ? `${mCuil[1]}-${mCuil[2]}-${mCuil[3]}` : null;
  // La resolución de reconocimiento no trae CUIL pero sí el documento ("DU 21736968").
  // El número puede venir con puntos ("DU 13.140.314").
  const mDoc = plano.match(/\b(?:DU|DNI|LC|LE)\s*[:.]?\s*(\d{1,2}\.?\d{3}\.?\d{3})\b/i);
  const dni  = mCuil ? Number(mCuil[2]) : (mDoc ? Number(mDoc[1].replace(/\./g, '')) : null);

  // "Don/ña" sale del OCR como "Don/fia" y el nombre suele caer en el renglón siguiente.
  const mNom = plano.match(/Ape\s*Nom\s*[:\s]\s*(.+?)\s+FNac/i)
            ?? plano.match(/efectuada\s+por\s+Don\/?\S{0,3}\s+([\s\S]+?)\s+(?:DU|DNI|LC|LE)\b/i);
  const nombre = mNom ? mNom[1].replace(/\s+/g, ' ').trim() : null;

  const mFNac = plano.match(new RegExp(String.raw`FNac\s*[:\s]\s*` + RE_FECHA_SRC, 'i'));
  const fecha_nacimiento = mFNac ? armarFecha(mFNac[1], mFNac[2], mFNac[3], [], 'FNac') : null;

  const lineas: LineaANSES[] = [];
  let descartadas = 0;
  let orden = 0;

  for (const cruda of plano.split('\n')) {
    const linea = cruda.replace(/[|¡]/g, '!').replace(/\s+/g, ' ').trim();
    if (!linea) continue;
    // Encabezados, totales y texto legal: no son renglones de servicio. Las resoluciones
    // varían mucho de formato, pero estas líneas aparecen en todas y traen números que
    // podrían confundirse con fechas (Decreto 2741/91, Resol. 366/09, Ley 24.241).
    if (/Ape\s*Nom|CUIL|F\.\s*SOLICITUD|Serv\.\s*Requeridos|Edad\s*Requerida|SERVICIOS\s*FALTANTES|F\.Desde|SIN\s*DERECHO/i.test(linea)) continue;
    if (/ART[IÍ]CULO|RESUELVE|VISTO|CONSIDERANDO|Decreto|Resol|Expediente|Buenos\s+Aires|Total\s*Reconocido|reconocimiento\s+de\s+servicios/i.test(linea)) continue;

    const tokens = linea.split(' ');
    const fechas = extraerFechas(tokens);

    // Renglones sin fechas: ART.19 y las filas en blanco del formulario.
    if (!fechas.length) {
      if (/\bART\.?\s*19\b/i.test(linea) || /^NB\b/i.test(linea)) descartadas += 1;
      continue;
    }

    const motivos: string[] = [];
    const fecha_desde = armarFechaDetectada(fechas[0], motivos, 'Desde');
    if (fechas[0].dudosa) motivos.push('Desde: el OCR leyó caracteres dudosos, verificá la fecha');

    let fecha_hasta: string | null = null;
    if (fechas[1]) {
      fecha_hasta = armarFechaDetectada(fechas[1], motivos, 'Hasta');
      if (fechas[1].dudosa) motivos.push('Hasta: el OCR leyó caracteres dudosos, verificá la fecha');
    } else {
      motivos.push('Sin fecha de baja en el documento');
    }

    // En el listado de terminal los datos del empleo van ANTES de las fechas; en la
    // tabla de la resolución van DESPUÉS (Ap. · Empleador · Carácter · A M D).
    const antes   = tokens.slice(0, fechas[0].tokenInicio).join(' ');
    const despues = tokens.slice((fechas[1] ?? fechas[0]).tokenFin + 1).join(' ');
    const formatoListado = /[A-Za-z]{3,}/.test(antes);

    const mServ = antes.match(/\b(\d{3})\b/);
    const mEL   = antes.match(/(\d{2}\s*\/\s*\d{2})/);
    const codigo_servicio = formatoListado && mServ ? mServ[1] : null;
    const el = formatoListado && mEL ? mEL[1].replace(/\s+/g, '') : null;

    let empresa: string | null;
    let sinAporte = false;
    if (formatoListado) {
      empresa = limpiarEmpresa(mEL ? antes.slice(antes.indexOf(mEL[0]) + mEL[0].length) : antes);
    } else {
      // Columna "Ap.": "Si" = con aportes, "-" = período sin aportes (no computa).
      const cols = despues.split(' ').filter(Boolean);
      if (cols.length && /^-+$/.test(cols[0])) { sinAporte = true; cols.shift(); }
      else if (cols.length && /^S[il1]?$/i.test(cols[0])) cols.shift();
      empresa = limpiarEmpresa(quitarColumnasDeCola(cols).join(' '));
    }

    // Períodos que la propia resolución declara sin aportes: se detectan y quedan
    // destildados, porque no computan para la jubilación.
    if (/prescripci|no\s*aportante|sin\s*aporte/i.test(linea)) sinAporte = true;
    if (sinAporte) motivos.push('Período sin aportes según el documento (no computa)');

    // Código 103 = autónomos; el listado además lo rotula "AUTON.".
    const tipo: LineaANSES['tipo'] =
      codigo_servicio === '103' || /AUTON|monotributo|actividad\s*aut/i.test(empresa || '')
        ? 'AUTONOMO' : 'DEPENDENCIA';

    if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
      motivos.push('La fecha de baja es anterior a la de alta');
    }

    orden += 1;
    lineas.push({
      orden,
      codigo_servicio,
      el,
      empresa,
      tipo,
      fecha_desde,
      fecha_hasta,
      sugerida: !!fecha_desde && !!fecha_hasta && motivos.length === 0,
      tiempo_documento: null,   // el listado de terminal trae el tiempo, pero sale sucio del OCR
      causa_sin_computo: sinAporte ? 'período sin aportes' : null,
      motivos,
      crudo: linea,
    });
  }

  if (!lineas.length) {
    advertencias.push(
      'No se pudo leer ningún renglón. Casi siempre es por la calidad de la imagen: sacá la foto ' +
      'derecha, de cerca y en resolución alta (la hoja entera, sin recortar), o escaneá el papel.',
    );
  }
  if (descartadas) advertencias.push(`Se descartaron ${descartadas} renglón/es sin fechas (ART.19 o filas en blanco).`);

  return { cuil, dni, nombre, fecha_nacimiento, lineas, descartadas, advertencias };
}

// ── Tabla con grilla (resolución de reconocimiento de servicios) ──────────────
// La resolución trae el cómputo en una tabla con bordes. Leída como página entera,
// tesseract toma los bordes por letras ("J", "l", "f"), pega columnas de renglones
// distintos y pierde las barras de las fechas ("1/5/1977" → "11511977"). Acá se detecta
// la grilla, se lee cada celda por separado y las fechas se leen a varias escalas; entre
// las lecturas posibles gana la que cierra con el tiempo A/M/D que el propio documento
// calculó para ese renglón. El listado de terminal (sin grilla) sigue por el parser de texto.

type Bitmap = { w: number; h: number; negro: Uint8Array };

function umbralOtsu(gris: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gris.length; i += 1) hist[gris[i]] += 1;
  let suma = 0;
  for (let i = 0; i < 256; i += 1) suma += i * hist[i];
  let sB = 0, wB = 0, mejor = -1, umbral = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gris.length - wB;
    if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (suma - sB) / wF) ** 2;
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}

function binarizar(ctx: any, w: number, h: number): Bitmap {
  const d = ctx.getImageData(0, 0, w, h).data;
  const gris = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) gris[i] = Math.round(d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11);
  const u = umbralOtsu(gris);
  const negro = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) negro[i] = gris[i] <= u ? 1 : 0;
  return { w, h, negro };
}

/** Inclinación de la hoja en grados (foto o escaneo torcido): la que más concentra los renglones. */
function estimarInclinacion(bm: Bitmap): number {
  let mejorAng = 0, mejorScore = -1;
  for (let a = -3; a <= 3.001; a += 0.2) {
    const t = Math.tan((a * Math.PI) / 180);
    const off = Math.ceil(Math.abs(t) * bm.w) + 1;
    const hist = new Float64Array(bm.h + 2 * off);
    for (let y = 0; y < bm.h; y += 2) {
      for (let x = 0; x < bm.w; x += 2) {
        if (bm.negro[y * bm.w + x]) hist[Math.round(y - x * t) + off] += 1;
      }
    }
    let score = 0;
    for (let i = 0; i < hist.length; i += 1) score += hist[i] * hist[i];
    if (score > mejorScore) { mejorScore = score; mejorAng = a; }
  }
  return mejorAng;
}

function agruparContiguos(idx: number[], tolerancia = 3): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const i of idx) {
    if (out.length && i - out[out.length - 1].b <= tolerancia) out[out.length - 1].b = i;
    else out.push({ a: i, b: i });
  }
  return out;
}

const MAPA_FECHA: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  l: '1', I: '1', i: '1', '|': '1', '!': '1',
  S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', b: '6', '\\': '/',
};

type CandidatoFecha = { iso: string; directa: boolean };

/**
 * Todas las fechas que pudo haber querido decir una lectura del OCR. La barra se pierde
 * o se lee como "1"/"7", y el año a veces sale con un dígito cambiado ("1897"): se prueban
 * todas las formas de partir los dígitos. `directa` = la lectura ya era una fecha limpia.
 */
function candidatosFecha(lectura: string): CandidatoFecha[] {
  const s = lectura.replace(/./g, (c) => MAPA_FECHA[c] ?? c).replace(/[^0-9/]/g, '').replace(/^\/+|\/+$/g, '');
  const out = new Map<string, boolean>();
  const anioMax = new Date().getFullYear() + 1;

  const agregar = (d: string, m: string, a: string, directa: boolean) => {
    if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(a)) return;
    const anios = Number(a) >= ANIO_MIN && Number(a) <= anioMax
      ? [a]
      : (directa = false, ['19' + a.slice(2), '20' + a.slice(2)]);
    for (const an of anios) {
      const dia = Number(d), mes = Number(m), anio = Number(an);
      if (!(anio >= ANIO_MIN && anio <= anioMax) || mes < 1 || mes > 12 || dia < 1 || dia > ultimoDiaDelMes(anio, mes)) continue;
      const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      out.set(iso, (out.get(iso) ?? false) || directa);
    }
  };

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) agregar(m[1], m[2], m[3], true);

  // Reparaciones: el año son los 4 últimos dígitos; delante, día y mes con su separador
  // leído como "/", "1" o "7", o perdido del todo.
  if (s.length < 6) return [...out].map(([iso, directa]) => ({ iso, directa }));
  const anio = s.slice(-4);
  const resto = s.slice(0, -4);
  const prefijos = new Set<string>([resto]);
  if (/[/17]$/.test(resto)) prefijos.add(resto.slice(0, -1));
  for (const p of prefijos) {
    for (let k = 1; k < p.length; k += 1) {
      agregar(p.slice(0, k), p.slice(k), anio, false);                         // barra perdida
      if (/[/17]/.test(p[k])) agregar(p.slice(0, k), p.slice(k + 1), anio, false); // barra leída como dígito
    }
  }
  return [...out].map(([iso, directa]) => ({ iso, directa }));
}

/** Tiempo entre dos fechas, ambas inclusive, en días de 360 (como computa ANSES). */
function dias360(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const fin = new Date(Date.UTC(y2, m2 - 1, d2));
  fin.setUTCDate(fin.getUTCDate() + 1);
  let dd = fin.getUTCDate() - d1;
  let mm = fin.getUTCMonth() + 1 - m1;
  let yy = fin.getUTCFullYear() - y1;
  if (dd < 0) { mm -= 1; dd += 30; }
  if (mm < 0) { yy -= 1; mm += 12; }
  return yy * 360 + mm * 30 + dd;
}

type AMD = { a: number; m: number; d: number };
const amdADias = (t: AMD) => t.a * 360 + t.m * 30 + t.d;

function leerNumeroCelda(t: string): number | null {
  // Una sola letra redonda en una columna de números es un cero ("a", "o", "e").
  if (/^[aoeOQDc]$/.test(t.trim())) return 0;
  const s = t.replace(/[oOQD]/g, '0').replace(/[lI|!]/g, '1').replace(/[^0-9]/g, '');
  return /^\d{1,2}$/.test(s) ? Number(s) : null;
}

type CeldaLeida = { texto: string; lecturas: string[]; caja?: [number, number, number, number]; angosta?: boolean };

function elegirFechas(celdaD: CeldaLeida, celdaH: CeldaLeida | null, amd: AMD | null) {
  const puntuar = (c: CeldaLeida) => {
    const pts = new Map<string, { score: number; directas: number }>();
    for (const l of c.lecturas) {
      for (const cand of candidatosFecha(l)) {
        const p = pts.get(cand.iso) ?? { score: 0, directas: 0 };
        p.score += cand.directa ? 3 : 1;
        if (cand.directa) p.directas += 1;
        pts.set(cand.iso, p);
      }
    }
    return pts;
  };
  const cD = puntuar(celdaD);
  const cH = celdaH ? puntuar(celdaH) : new Map<string, { score: number; directas: number }>();
  const conTiempo = !!amd && amdADias(amd) > 0;

  let mejor: { d: string | null; h: string | null; score: number; cierra: boolean } = { d: null, h: null, score: -Infinity, cierra: false };
  const hs: (string | null)[] = cH.size ? [...cH.keys()] : [null];
  for (const [d, pd] of cD) {
    for (const h of hs) {
      let score = pd.score + (h ? cH.get(h)!.score : 0);
      let cierra = false;
      if (h) {
        if (d > h) score -= 50;
        if (conTiempo && Math.abs(dias360(d, h) - amdADias(amd!)) <= 2) { score += 100; cierra = true; }
        if (h.slice(8) === String(ultimoDiaDelMes(Number(h.slice(0, 4)), Number(h.slice(5, 7))))) score += 0.5;
      }
      if (d.endsWith('-01')) score += 0.5;
      if (score > mejor.score) mejor = { d, h, score, cierra };
    }
  }
  const unanime = (pts: Map<string, { directas: number }>, iso: string | null) =>
    !!iso && (pts.get(iso)?.directas ?? 0) >= 2;
  return {
    desde: mejor.d,
    hasta: mejor.h,
    cierra: mejor.cierra,
    conTiempo,
    seguraDesde: mejor.cierra || unanime(cD, mejor.d),
    seguraHasta: mejor.cierra || unanime(cH, mejor.h),
  };
}

/**
 * Por qué un renglón de la resolución computa 0: lo dice la columna Ap., el empleador
 * (monotributo sin aportes, una ley de reconocimiento sin aporte) o el propio A/M/D en 0.
 * Devuelve null si el renglón computa.
 */
function causaSinComputo(empresa: string | null, ap: 'si' | 'no' | null, amd: AMD | null): string | null {
  const e = empresa || '';
  const cero = !!amd && amdADias(amd) === 0;
  if (ap !== 'no' && !cero && !/prescripci|no\s*aportante|sin\s*aporte|s\/\s*aporte/i.test(e)) return null;
  if (/monotributo/i.test(e)) return 'monotributo sin aportes';
  const ley = e.match(/\bLey\s*(\d{2})\.?(\d{3})\b/i);
  if (ley) return `Ley ${ley[1]}.${ley[2]}`;
  if (/prescripci/i.test(e)) return 'prescripción';
  if (/no\s*aportante|sin\s*aporte|s\/\s*aporte/i.test(e)) return 'sin aportes';
  if (ap === 'no') return 'sin aportes (columna Ap.)';
  return 'tiempo 0 en el documento';
}

const RE_CARACTER = /com+un|fehac|insalub|diferenc|simult|docen/i;

/** Interpreta las celdas de un renglón por forma, no por posición: cada resolución ordena las columnas distinto. */
function interpretarFilaTabla(celdas: CeldaLeida[]): (LineaANSES & { amd: AMD | null; sinAporte: boolean }) | null {
  const digitos = (t: string) => (t.match(/\d/g) || []).length;
  const idxFechas = celdas.map((c, i) => (digitos(c.texto) >= 5 && candidatosFecha(c.texto).length + c.lecturas.flatMap(candidatosFecha).length > 0 ? i : -1)).filter(i => i >= 0);
  if (!idxFechas.length) return null;
  const [iD, iH] = idxFechas;

  // Las tres últimas celdas numéricas son A/M/D.
  const resto = celdas.map((c, i) => ({ c, i })).filter(({ i }) => i !== iD && i !== iH);
  let amd: AMD | null = null;
  const nums = resto.slice(-3).map(({ c }) => leerNumeroCelda(c.texto));
  const idxAmd = new Set<number>();
  if (resto.length >= 3 && nums.every(n => n !== null)) {
    amd = { a: nums[0]!, m: nums[1]!, d: nums[2]! };
    resto.slice(-3).forEach(({ i }) => idxAmd.add(i));
  }

  let ap: 'si' | 'no' | null = null;
  let caracter: string | null = null;
  const textoEmpleador: string[] = [];
  for (const { c, i } of resto) {
    if (idxAmd.has(i)) continue;
    const t = c.texto.replace(/[^A-Za-z0-9\-]/g, '');
    if (ap === null && /^(s[il1]|n[o0]|-+)$/i.test(t)) { ap = /^s/i.test(t) ? 'si' : 'no'; continue; }
    if (!caracter && RE_CARACTER.test(c.texto)) { caracter = c.texto; continue; }
    // Las columnas angostas son de números (A/M/D): lo que traigan no es el empleador.
    if (!c.angosta && /[A-Za-z]{2,}|\d{3,}/.test(c.texto)) textoEmpleador.push(c.texto);
  }
  const empresa = limpiarEmpresa(textoEmpleador.join(' '));

  // Los períodos sin aportes van con tiempo 0 (y en la práctica suelen tener anotaciones a
  // mano encima): no sirven para validar las fechas ni entran en la suma del total.
  const tiempo_documento = amd ? { anios: amd.a, meses: amd.m, dias: amd.d } : null;
  const causa_sin_computo = causaSinComputo(empresa, ap, amd);
  const sinAporte = !!causa_sin_computo;
  if (sinAporte) amd = null;
  const fechas = elegirFechas(celdas[iD], iH !== undefined ? celdas[iH] : null, amd);
  const motivos: string[] = [];
  if (!fechas.desde) motivos.push('Desde: no se pudo leer la fecha');
  else if (!fechas.seguraDesde) motivos.push('Desde: el OCR dudó, verificá la fecha');
  if (iH === undefined) motivos.push('Sin fecha de baja en el documento');
  else if (!fechas.hasta) motivos.push('Hasta: no se pudo leer la fecha');
  else if (!fechas.seguraHasta) motivos.push('Hasta: el OCR dudó, verificá la fecha');
  if (fechas.conTiempo && !fechas.cierra && fechas.desde && fechas.hasta) {
    motivos.push(`Las fechas no cierran con el tiempo del documento (${amd!.a}a ${amd!.m}m ${amd!.d}d)`);
  }
  if (fechas.desde && fechas.hasta && fechas.desde > fechas.hasta) motivos.push('La fecha de baja es anterior a la de alta');

  if (causa_sin_computo) motivos.push(`No computa: ${causa_sin_computo} (el documento le asigna 0)`);

  return {
    orden: 0,
    codigo_servicio: null,
    el: null,
    empresa,
    tipo: /AUTON|monotributo|actividad\s*aut/i.test(empresa || '') ? 'AUTONOMO' : 'DEPENDENCIA',
    fecha_desde: fechas.desde,
    fecha_hasta: fechas.hasta,
    sugerida: !!fechas.desde && !!fechas.hasta && motivos.length === 0,
    tiempo_documento,
    causa_sin_computo,
    motivos,
    crudo: celdas.map(c => c.texto).join(' | '),
    amd,
    sinAporte,
  };
}

/**
 * Busca la tabla con bordes de la imagen y la lee celda por celda. Devuelve null si la
 * hoja no tiene grilla (listado de terminal) o no se encontró ningún renglón con fechas.
 */
async function leerTablaConGrilla(imgPath: string): Promise<{ lineas: LineaANSES[]; advertencias: string[] } | null> {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(fs.readFileSync(imgPath));
  const W = img.width, H = img.height;

  // Enderezar: con la hoja torcida las líneas de la tabla no quedan en una sola fila de píxeles.
  let canvas = createCanvas(W, H);
  let ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0);
  let bm = binarizar(ctx, W, H);
  const angulo = estimarInclinacion(bm);
  if (Math.abs(angulo) >= 0.2) {
    const rot = createCanvas(W, H);
    const rctx = rot.getContext('2d');
    rctx.fillStyle = '#ffffff';
    rctx.fillRect(0, 0, W, H);
    rctx.translate(W / 2, H / 2);
    rctx.rotate((-angulo * Math.PI) / 180);
    rctx.drawImage(canvas, -W / 2, -H / 2);
    canvas = rot;
    ctx = rctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bm = binarizar(ctx, W, H);
  }

  // Líneas horizontales: tramos negros de al menos 1/4 del ancho (tolerando cortes de 3 px).
  const filasLinea: number[] = [];
  for (let y = 0; y < H; y += 1) {
    let run = 0, gap = 0, mejor = 0;
    for (let x = 0; x < W; x += 1) {
      if (bm.negro[y * W + x]) { run += gap + 1; gap = 0; }
      else if (run && gap < 3) gap += 1;
      else { run = 0; gap = 0; }
      if (run > mejor) mejor = run;
    }
    if (mejor >= W * 0.25) filasLinea.push(y);
  }
  const hl = agruparContiguos(filasLinea);
  if (hl.length < 3) return null;

  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    errorHandler: (e: any) => logger.warn({ msg: '[anses-pdf] OCR de celda (manejado)', error: String(e) }),
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });

  const leer = async (x0: number, y0: number, w: number, h: number, escala: number): Promise<string> => {
    const c = createCanvas(Math.round((w + 20) * escala), Math.round((h + 16) * escala));
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);
    cx.imageSmoothingEnabled = escala > 1;
    cx.drawImage(canvas, x0, y0, w, h, 10 * escala, 8 * escala, w * escala, h * escala);
    const { data } = await worker.recognize(c.toBuffer('image/png'));
    return (data.text || '').replace(/\s+/g, ' ').trim();
  };

  const filas: (LineaANSES & { amd: AMD | null; sinAporte: boolean })[] = [];
  let total: AMD | null = null;
  try {
    for (let i = 0; i + 1 < hl.length; i += 1) {
      const y0 = hl[i].b + 1, y1 = hl[i + 1].a - 1, h = y1 - y0 + 1;
      if (h < W * 0.008 || h > W * 0.08) continue;

      // Separadores verticales de este renglón: columnas casi enteramente negras.
      const cols: number[] = [];
      for (let x = 0; x < W; x += 1) {
        let n = 0;
        for (let y = y0; y <= y1; y += 1) n += bm.negro[y * W + x];
        if (n >= h * 0.8) cols.push(x);
      }
      const vl = agruparContiguos(cols);
      if (vl.length < 3) continue;

      const celdas: CeldaLeida[] = [];
      for (let j = 0; j + 1 < vl.length; j += 1) {
        const x0 = vl[j].b + 3, x1 = vl[j + 1].a - 3;
        if (x1 - x0 < 8) continue;
        let tinta = 0;
        for (let y = y0 + 2; y <= y1 - 2; y += 1) for (let x = x0; x <= x1; x += 1) tinta += bm.negro[y * W + x];
        if (tinta < 15) { celdas.push({ texto: '', lecturas: [] }); continue; }

        const texto = await leer(x0, y0 + 1, x1 - x0, h - 2, 1);
        const lecturas = [texto];
        // Las fechas se releen agrandadas: cada escala se equivoca en lugares distintos.
        if ((texto.match(/\d/g) || []).length >= 5) {
          lecturas.push(await leer(x0, y0 + 1, x1 - x0, h - 2, 2));
          lecturas.push(await leer(x0, y0 + 1, x1 - x0, h - 2, 3));
        }
        celdas.push({ texto, lecturas, caja: [x0, y0 + 1, x1 - x0, h - 2], angosta: x1 - x0 < W * 0.05 });
      }

      // Las tres últimas columnas (A/M/D) son sólo números: si alguna salió con letras
      // ("a" por "0", o un sello encima), se relee con lista blanca de dígitos.
      for (const c of celdas.filter(c => c.texto).slice(-3)) {
        if (leerNumeroCelda(c.texto) !== null || !c.caja || !c.angosta) continue;
        await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
        const n = await leer(c.caja[0], c.caja[1], c.caja[2], c.caja[3], 2);
        await worker.setParameters({ tessedit_char_whitelist: '' });
        if (/^\d{1,2}$/.test(n)) c.texto = n;
      }

      if (celdas.some(c => /total/i.test(c.texto))) {
        const nums = celdas.filter(c => c.texto && !/total/i.test(c.texto)).slice(-3).map(c => leerNumeroCelda(c.texto));
        if (nums.length === 3 && nums.every(n => n !== null)) total = { a: nums[0]!, m: nums[1]!, d: nums[2]! };
        continue;
      }
      const fila = interpretarFilaTabla(celdas);
      if (fila) filas.push(fila);
    }
  } finally {
    try { await worker.terminate(); } catch { /* noop */ }
  }

  if (!filas.length) return null;

  const advertencias: string[] = [];
  // Control cruzado: la suma de A/M/D de los renglones tiene que dar el total del documento.
  const computan = filas.filter(f => !f.sinAporte);
  if (total && computan.length && computan.every(f => f.amd)) {
    const suma = computan.reduce((acc, f) => acc + amdADias(f.amd!), 0);
    if (Math.abs(suma - amdADias(total)) > 2) {
      advertencias.push(
        `La suma del tiempo de los renglones no da el total del documento (${total.a}a ${total.m}m ${total.d}d): ` +
        'puede faltar un renglón o haber un número mal leído.',
      );
    }
  }
  logger.info({ msg: '[anses-pdf] tabla leida por grilla', filas: filas.length, angulo });
  return { lineas: filas.map(({ amd: _amd, sinAporte: _sa, ...l }) => l), advertencias };
}

/** Lee un PDF (o imagen) del listado de ANSES y devuelve las líneas detectadas. */
export async function leerListadoANSES(filePath: string, opts: { maxPages?: number } = {}): Promise<ParseANSESResult> {
  const maxPages = Math.max(1, opts.maxPages ?? 5);
  const esPdf = path.extname(filePath).toLowerCase() === '.pdf';

  let leido: TextoPdf;
  if (esPdf) {
    leido = await pdfATexto(filePath, maxPages);
  } else {
    const grilla = await leerTablaConGrilla(filePath).catch((err: any) => {
      logger.warn({ msg: '[anses-pdf] lectura por grilla fallo', error: err?.message });
      return null;
    });
    leido = {
      texto: await extractTextFromMonoImage(filePath),
      origen: 'ocr',
      avisos: grilla?.advertencias ?? [],
      tabla: grilla?.lineas ?? [],
    };
  }
  const { texto, origen, avisos, tabla } = leido;

  const parsed = parsearTextoANSES(texto || '');
  // Si la hoja tenía tabla con grilla, sus renglones (leídos celda por celda) reemplazan
  // a los del texto corrido; del texto quedan los datos del encabezado.
  if (tabla.length) {
    parsed.lineas = tabla.map((l, i) => ({ ...l, orden: i + 1 }));
    parsed.descartadas = 0;
    parsed.advertencias = [];
  }
  return {
    ...parsed,
    advertencias: [...avisos, ...parsed.advertencias],
    origen,
    texto: texto || '',
  };
}
