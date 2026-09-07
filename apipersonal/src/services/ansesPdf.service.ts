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

async function renderPageToJpg(pdf: any, pageNo: number, tempDir: string, anchoObjetivo = ANCHO_OBJETIVO_PX): Promise<string> {
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

  const out = path.join(tempDir, `anses_${String(pageNo).padStart(3, '0')}.jpg`);
  fs.writeFileSync(out, await canvas.encode('jpeg', 92));
  return out;
}

/** Texto del PDF: primero la capa de texto; si el PDF es un escaneo, OCR página por página. */
async function pdfATexto(pdfPath: string, maxPages: number): Promise<{ texto: string; origen: 'texto' | 'ocr'; avisos: string[] }> {
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
    if (contarFechas(texto) >= 2) return { texto, origen: 'texto', avisos: [] };

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
      for (let p = 1; p <= paginas; p += 1) {
        try {
          const img = await renderPageToJpg(pdf, p, tempDir, anchoObjetivo);
          const t = await extractTextFromMonoImage(img);
          if (t?.trim()) partes.push(t);
        } catch (err: any) {
          logger.warn({ msg: '[anses-pdf] OCR de pagina fallo', page: p, error: err?.message });
        }
      }
      return { texto: partes.join('\n'), origen: 'ocr', avisos };
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
  const mDoc = plano.match(/\b(?:DU|DNI|LC|LE)\s*[:.]?\s*(\d{7,8})\b/i);
  const dni  = mCuil ? Number(mCuil[2]) : (mDoc ? Number(mDoc[1]) : null);

  const mNom = plano.match(/Ape\s*Nom\s*[:\s]\s*(.+?)\s+FNac/i)
            ?? plano.match(/efectuada\s+por\s+Don\/?[ñn]a\s+(.+?)\s+(?:DU|DNI|LC|LE)\b/i);
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

/** Lee un PDF (o imagen) del listado de ANSES y devuelve las líneas detectadas. */
export async function leerListadoANSES(filePath: string, opts: { maxPages?: number } = {}): Promise<ParseANSESResult> {
  const maxPages = Math.max(1, opts.maxPages ?? 5);
  const esPdf = path.extname(filePath).toLowerCase() === '.pdf';

  const { texto, origen, avisos } = esPdf
    ? await pdfATexto(filePath, maxPages)
    : { texto: await extractTextFromMonoImage(filePath), origen: 'ocr' as const, avisos: [] as string[] };

  const parsed = parsearTextoANSES(texto || '');
  return {
    ...parsed,
    advertencias: [...avisos, ...parsed.advertencias],
    origen,
    texto: texto || '',
  };
}
