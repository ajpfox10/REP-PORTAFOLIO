// src/services/parseLicenciasPdf.ts
// Parsea PDFs de licencias anuales (ANUAL / NOVEDADES) para comparación.
//
// NOVEDADES PDF ("Planilla provisoria"): grilla legajo × día con código numérico.
// ANUAL PDF ("Licencias y Permisos por Períodos"): listado con períodos desde/hasta por agente.
//
// Usa pdfjs-dist con coordenadas X para extraer columnas sin ambigüedad.

import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

// ── pdfjs (ESM, carga dinámica) ───────────────────────────────────────────────
let _pdfjs: any = null;

async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const modPath = path.resolve(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs'
  );
  _pdfjs = await import(pathToFileURL(modPath).href);
  _pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  ).href;
  return _pdfjs;
}

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type TipoPdf = 'NOVEDADES' | 'ANUAL' | 'COMPLEMENTARIA' | 'DESCONOCIDO';

export interface AgenteDias {
  legajo: string;
  nombre: string;
  cargo: string;
  /** key: día 1-31, value: código (ej. "08", "291", "01") */
  dias: Record<number, string>;
}

export interface AgenteLicencia {
  legajo: string;
  nombre: string;
  desde: Date;
  hasta: Date;
  tipo: 'ANUAL' | 'COMPLEMENTARIA';
}

export interface PdfParseado {
  archivo: string;
  tipo: TipoPdf;
  periodo?: { anio: number; mes: number };   // para NOVEDADES
  regimen?: string;
  /** para NOVEDADES */
  agentes?: AgenteDias[];
  /** para ANUAL/COMPLEMENTARIA */
  licencias?: AgenteLicencia[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string) {
  return (s ?? '')
    .toString()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDDMMYYYY(s: string): Date | null {
  // "06-07-2026" o "06/07/2026"
  const m = /(\d{2})[-\/](\d{2})[-\/](\d{4})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return isNaN(d.getTime()) ? null : d;
}

/** Agrupa items de texto por fila (Y aproximado, tolerancia 3px). */
function agruparPorFila(items: Array<{ str: string; x: number; y: number }>) {
  const filas: Array<Array<{ str: string; x: number; y: number }>> = [];
  for (const it of items) {
    const fila = filas.find((f) => Math.abs(f[0].y - it.y) < 4);
    if (fila) { fila.push(it); fila.sort((a, b) => a.x - b.x); }
    else filas.push([it]);
  }
  filas.sort((a, b) => b[0].y - a[0].y); // PDF Y = 0 abajo, mayor = más arriba
  return filas;
}

/** Extrae todos los items de texto con coordenadas de una página pdfjs. */
async function itemsDePagina(page: any): Promise<Array<{ str: string; x: number; y: number }>> {
  const content = await page.getTextContent();
  return (content.items as any[])
    .filter((it: any) => it.str && it.str.trim())
    .map((it: any) => ({
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
    }));
}

// ── Detección de tipo ─────────────────────────────────────────────────────────

async function detectarTipo(doc: any): Promise<{ tipo: TipoPdf; textoP1: string }> {
  const page = await doc.getPage(1);
  const items = await itemsDePagina(page);
  const texto = items.map((i) => i.str).join(' ');
  const n = norm(texto);

  if (n.includes('PARTE DE NOVEDADES')) return { tipo: 'NOVEDADES', textoP1: texto };
  if (n.includes('ANUAL COMPLEMENTARIA') || n.includes('COMPLEMENTARIA')) return { tipo: 'COMPLEMENTARIA', textoP1: texto };
  if (n.includes('PERIODO ANUAL') || n.includes('LICENCIAS Y PERMISOS')) return { tipo: 'ANUAL', textoP1: texto };
  return { tipo: 'DESCONOCIDO', textoP1: texto };
}

// ── Parseo NOVEDADES ──────────────────────────────────────────────────────────
//
// Estructura por página:
//  - Fila cabecera días: tokens "1" "2" … "31" en posiciones X fijas
//  - Filas de agente: "372129" "ACEBAL ROJAS, MAYRA ELIZABETH" "48Hs." "PROFESIONAL" [códigos…]
//
// Estrategia:
//  1. Encontrar la fila con tokens "1".."31" → registrar X de cada día
//  2. Para cada fila posterior: si el primer token es un legajo (6 dígitos),
//     agrupar nombre+cargo, luego mapear códigos numéricos a día por X más cercano.

const RE_LEGAJO = /^\d{5,7}$/;
const RE_CODE   = /^\d{1,3}[A-Z]?$/; // "08", "291", "1R", "01"
const RE_DIA_HDR = /^(\d{1,2})$/;     // "1".."31"

async function parsearNovedades(doc: any): Promise<{
  agentes: AgenteDias[];
  periodo?: { anio: number; mes: number };
  regimen?: string;
}> {
  const agentesMap = new Map<string, AgenteDias>();
  let periodo: { anio: number; mes: number } | undefined;
  let regimen: string | undefined;

  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const items = await itemsDePagina(page);
    const filas = agruparPorFila(items);

    // Extraer período del texto de cabecera (solo primera página)
    if (pi === 1) {
      const cabText = items.map((i) => i.str).join(' ');
      const mPer = /Per[ií]odo\s+(\d{1,2})\/(\d{4})/i.exec(cabText);
      if (mPer) periodo = { mes: +mPer[1], anio: +mPer[2] };
      const mReg = /R[eé]gimen\s+([^,\n]+)/i.exec(cabText);
      if (mReg) regimen = mReg[1].trim();
    }

    // Detectar fila cabecera de días (contiene tokens "1".."31")
    let xPorDia: Record<number, number> = {};
    let cabeceraY = -1;

    for (const fila of filas) {
      const diaTokens = fila.filter((it) => RE_DIA_HDR.test(it.str) && +it.str >= 1 && +it.str <= 31);
      if (diaTokens.length >= 20) { // cabecera completa
        for (const t of diaTokens) xPorDia[+t.str] = t.x;
        cabeceraY = fila[0].y;
        break;
      }
    }

    if (Object.keys(xPorDia).length === 0) continue; // página sin grilla

    // Calcular tolerancia de columna (mitad del paso entre días)
    const xs = Object.values(xPorDia).sort((a, b) => a - b);
    const toleranciaCol = xs.length > 1
      ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) / 2
      : 8;

    // Procesar filas de agentes (debajo de la cabecera)
    for (const fila of filas) {
      if (fila[0].y >= cabeceraY) continue; // encima o igual a cabecera = no agente

      const primero = fila[0].str;
      if (!RE_LEGAJO.test(primero)) continue;

      const legajo = primero;

      // Tokens que parecen código de novedad
      const tokensAgente = fila.slice(1);

      // Separar nombre/cargo (texto) de códigos (numérico)
      // Nombre y cargo preceden a los códigos; los códigos están alineados a columnas de días
      let nombre = '';
      let cargo = '';
      const dias: Record<number, string> = {};

      // Clasificar cada token: ¿está alineado a una columna de día?
      for (const tok of tokensAgente) {
        const diaMatch = Object.entries(xPorDia).find(
          ([, xDia]) => Math.abs(tok.x - xDia) <= toleranciaCol
        );
        if (diaMatch && RE_CODE.test(tok.str)) {
          const dia = +diaMatch[0];
          // Si ya hay un código para ese día, concatenar (casos raros)
          dias[dia] = tok.str;
        } else {
          // Texto libre → parte del nombre o cargo
          // Última palabra en mayúsculas sostenidas sin coma suele ser el cargo
          if (!cargo && /^(TECNICO|ADMINISTRATIVO|PROFESIONAL|SERVICIO|OBRERO|CLERO|JERARQUICO|CONTRATADO)$/.test(norm(tok.str))) {
            cargo = tok.str;
          } else {
            nombre += (nombre ? ' ' : '') + tok.str;
          }
        }
      }

      nombre = nombre.trim();
      // Separar cargo del nombre si quedó pegado al final
      const cargoMatch = /\b(TECNICO|ADMINISTRATIVO|PROFESIONAL|SERVICIO|OBRERO|CLERO|JERARQUICO|CONTRATADO)\b/i.exec(nombre);
      if (cargoMatch && !cargo) {
        cargo = cargoMatch[0];
        nombre = nombre.replace(cargoMatch[0], '').trim();
      }

      // También limpiar "48Hs." / "36Hs." del nombre
      nombre = nombre.replace(/\d+Hs\./gi, '').trim();

      if (!legajo || Object.keys(dias).length === 0) {
        // Agente sin novedades: registrar igualmente si tiene nombre
        if (nombre && !agentesMap.has(legajo)) {
          agentesMap.set(legajo, { legajo, nombre, cargo, dias: {} });
        }
        continue;
      }

      if (agentesMap.has(legajo)) {
        // Fusionar días (puede venir en varias páginas)
        const existing = agentesMap.get(legajo)!;
        Object.assign(existing.dias, dias);
      } else {
        agentesMap.set(legajo, { legajo, nombre, cargo, dias });
      }
    }
  }

  return { agentes: Array.from(agentesMap.values()), periodo, regimen };
}

// ── Parseo ANUAL / COMPLEMENTARIA ─────────────────────────────────────────────
//
// Estructura por página (landscape, columnas = agentes):
//  - Banda de nombres: "Acevedo Jose", "Acosta Mariana Ayelen" …
//  - Banda de legajos: "649607", "639019" …
//  - Banda de fechas Desde: "06-07-2026", "20-07-2026" …
//  - Banda de fechas Hasta: "12-07-2026", "02-08-2026" …
//  - Banda de destino y Reg.Hor. (no las necesitamos)
//
// Estrategia: agrupar por fila (Y), detectar qué fila contiene qué tipo de dato,
// ordenar por X dentro de cada fila, luego zipear.

async function parsearAnual(doc: any, tipo: 'ANUAL' | 'COMPLEMENTARIA'): Promise<AgenteLicencia[]> {
  const licencias: AgenteLicencia[] = [];

  const RE_DATE = /^\d{2}[-\/]\d{2}[-\/]\d{4}$/;
  const RE_LEG6 = /^\d{5,7}$/;

  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const items = await itemsDePagina(page);
    const filas = agruparPorFila(items);

    // Necesitamos encontrar: banda nombres, banda legajos, banda desde, banda hasta
    // Identificamos cada fila por el contenido predominante

    interface Banda { tipo: 'nombre' | 'legajo' | 'desde' | 'hasta' | 'otro'; fila: typeof filas[0] }
    const bandas: Banda[] = [];

    for (const fila of filas) {
      const strs = fila.map((i) => i.str);
      const fechas = strs.filter((s) => RE_DATE.test(s)).length;
      const legs   = strs.filter((s) => RE_LEG6.test(s) && +s > 10000).length;
      const total  = strs.length;

      if (total < 2) continue;

      if (fechas / total > 0.5) {
        // Determinar si es "Desde" o "Hasta": las desde son menores cronológicamente.
        // Como no podemos saber a priori, registramos ambas en orden de aparición.
        const existeDesde = bandas.some((b) => b.tipo === 'desde');
        bandas.push({ tipo: existeDesde ? 'hasta' : 'desde', fila });
      } else if (legs / total > 0.4) {
        bandas.push({ tipo: 'legajo', fila });
      } else if (fechas === 0 && legs === 0 && total >= 3) {
        // Podría ser nombre si parece texto libre
        const esTexto = strs.every((s) => /[A-Za-záéíóúüÁÉÍÓÚÜñÑ]/.test(s));
        if (esTexto) bandas.push({ tipo: 'nombre', fila });
        else bandas.push({ tipo: 'otro', fila });
      } else {
        bandas.push({ tipo: 'otro', fila });
      }
    }

    const bNombre = bandas.find((b) => b.tipo === 'nombre');
    const bLegajo = bandas.find((b) => b.tipo === 'legajo');
    const bDesde  = bandas.find((b) => b.tipo === 'desde');
    const bHasta  = bandas.find((b) => b.tipo === 'hasta');

    if (!bDesde || !bHasta) continue; // página sin datos útiles

    // Ordenar cada banda por X
    const sort = (b: Banda) => [...b.fila].sort((a, c) => a.x - c.x);

    const nombres  = bNombre ? sort(bNombre).map((i) => i.str) : [];
    const legajos  = bLegajo ? sort(bLegajo).map((i) => i.str) : [];
    const desdeArr = sort(bDesde).map((i) => parseDDMMYYYY(i.str));
    const hastaArr = sort(bHasta).map((i) => parseDDMMYYYY(i.str));

    const count = desdeArr.length;
    for (let i = 0; i < count; i++) {
      const desde = desdeArr[i];
      const hasta = hastaArr[i];
      if (!desde || !hasta) continue;

      licencias.push({
        legajo: legajos[i] ?? '',
        nombre: nombres[i] ?? '',
        desde,
        hasta,
        tipo,
      });
    }
  }

  return licencias;
}

// ── Función principal: parsear todos los PDFs de un directorio ────────────────

export async function parsearDirectorio(dir: string): Promise<PdfParseado[]> {
  const pdfjs = await getPdfjs();
  const archivos = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const resultados: PdfParseado[] = [];

  for (const archivo of archivos) {
    const fp = path.join(dir, archivo);
    const data = new Uint8Array(fs.readFileSync(fp));
    const doc = await pdfjs.getDocument({ data }).promise;

    const { tipo } = await detectarTipo(doc);

    if (tipo === 'NOVEDADES') {
      const { agentes, periodo, regimen } = await parsearNovedades(doc);
      resultados.push({ archivo, tipo, periodo, regimen, agentes });
    } else if (tipo === 'ANUAL' || tipo === 'COMPLEMENTARIA') {
      const licencias = await parsearAnual(doc, tipo === 'ANUAL' ? 'ANUAL' : 'COMPLEMENTARIA');
      resultados.push({ archivo, tipo, licencias });
    } else {
      resultados.push({ archivo, tipo });
    }
  }

  return resultados;
}

// ── Comparación ───────────────────────────────────────────────────────────────

export interface FilaComparacion {
  legajo: string;
  nombre: string;
  tipo: 'ANUAL' | 'COMPLEMENTARIA';
  desde: string;
  hasta: string;
  /** Días del período que caen dentro del mes de NOVEDADES */
  diasEnMes: number[];
  /** Para cada día: código encontrado en NOVEDADES (o vacío) */
  codigosPorDia: Record<number, string>;
  /** Códigos esperados según mapeo para este tipo de licencia */
  codigosEsperados: string[];
  estado: 'OK' | 'FALTA_EN_NOVEDADES' | 'CODIGO_INCORRECTO' | 'SIN_LEGAJO';
  motivo?: string;
  archivoAnual: string;
  archivoNovedades: string;
}

export interface FilaSobrante {
  legajo: string;
  nombre: string;
  cargo: string;
  /** Días con código anual */
  diasConCodigo: number[];
  codigo: string;
  estado: 'EXCESO';
  motivo: string;
  archivoNovedades: string;
}

export interface ResultadoComparacion {
  periodo?: { anio: number; mes: number };
  archivosDetectados: Array<{ archivo: string; tipo: TipoPdf }>;
  filas: FilaComparacion[];
  sobrantes: FilaSobrante[];
  totales: {
    ok: number;
    faltanEnNovedades: number;
    codigoIncorrecto: number;
    sinLegajo: number;
    sobrantes: number;
  };
}

/** Extrae el prefijo numérico/alfanumérico de una clave de mapeo.
 *  "08-DESCANSO ANUAL" → "08", "1R-ENFERMEDAD..." → "1R"
 */
function prefijoClave(key: string): string {
  const m = /^([A-Z0-9]{1,4})-/.exec(key);
  return m ? m[1] : key;
}

/**
 * A partir del mapeo, encuentra qué prefijos de código NOVEDADES corresponden
 * a un tipo de licencia dado (según los valores del mapeo que contengan el texto).
 */
function codigosParaTipo(
  mapeo: Record<string, string[]>,
  textoTipo: string   // ej. 'ANUAL' o 'COMPLEMENTARIA'
): string[] {
  const tn = norm(textoTipo);
  const prefijos = new Set<string>();
  for (const [key, vals] of Object.entries(mapeo)) {
    const coincide = vals.some((v) => {
      const vn = norm(v);
      if (tn === 'ANUAL') {
        // Solo los que mapean a 'ANUAL' puro, no los de COMPLEMENTARIA
        return vn === 'ANUAL' || vn === '08-DESCANSO ANUAL' || vn === '81-LICENCIA ANTERIOR DENEGADA';
      }
      return vn.includes('COMPLEMENTARIA');
    });
    if (coincide) prefijos.add(prefijoClave(key));
  }
  return Array.from(prefijos);
}

export async function compararLicencias(
  dir: string,
  mapeo: Record<string, string[]>
): Promise<ResultadoComparacion> {
  const pdfs = await parsearDirectorio(dir);

  const archivosDetectados = pdfs.map((p) => ({ archivo: p.archivo, tipo: p.tipo }));

  // Reunir novedades y licencias
  const novedadesPdfs = pdfs.filter((p) => p.tipo === 'NOVEDADES' && p.agentes);
  const anualPdfs = pdfs.filter(
    (p) => (p.tipo === 'ANUAL' || p.tipo === 'COMPLEMENTARIA') && p.licencias
  );

  if (!novedadesPdfs.length || !anualPdfs.length) {
    return {
      archivosDetectados,
      filas: [],
      sobrantes: [],
      totales: { ok: 0, faltanEnNovedades: 0, codigoIncorrecto: 0, sinLegajo: 0, sobrantes: 0 },
    };
  }

  // Usar el primer NOVEDADES como referencia de período (puede haber varios)
  const novedadesRef = novedadesPdfs[0];
  const periodo = novedadesRef.periodo;

  // Mapa legajo → AgenteDias (fusión de todos los NOVEDADES)
  const mapaNovedades = new Map<string, AgenteDias & { _archivo: string }>();
  for (const npdf of novedadesPdfs) {
    for (const ag of npdf.agentes ?? []) {
      if (mapaNovedades.has(ag.legajo)) {
        Object.assign(mapaNovedades.get(ag.legajo)!.dias, ag.dias);
      } else {
        mapaNovedades.set(ag.legajo, { ...ag, _archivo: npdf.archivo });
      }
    }
  }

  // Códigos esperados por tipo
  const codigosAnual         = codigosParaTipo(mapeo, 'ANUAL');
  const codigosComplementaria = codigosParaTipo(mapeo, 'COMPLEMENTARIA');

  const filas: FilaComparacion[] = [];
  const legajosConAnual = new Set<string>();

  for (const apdf of anualPdfs) {
    const codigosEsp = apdf.tipo === 'ANUAL' ? codigosAnual : codigosComplementaria;

    for (const lic of apdf.licencias ?? []) {
      legajosConAnual.add(lic.legajo);

      // Calcular días del período en el mes de NOVEDADES
      let diasEnMes: number[] = [];
      if (periodo) {
        const { anio, mes } = periodo;
        const primerDia = new Date(anio, mes - 1, 1);
        const ultimoDia = new Date(anio, mes, 0);
        const inicio = lic.desde < primerDia ? primerDia : lic.desde;
        const fin    = lic.hasta > ultimoDia  ? ultimoDia  : lic.hasta;
        if (inicio <= fin) {
          for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
            diasEnMes.push(d.getDate());
          }
        }
      }

      const agenteNov = mapaNovedades.get(lic.legajo);
      const codigosPorDia: Record<number, string> = {};

      if (agenteNov) {
        for (const dia of diasEnMes) {
          if (agenteNov.dias[dia]) codigosPorDia[dia] = agenteNov.dias[dia];
        }
      }

      // Determinar estado
      let estado: FilaComparacion['estado'];
      let motivo: string | undefined;

      if (!lic.legajo) {
        estado = 'SIN_LEGAJO';
        motivo = 'No se pudo extraer legajo del PDF';
      } else if (!agenteNov) {
        estado = 'FALTA_EN_NOVEDADES';
        motivo = 'Agente no figura en el parte de novedades';
      } else if (diasEnMes.length === 0) {
        estado = 'OK'; // período fuera del mes de novedades
      } else {
        // Verificar que los días del período tengan el código esperado
        const diasConCodigoIncorrecto = diasEnMes.filter((d) => {
          const cod = codigosPorDia[d];
          return !cod || !codigosEsp.includes(cod);
        });

        if (diasConCodigoIncorrecto.length === 0) {
          estado = 'OK';
        } else {
          estado = 'CODIGO_INCORRECTO';
          motivo = `Días sin código esperado (${codigosEsp.join('/')}): ${diasConCodigoIncorrecto.join(', ')}`;
        }
      }

      filas.push({
        legajo: lic.legajo,
        nombre: lic.nombre,
        tipo: lic.tipo,
        desde: lic.desde.toLocaleDateString('es-AR'),
        hasta: lic.hasta.toLocaleDateString('es-AR'),
        diasEnMes,
        codigosPorDia,
        codigosEsperados: codigosEsp,
        estado,
        motivo,
        archivoAnual: apdf.archivo,
        archivoNovedades: novedadesRef.archivo,
      });
    }
  }

  // Sobrantes: agentes con código anual en NOVEDADES pero sin figura en ningún ANUAL
  const sobrantes: FilaSobrante[] = [];
  const todosCodigosAnual = new Set([...codigosAnual, ...codigosComplementaria]);

  for (const [legajo, ag] of mapaNovedades) {
    if (legajosConAnual.has(legajo)) continue;

    for (const [diaStr, cod] of Object.entries(ag.dias)) {
      if (todosCodigosAnual.has(cod)) {
        // Agrupar por código
        const existing = sobrantes.find((s) => s.legajo === legajo && s.codigo === cod);
        if (existing) {
          existing.diasConCodigo.push(+diaStr);
        } else {
          sobrantes.push({
            legajo,
            nombre: ag.nombre,
            cargo: ag.cargo,
            diasConCodigo: [+diaStr],
            codigo: cod,
            estado: 'EXCESO',
            motivo: `Código ${cod} cargado en novedades sin licencia en ANUAL PDF`,
            archivoNovedades: ag._archivo,
          });
        }
        break; // un sobrante por agente alcanza
      }
    }
  }

  // Ordenar días
  for (const s of sobrantes) s.diasConCodigo.sort((a, b) => a - b);

  const totales = {
    ok:                filas.filter((f) => f.estado === 'OK').length,
    faltanEnNovedades: filas.filter((f) => f.estado === 'FALTA_EN_NOVEDADES').length,
    codigoIncorrecto:  filas.filter((f) => f.estado === 'CODIGO_INCORRECTO').length,
    sinLegajo:         filas.filter((f) => f.estado === 'SIN_LEGAJO').length,
    sobrantes:         sobrantes.length,
  };

  return { periodo, archivosDetectados, filas, sobrantes, totales };
}
