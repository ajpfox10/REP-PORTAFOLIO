/**
 * @file routes/antiguedad.routes.ts
 * @description Reporte de antigüedad de agentes por servicio y sector.
 *
 * GET /antiguedad/excel
 *   Genera un archivo .xlsx con la antigüedad de los agentes designados,
 *   agrupado por servicio y luego por sector (dependencia).
 *   Incluye la ley de cada agente.
 *
 * Query params opcionales:
 *   solo_activos  = 1 (default) | 0  → solo pases sin fecha_hasta
 *   servicio_id   = number            → filtrar por servicio
 *   dependencia_id= number            → filtrar por dependencia (derivada del servicio)
 *   reparticion_id= number            → filtrar por repartición (derivada del servicio)
 *   ley_id        = number            → filtrar por ley
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import ExcelJS from 'exceljs';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface AntiguedadRow {
  pase_id: number;
  dni: number;
  apellido: string;
  nombre: string;
  cuil: string | null;
  fecha_ingreso: string | null;
  antiguedad_anios: number | null;
  antiguedad_meses: number | null;
  ley_id: number | null;
  ley_nombre: string | null;
  servicio_id: number;
  servicio_nombre: string;
  reparticion_id: number | null;
  reparticion_nombre: string | null;
  dependencia_id: number | null;
  dependencia_nombre: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  estado_pase: 'ACTIVO' | 'CERRADO';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return String(val); }
}

function antiguedadTexto(anios: number | null, meses: number | null): string {
  if (anios === null && meses === null) return '—';
  const a = anios ?? 0;
  const m = meses !== null ? meses % 12 : 0;
  if (a === 0 && m === 0) return 'Menos de 1 mes';
  if (a === 0) return `${m} mes${m !== 1 ? 'es' : ''}`;
  if (m === 0) return `${a} año${a !== 1 ? 's' : ''}`;
  return `${a} año${a !== 1 ? 's' : ''} ${m} mes${m !== 1 ? 'es' : ''}`;
}

// ─── Colores y estilos ExcelJS ────────────────────────────────────────────────

const COLOR_HEADER_SHEET  = '1F3864'; // azul oscuro — cabecera de columnas
const COLOR_SERVICIO_BG   = '2E75B6'; // azul medio — fila de grupo servicio
const COLOR_SECTOR_BG     = 'D6E4F0'; // azul claro  — fila de grupo sector
const COLOR_ROW_ALT       = 'F0F7FF'; // fondo filas alternas
const COLOR_TOTAL_BG      = 'E2EFDA'; // verde claro — totales

function applyHeaderStyle(row: ExcelJS.Row, bgHex: string, fgHex = 'FFFFFF') {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
    cell.font = { bold: true, color: { argb: `FF${fgHex}` }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
    };
  });
}

function applySectorStyle(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_SECTOR_BG}` } };
    cell.font = { bold: true, color: { argb: 'FF1F3864' }, size: 10, italic: true };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

function applyDataStyle(row: ExcelJS.Row, alt: boolean) {
  row.eachCell(cell => {
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: alt ? `FF${COLOR_ROW_ALT}` : 'FFFFFFFF' },
    };
    cell.font = { size: 10 };
    cell.alignment = { vertical: 'middle' };
  });
}

function applyTotalStyle(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_TOTAL_BG}` } };
    cell.font = { bold: true, size: 10 };
    cell.alignment = { vertical: 'middle' };
  });
}

// ─── Construcción del Excel ───────────────────────────────────────────────────

async function buildExcel(rows: AntiguedadRow[], filtros: Record<string, string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  wb.creator   = 'Sistema de Gestión de Personal';
  wb.created   = new Date();
  wb.modified  = new Date();

  // ── Hoja 1: Detalle por servicio y sector ──────────────────────────────────
  const wsDetalle = wb.addWorksheet('Antigüedad por Servicio', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
  });

  const COLS = [
    { header: 'DNI',          key: 'dni',           width: 12 },
    { header: 'Apellido',     key: 'apellido',       width: 22 },
    { header: 'Nombre',       key: 'nombre',         width: 20 },
    { header: 'CUIL',         key: 'cuil',           width: 15 },
    { header: 'Ley',          key: 'ley',            width: 22 },
    { header: 'Fecha Ingreso',key: 'fecha_ingreso',  width: 16 },
    { header: 'Antigüedad',   key: 'antiguedad',     width: 20 },
    { header: 'Años',         key: 'anios',          width: 8  },
    { header: 'Desde',        key: 'desde',          width: 14 },
    { header: 'Hasta',        key: 'hasta',          width: 14 },
    { header: 'Estado',       key: 'estado',         width: 10 },
  ];

  // Fila 1: título principal
  wsDetalle.mergeCells('A1:K1');
  const titleCell = wsDetalle.getCell('A1');
  titleCell.value = 'REPORTE DE ANTIGÜEDAD DE AGENTES POR SERVICIO Y SECTOR';
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsDetalle.getRow(1).height = 28;

  // Fila 2: fecha de emisión y filtros aplicados
  wsDetalle.mergeCells('A2:K2');
  const subtitleCell = wsDetalle.getCell('A2');
  const filtroDesc = Object.entries(filtros).map(([k, v]) => `${k}: ${v}`).join(' | ');
  subtitleCell.value = `Emitido: ${new Date().toLocaleDateString('es-AR')}   ${filtroDesc}`;
  subtitleCell.font = { italic: true, size: 10, color: { argb: 'FF555555' } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsDetalle.getRow(2).height = 18;

  // Fila 3: vacía (separador)
  wsDetalle.getRow(3).height = 6;

  // Fila 4: cabecera de columnas
  wsDetalle.columns = COLS;
  const headerRow = wsDetalle.getRow(4);
  COLS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
  });
  headerRow.height = 22;
  applyHeaderStyle(headerRow, COLOR_HEADER_SHEET);

  // Datos agrupados por servicio → sector
  const byServicio = new Map<string, Map<string, AntiguedadRow[]>>();
  for (const r of rows) {
    const srvKey  = `${r.servicio_id}||${r.servicio_nombre}`;
    const depKey  = r.dependencia_nombre || 'Sin sector asignado';
    if (!byServicio.has(srvKey)) byServicio.set(srvKey, new Map());
    const bySector = byServicio.get(srvKey)!;
    if (!bySector.has(depKey)) bySector.set(depKey, []);
    bySector.get(depKey)!.push(r);
  }

  let dataRowCount = 0;

  for (const [srvKey, sectorMap] of byServicio) {
    const srvNombre = srvKey.split('||')[1];
    const srvTotal  = [...sectorMap.values()].reduce((acc, a) => acc + a.length, 0);

    // Fila de grupo: SERVICIO
    const srvRow = wsDetalle.addRow([
      `▶ SERVICIO: ${srvNombre}`, '', '', '', '', '', '', '', '', '', `Total: ${srvTotal}`,
    ]);
    wsDetalle.mergeCells(`A${srvRow.number}:J${srvRow.number}`);
    srvRow.height = 20;
    srvRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_SERVICIO_BG}` } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    // celda K (Total) separada del merge
    const totalCell = srvRow.getCell(11);
    totalCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_SERVICIO_BG}` } };
    totalCell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    totalCell.alignment = { horizontal: 'right', vertical: 'middle' };

    for (const [secNombre, secRows] of sectorMap) {
      // Fila de grupo: SECTOR
      const secRow = wsDetalle.addRow([
        `  ⬛ Sector: ${secNombre}`, '', '', '', '', '', '', '', '', '', `(${secRows.length})`,
      ]);
      wsDetalle.mergeCells(`A${secRow.number}:J${secRow.number}`);
      secRow.height = 18;
      applySectorStyle(secRow);
      const secTotal = secRow.getCell(11);
      secTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_SECTOR_BG}` } };
      secTotal.font = { bold: true, color: { argb: 'FF1F3864' }, size: 10 };
      secTotal.alignment = { horizontal: 'right', vertical: 'middle' };

      let alt = false;
      for (const ag of secRows) {
        const dataRow = wsDetalle.addRow([
          ag.dni,
          ag.apellido,
          ag.nombre,
          ag.cuil || '—',
          ag.ley_nombre || '—',
          fmtDate(ag.fecha_ingreso),
          antiguedadTexto(ag.antiguedad_anios, ag.antiguedad_meses),
          ag.antiguedad_anios ?? '—',
          fmtDate(ag.fecha_desde),
          ag.fecha_hasta ? fmtDate(ag.fecha_hasta) : 'Sin cierre',
          ag.estado_pase,
        ]);
        dataRow.height = 16;
        applyDataStyle(dataRow, alt);
        // Estado: color semáforo
        const estadoCell = dataRow.getCell(11);
        estadoCell.font = {
          bold: true, size: 10,
          color: { argb: ag.estado_pase === 'ACTIVO' ? 'FF1A7F3C' : 'FF888888' },
        };
        alt = !alt;
        dataRowCount++;
      }

      // Subtotal sector
      const stRow = wsDetalle.addRow([
        `  Subtotal ${secNombre}:`, '', '', '', '', '',
        `Promedio antigüedad: ${calcPromedio(secRows)} años`, '', '', '', `${secRows.length} agentes`,
      ]);
      wsDetalle.mergeCells(`A${stRow.number}:F${stRow.number}`);
      wsDetalle.mergeCells(`G${stRow.number}:J${stRow.number}`);
      stRow.height = 16;
      applyTotalStyle(stRow);
    }

    // Separador visual entre servicios
    const sepRow = wsDetalle.addRow([]);
    sepRow.height = 8;
  }

  // ── Hoja 2: Resumen por servicio y sector ─────────────────────────────────
  const wsResumen = wb.addWorksheet('Resumen', {
    pageSetup: { orientation: 'portrait' },
  });

  wsResumen.mergeCells('A1:F1');
  const rTitleCell = wsResumen.getCell('A1');
  rTitleCell.value = 'RESUMEN: Agentes por Servicio y Sector';
  rTitleCell.font = { bold: true, size: 13, color: { argb: 'FF1F3864' } };
  rTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsResumen.getRow(1).height = 26;

  wsResumen.mergeCells('A2:F2');
  wsResumen.getCell('A2').value = `Total de registros: ${rows.length} | Emitido: ${new Date().toLocaleDateString('es-AR')}`;
  wsResumen.getCell('A2').font = { italic: true, size: 10 };
  wsResumen.getCell('A2').alignment = { horizontal: 'center' };
  wsResumen.getRow(2).height = 16;

  wsResumen.getRow(3).height = 8;

  wsResumen.columns = [
    { key: 'a', width: 35 },
    { key: 'b', width: 32 },
    { key: 'c', width: 12 },
    { key: 'd', width: 12 },
    { key: 'e', width: 12 },
    { key: 'f', width: 18 },
  ];

  const rHeader = wsResumen.addRow(['Servicio', 'Sector', 'Total', 'Activos', 'Cerrados', 'Promedio Antigüedad']);
  rHeader.height = 20;
  applyHeaderStyle(rHeader, COLOR_HEADER_SHEET);

  for (const [srvKey, sectorMap] of byServicio) {
    const srvNombre = srvKey.split('||')[1];
    const allSrvRows = [...sectorMap.values()].flat();

    const srvSumRow = wsResumen.addRow([
      srvNombre, 'TOTAL DEL SERVICIO',
      allSrvRows.length,
      allSrvRows.filter(r => r.estado_pase === 'ACTIVO').length,
      allSrvRows.filter(r => r.estado_pase === 'CERRADO').length,
      `${calcPromedio(allSrvRows)} años`,
    ]);
    srvSumRow.height = 18;
    srvSumRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FFD9E1F2` } };
      cell.font = { bold: true, size: 10 };
      cell.alignment = { vertical: 'middle' };
    });

    for (const [secNombre, secRows] of sectorMap) {
      const secSumRow = wsResumen.addRow([
        '', secNombre,
        secRows.length,
        secRows.filter(r => r.estado_pase === 'ACTIVO').length,
        secRows.filter(r => r.estado_pase === 'CERRADO').length,
        `${calcPromedio(secRows)} años`,
      ]);
      secSumRow.height = 16;
      secSumRow.eachCell(cell => {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle' };
      });
    }
  }

  // Total general al final del resumen
  const grandTotalRow = wsResumen.addRow([
    'TOTAL GENERAL', '',
    rows.length,
    rows.filter(r => r.estado_pase === 'ACTIVO').length,
    rows.filter(r => r.estado_pase === 'CERRADO').length,
    `${calcPromedio(rows)} años`,
  ]);
  grandTotalRow.height = 20;
  grandTotalRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF1F3864` } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle' };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function calcPromedio(rows: AntiguedadRow[]): string {
  const withData = rows.filter(r => r.antiguedad_anios !== null);
  if (!withData.length) return '—';
  const avg = withData.reduce((s, r) => s + (r.antiguedad_anios ?? 0), 0) / withData.length;
  return avg.toFixed(1);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function buildAntiguedadRouter(sequelize: Sequelize): Router {
  const router = Router();

  /**
   * GET /antiguedad/excel
   * Genera y descarga el reporte Excel de antigüedad.
   */
  router.get('/excel', async (req: Request, res: Response) => {
    try {
      const soloActivos   = req.query.solo_activos   !== '0';
      const servicioId    = req.query.servicio_id    ? Number(req.query.servicio_id)    : null;
      const dependenciaId = req.query.dependencia_id ? Number(req.query.dependencia_id) : null;
      const reparticionId = req.query.reparticion_id ? Number(req.query.reparticion_id) : null;
      const leyId         = req.query.ley_id         ? Number(req.query.ley_id)         : null;

      const whereParts: string[] = ['ags.deleted_at IS NULL', 'p.deleted_at IS NULL'];
      const repl: Record<string, unknown> = {};

      if (soloActivos)   { whereParts.push('ags.fecha_hasta IS NULL'); }
      if (servicioId)    { whereParts.push('ags.servicio_id = :servicio_id');    repl.servicio_id    = servicioId; }
      if (dependenciaId) { whereParts.push('rep.dependencia_id = :dependencia_id'); repl.dependencia_id = dependenciaId; }
      if (reparticionId) { whereParts.push('srv.reparticion_id = :reparticion_id'); repl.reparticion_id = reparticionId; }
      if (leyId)         { whereParts.push('a.ley_id = :ley_id');                repl.ley_id         = leyId; }

      const whereSQL = whereParts.join(' AND ');

      const rows = await sequelize.query<AntiguedadRow>(`
        SELECT
          ags.id                                                         AS pase_id,
          p.dni,
          p.apellido,
          p.nombre,
          p.cuil,
          a.fecha_ingreso,
          TIMESTAMPDIFF(YEAR,  a.fecha_ingreso, CURDATE())               AS antiguedad_anios,
          TIMESTAMPDIFF(MONTH, a.fecha_ingreso, CURDATE())               AS antiguedad_meses,
          l.id                                                           AS ley_id,
          l.nombre                                                       AS ley_nombre,
          srv.id                                                         AS servicio_id,
          srv.nombre                                                     AS servicio_nombre,
          rep.id                                                         AS reparticion_id,
          rep.reparticion_nombre                                         AS reparticion_nombre,
          dep.id                                                         AS dependencia_id,
          dep.nombre                                                     AS dependencia_nombre,
          ags.fecha_desde,
          ags.fecha_hasta,
          CASE WHEN ags.fecha_hasta IS NULL THEN 'ACTIVO' ELSE 'CERRADO' END AS estado_pase
        FROM agentes_servicios ags
        JOIN personal p   ON p.dni = ags.dni AND p.deleted_at IS NULL
        JOIN agentes a    ON a.id  = (
          SELECT id FROM agentes
          WHERE dni = ags.dni AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 1
        )
        LEFT JOIN ley l   ON l.id  = a.ley_id  AND l.deleted_at IS NULL
        JOIN servicios srv ON srv.id = ags.servicio_id
        LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id AND rep.deleted_at IS NULL
        LEFT JOIN dependencias  dep ON dep.id = rep.dependencia_id AND dep.deleted_at IS NULL
        WHERE ${whereSQL}
        ORDER BY srv.nombre ASC, rep.reparticion_nombre ASC, p.apellido ASC, p.nombre ASC
      `, { replacements: repl, type: QueryTypes.SELECT });

      if (!rows.length) {
        return res.status(404).json({ ok: false, error: 'Sin datos para los filtros seleccionados' });
      }

      // Descripción de filtros para el encabezado del Excel
      const filtroDesc: Record<string, string> = {};
      if (soloActivos)         filtroDesc['Estado'] = 'Solo activos';
      else                     filtroDesc['Estado'] = 'Todos';
      if (servicioId)          filtroDesc['Servicio']   = String(rows[0]?.servicio_nombre ?? servicioId);
      if (dependenciaId)       filtroDesc['Dependencia'] = String(rows[0]?.dependencia_nombre ?? dependenciaId);
      if (reparticionId)       filtroDesc['Repartición'] = String(rows[0]?.reparticion_nombre ?? reparticionId);
      if (leyId)               filtroDesc['Ley']        = String(rows[0]?.ley_nombre ?? leyId);

      const buffer = await buildExcel(rows, filtroDesc);

      const fecha  = new Date().toISOString().slice(0, 10);
      const fname  = `antiguedad_servicios_${fecha}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);

    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error generando reporte' });
    }
  });

  return router;
}
