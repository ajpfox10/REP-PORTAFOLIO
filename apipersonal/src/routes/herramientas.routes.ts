import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

type IngresoRow = {
  dni: number;
  apellido: string;
  nombre: string;
  legajo: number | null;
  fecha_ingreso: string | null;
  anio_ingreso: number | null;
  ley_id: number | null;
  ley_nombre: string | null;
  ocupacion_id: number | null;
  ocupacion_nombre: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
  sector_nombre: string | null;
  estado_empleo: string | null;
  antiguedad_anios?: number | null;
  antiguedad_meses?: number | null;
};

function intOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanDigits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function xmlEscape(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RUN_GAP =
  '(?:</w:t></w:r>(?:<w:[a-zA-Z]+[^>]*/>)*<w:r\\b[^>]*>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t[^>]*>)?';

function replacePlaceholderTolerante(xml: string, placeholder: string, valor: string): string {
  const pattern = placeholder
    .split('')
    .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(RUN_GAP);
  return xml.replace(new RegExp(pattern, 'g'), () => valor);
}

function replaceDocxMarkers(xml: string, replacements: Record<string, unknown>): string {
  for (const [marker, raw] of Object.entries(replacements)) {
    const value = xmlEscape(raw ?? '');
    xml = xml.split(marker).join(value);
    if (marker.length >= 3) xml = replacePlaceholderTolerante(xml, marker, value);
  }
  return xml;
}

function setTextInXmlElement(xml: string, text: unknown, fallbackRun?: string): string {
  let used = false;
  const value = xmlEscape(text);
  const replaced = xml.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, (match, attrs) => {
    if (used) return match.replace(/>[\s\S]*?</, '><');
    used = true;
    const nextAttrs = String(attrs || '').includes('xml:space=') ? attrs : `${attrs || ''} xml:space="preserve"`;
    return `<w:t${nextAttrs}>${value}</w:t>`;
  });
  if (used) return replaced;
  const run = fallbackRun
    ? setTextInXmlElement(fallbackRun, text)
    : `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
  if (/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/.test(xml)) {
    return xml.replace(/(<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>)/, `$1${run}`);
  }
  return xml.replace(/(<w:p(?:\s[^>]*)?>)/, `$1${run}`);
}

function replaceActaParagraph(xml: string, needle: string, text: string): string {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  const found = paragraphs.find(m => m[0].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').includes(needle));
  return found?.index == null ? xml : xml.slice(0, found.index) + setTextInXmlElement(found[0], text) + xml.slice(found.index + found[0].length);
}

function setActaRowCells(rowXml: string, values: unknown[]): string {
  const fallbackRun = rowXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/)?.[0];
  let cellIndex = 0;
  return rowXml.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g, cell => {
    if (cellIndex >= values.length) return cell;
    const value = values[cellIndex++];
    return setTextInXmlElement(cell, value ?? '', fallbackRun);
  });
}

function replaceActaTableRows(xml: string, index: number, rowsData: unknown[][], keepHeader = true): string {
  if (!rowsData.length) return xml;
  const tables = [...xml.matchAll(/<w:tbl[\s\S]*?<\/w:tbl>/g)];
  const found = tables[index];
  if (found?.index == null) return xml;
  const tableXml = found[0];
  const rows = [...tableXml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];
  if (!rows.length) return xml;
  const headerRows = keepHeader ? rows.slice(0, 1).map(r => r[0]) : [];
  const templateRows = rows.slice(keepHeader ? 1 : 0).map(r => r[0]);
  const modelRows = templateRows.length ? templateRows : [rows[rows.length - 1][0]];
  const firstRowIndex = rows[0].index ?? 0;
  const lastRow = rows[rows.length - 1];
  const lastRowEnd = (lastRow.index ?? 0) + lastRow[0].length;
  const prefix = tableXml.slice(0, firstRowIndex);
  const suffix = tableXml.slice(lastRowEnd);
  const dataRows = rowsData.map((row, idx) => setActaRowCells(modelRows[Math.min(idx, modelRows.length - 1)], row));
  const nextTable = `${prefix}${headerRows.join('')}${dataRows.join('')}${suffix}`;
  return xml.slice(0, found.index) + nextTable + xml.slice(found.index + tableXml.length);
}

function fmtActaDate(v: unknown): string {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Descompone una fecha YYYY-MM-DD en día / mes (nombre) / año para el formato "a los X días del mes de Y de Z"
function fmtActaFechaLarga(v: unknown): { dia: string; mes: string; anio: string } {
  const [y, m, d] = String(v ?? '').slice(0, 10).split('-');
  return {
    dia: d ? String(Number(d)) : '………',
    mes: m ? (MESES_ES[Number(m) - 1] ?? '………') : '………',
    anio: y || '……',
  };
}

function dependenciaTexto(servicio?: any): string {
  const base = `${servicio?.nombre ?? ''} ${servicio?.reparticion_nombre ?? ''} ${servicio?.servicio_nombre ?? ''} ${servicio?.dependencia_nombre ?? ''}`.toUpperCase();
  if (base.includes('UPA 4') || base.includes('UPA4')) return 'UNIDAD DE PRONTA ATENCION 4 N°(1699)';
  if (base.includes('UPA 18') || base.includes('UPA18')) return 'UNIDAD DE PRONTA ATENCION N°18(1826)';
  if (base.includes('HIGA') || base.includes('HTAL') || base.includes('HOSPITAL')) return 'HIGA SIMPLEMENTE EVITA';
  return String(servicio?.reparticion_nombre || servicio?.dependencia_nombre || servicio?.servicio_nombre || servicio?.nombre || '').trim();
}

function cleanActaText(v: unknown): string {
  return String(v ?? '').trim();
}

// Puntaje para el acta con separador decimal argentino (48.663 -> 48,663)
function fmtPuntaje(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v).replace('.', ',');
}

export function buildHerramientasRouter(sequelize: Sequelize): Router {
  const router = Router();
  const ensureConcursosFuncionesTables = (async () => {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS concursos_funciones_examenes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tipo VARCHAR(20) NOT NULL DEFAULT 'funciones',
        cargo VARCHAR(20) NULL,
        modalidad VARCHAR(20) NULL,
        nombre_cargo VARCHAR(250) NULL,
        tipo_unidad VARCHAR(30) NULL,
        servicio_id INT NULL,
        ocupacion_id INT NULL,
        regimen_horario_id INT NULL,
        regimen_horario VARCHAR(100) NULL,
        dependencia_texto VARCHAR(250) NULL,
        resolucion_llamado VARCHAR(150) NULL,
        disposicion_llamado VARCHAR(150) NULL,
        titulo VARCHAR(200) NOT NULL,
        fecha DATE NOT NULL,
        fecha_hasta DATE NULL,
        hora TIME NULL,
        lugar VARCHAR(250) NULL,
        ciudad VARCHAR(150) NULL,
        hospital VARCHAR(250) NULL,
        domicilio VARCHAR(250) NULL,
        hora_cierre TIME NULL,
        estado VARCHAR(30) NOT NULL DEFAULT 'BORRADOR',
        fecha_cierre DATETIME NULL,
        acta_observaciones TEXT NULL,
        cerrado_por INT NULL,
        observaciones TEXT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INT NULL,
        updated_at DATETIME NULL,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_cf_examenes_tipo (tipo),
        KEY idx_cf_examenes_fecha (fecha),
        KEY idx_cf_examenes_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS concursos_funciones_inscriptos (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        examen_id INT UNSIGNED NOT NULL,
        dni BIGINT NOT NULL,
        apellido VARCHAR(120) NULL,
        nombre VARCHAR(120) NULL,
        puntaje DECIMAL(10,3) NULL,
        orden_prelacion INT NULL,
        estado VARCHAR(30) NOT NULL DEFAULT 'INSCRIPTO',
        observaciones TEXT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_cf_inscripto (examen_id, dni),
        KEY idx_cf_inscriptos_dni (dni),
        CONSTRAINT fk_cf_inscriptos_examen
          FOREIGN KEY (examen_id) REFERENCES concursos_funciones_examenes(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS concursos_jurados (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        examen_id INT UNSIGNED NOT NULL,
        representacion VARCHAR(40) NOT NULL,
        dni BIGINT NULL,
        apellido_nombre VARCHAR(250) NOT NULL,
        profesion VARCHAR(200) NULL,
        especialidad VARCHAR(200) NULL,
        condicion VARCHAR(20) NOT NULL DEFAULT 'TITULAR',
        asistio TINYINT(1) NOT NULL DEFAULT 1,
        orden INT NOT NULL DEFAULT 0,
        observaciones TEXT NULL,
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INT NULL,
        updated_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_concursos_jurados_examen (examen_id),
        CONSTRAINT fk_concursos_jurados_examen
          FOREIGN KEY (examen_id) REFERENCES concursos_funciones_examenes(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Tablas creadas antes de existir la columna tipo: migración idempotente
    const tipoCol = await sequelize.query(
      "SHOW COLUMNS FROM concursos_funciones_examenes LIKE 'tipo'",
      { type: QueryTypes.SELECT },
    );
    if (!tipoCol.length) {
      await sequelize.query(`
        ALTER TABLE concursos_funciones_examenes
          ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'funciones' AFTER id,
          ADD KEY idx_cf_examenes_tipo (tipo)
      `);
    }
    // Cargo concursado en exámenes de funciones: 'sala' | 'servicio'
    const cargoCol = await sequelize.query(
      "SHOW COLUMNS FROM concursos_funciones_examenes LIKE 'cargo'",
      { type: QueryTypes.SELECT },
    );
    if (!cargoCol.length) {
      await sequelize.query(
        "ALTER TABLE concursos_funciones_examenes ADD COLUMN cargo VARCHAR(20) NULL AFTER tipo",
      );
    }
    // Postulantes externos (sin legajo en personal): nombre propio en el inscripto
    const apellidoCol = await sequelize.query(
      "SHOW COLUMNS FROM concursos_funciones_inscriptos LIKE 'apellido'",
      { type: QueryTypes.SELECT },
    );
    if (!apellidoCol.length) {
      await sequelize.query(`
        ALTER TABLE concursos_funciones_inscriptos
          ADD COLUMN apellido VARCHAR(120) NULL AFTER dni,
          ADD COLUMN nombre VARCHAR(120) NULL AFTER apellido
      `);
    }
    const ensureColumn = async (table: string, column: string, definition: string) => {
      const found = await sequelize.query(
        `SHOW COLUMNS FROM ${table} LIKE :column`,
        { replacements: { column }, type: QueryTypes.SELECT },
      );
      if (!found.length) await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    for (const [column, definition] of [
      ['modalidad', "VARCHAR(20) NULL AFTER cargo"],
      ['nombre_cargo', "VARCHAR(250) NULL AFTER modalidad"],
      ['tipo_unidad', "VARCHAR(30) NULL AFTER nombre_cargo"],
      ['servicio_id', "INT NULL AFTER tipo_unidad"],
      ['ocupacion_id', "INT NULL AFTER servicio_id"],
      ['regimen_horario_id', "INT NULL AFTER ocupacion_id"],
      ['regimen_horario', "VARCHAR(100) NULL AFTER regimen_horario_id"],
      ['dependencia_texto', "VARCHAR(250) NULL AFTER regimen_horario"],
      ['resolucion_llamado', "VARCHAR(150) NULL AFTER dependencia_texto"],
      ['disposicion_llamado', "VARCHAR(150) NULL AFTER tipo_unidad"],
      ['fecha_hasta', "DATE NULL AFTER fecha"],
      ['ciudad', "VARCHAR(150) NULL AFTER lugar"],
      ['hospital', "VARCHAR(250) NULL AFTER ciudad"],
      ['domicilio', "VARCHAR(250) NULL AFTER hospital"],
      ['hora_cierre', "TIME NULL AFTER domicilio"],
      ['estado', "VARCHAR(30) NOT NULL DEFAULT 'BORRADOR' AFTER hora_cierre"],
      ['fecha_cierre', "DATETIME NULL AFTER estado"],
      ['acta_observaciones', "TEXT NULL AFTER fecha_cierre"],
      ['cerrado_por', "INT NULL AFTER acta_observaciones"],
    ]) await ensureColumn('concursos_funciones_examenes', column, definition);
    for (const [column, definition] of [
      ['puntaje', "DECIMAL(10,3) NULL AFTER nombre"],
      ['orden_prelacion', "INT NULL AFTER puntaje"],
      ['estado', "VARCHAR(30) NOT NULL DEFAULT 'INSCRIPTO' AFTER orden_prelacion"],
      ['observaciones', "TEXT NULL AFTER estado"],
    ]) await ensureColumn('concursos_funciones_inscriptos', column, definition);
    // Puntaje con 3 decimales: tablas viejas se crearon con DECIMAL(10,2). ensureColumn no
    // modifica columnas existentes, así que ajustamos la precisión de forma idempotente.
    const puntajeCol = await sequelize.query<any>(
      "SHOW COLUMNS FROM concursos_funciones_inscriptos LIKE 'puntaje'",
      { type: QueryTypes.SELECT },
    );
    if (puntajeCol.length && !/decimal\(10,\s*3\)/i.test(String(puntajeCol[0]?.Type))) {
      await sequelize.query(
        'ALTER TABLE concursos_funciones_inscriptos MODIFY COLUMN puntaje DECIMAL(10,3) NULL',
      );
    }
  })();

  const tipoConcurso = (v: unknown): 'ingreso' | 'funciones' =>
    String(v ?? '').toLowerCase() === 'ingreso' ? 'ingreso' : 'funciones';

  const cargoConcurso = (v: unknown): 'sala' | 'servicio' | 'guardia' | 'unidad' | null => {
    const s = String(v ?? '').toLowerCase();
    return ['sala', 'servicio', 'guardia', 'unidad'].includes(s) ? s as any : null;
  };

  const modalidadConcurso = (
    tipo: 'ingreso' | 'funciones',
    cargo: 'sala' | 'servicio' | 'guardia' | 'unidad' | null
  ): 'ABIERTO' | 'CERRADO' => {
    if (tipo === 'ingreso') return 'ABIERTO';
    return cargo === 'servicio' ? 'ABIERTO' : 'CERRADO';
  };

  // Antigüedad mínima desde el pase a planta para inscribirse: sala >1 año, servicio >2
  const aniosMinimosCargo = (cargo: 'sala' | 'servicio' | 'guardia' | 'unidad' | null): number =>
    cargo === 'servicio' ? 2 : 1;

  // Fecha de pase a planta: titularización si está cargada, sino nombramiento
  const FECHA_PLANTA_SQL = 'COALESCE(a.fecha_de_tituralizacion, a.fecha_de_nombramiento)';

  const authUserId = (req: Request): number | null => {
    const raw = (req as any)?.auth?.principalId;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const loadServicioInfo = async (servicioId: number | null) => {
    if (!servicioId) return null;
    const [row] = await sequelize.query<any>(`
      SELECT
        s.id AS servicio_id,
        s.nombre AS servicio_nombre,
        r.id AS reparticion_id,
        r.reparticion_nombre,
        d.id AS dependencia_id,
        d.nombre AS dependencia_nombre
      FROM servicios s
      LEFT JOIN reparticiones r ON r.id = s.reparticion_id AND r.deleted_at IS NULL
      LEFT JOIN dependencias d ON d.id = r.dependencia_id AND d.deleted_at IS NULL
      WHERE s.id=:servicioId AND s.deleted_at IS NULL
      LIMIT 1
    `, { replacements: { servicioId }, type: QueryTypes.SELECT });
    return row || null;
  };

  const loadDependenciaInfo = async (dependenciaId: number | null) => {
    if (!dependenciaId) return null;
    const [row] = await sequelize.query<any>(`
      SELECT id, nombre
      FROM dependencias
      WHERE id=:dependenciaId AND deleted_at IS NULL
      LIMIT 1
    `, { replacements: { dependenciaId }, type: QueryTypes.SELECT });
    return row || null;
  };

  const loadOcupacionInfo = async (ocupacionId: number | null) => {
    if (!ocupacionId) return null;
    const [row] = await sequelize.query<any>(`
      SELECT
        oc.id AS ocupacion_id,
        oc.nombre AS ocupacion_nombre,
        oc.regimen_horario_id,
        rh.nombre AS regimen_horario_nombre
      FROM ocupaciones oc
      LEFT JOIN regimenes_horarios rh ON rh.id = oc.regimen_horario_id AND rh.deleted_at IS NULL
      WHERE oc.id=:ocupacionId AND oc.deleted_at IS NULL
      LIMIT 1
    `, { replacements: { ocupacionId }, type: QueryTypes.SELECT });
    return row || null;
  };

  const loadActaData = async (id: number) => {
    await ensureConcursosFuncionesTables;
    const [examen] = await sequelize.query<any>(`
      SELECT e.*, DATE_FORMAT(e.fecha, '%Y-%m-%d') fecha_txt,
             DATE_FORMAT(e.fecha_hasta, '%Y-%m-%d') fecha_hasta_txt,
             TIME_FORMAT(e.hora_cierre, '%H:%i') hora_cierre_txt,
             s.nombre AS servicio_nombre,
             r.reparticion_nombre,
             d.nombre AS dependencia_nombre,
             oc.nombre AS ocupacion_nombre,
             rh.nombre AS regimen_horario_nombre
      FROM concursos_funciones_examenes e
      LEFT JOIN servicios s ON s.id = e.servicio_id AND s.deleted_at IS NULL
      LEFT JOIN reparticiones r ON r.id = s.reparticion_id AND r.deleted_at IS NULL
      LEFT JOIN dependencias d ON d.id = r.dependencia_id AND d.deleted_at IS NULL
      LEFT JOIN ocupaciones oc ON oc.id = e.ocupacion_id AND oc.deleted_at IS NULL
      LEFT JOIN regimenes_horarios rh ON rh.id = COALESCE(e.regimen_horario_id, oc.regimen_horario_id) AND rh.deleted_at IS NULL
      WHERE e.id=:id AND e.deleted_at IS NULL LIMIT 1
    `, { replacements: { id }, type: QueryTypes.SELECT });
    if (!examen) return null;
    const jurados = await sequelize.query<any>(`
      SELECT * FROM concursos_jurados WHERE examen_id=:id
      ORDER BY orden ASC, id ASC
    `, { replacements: { id }, type: QueryTypes.SELECT });
    const inscriptos = await sequelize.query<any>(`
      SELECT i.*, COALESCE(p.apellido, i.apellido) apellido, COALESCE(p.nombre, i.nombre) nombre
      FROM concursos_funciones_inscriptos i
      LEFT JOIN personal p ON p.dni=i.dni AND p.deleted_at IS NULL
      WHERE i.examen_id=:id
      ORDER BY i.orden_prelacion IS NULL, i.orden_prelacion ASC, i.puntaje DESC, apellido ASC, nombre ASC
    `, { replacements: { id }, type: QueryTypes.SELECT });
    return { examen, jurados, inscriptos };
  };

  const actaCargo = (e: any): string => {
    if (e.tipo === 'ingreso') return e.nombre_cargo || e.titulo;
    const cargo = ({ servicio: 'Jefe de Servicio', sala: 'Jefe de Sala', guardia: 'Jefe de Guardia', unidad: 'Jefe de Unidad' } as any)[e.cargo] || 'Función';
    const unidad = e.cargo === 'unidad' && e.tipo_unidad ? ` de ${String(e.tipo_unidad).toLowerCase()}` : '';
    return `${cargo}${unidad}: ${e.nombre_cargo || e.titulo}`;
  };

  const actaRepresentacion = (v: unknown): string => {
    const key = String(v || '').toUpperCase();
    return ({
      MINISTERIO: 'Ministerio de Salud',
      ESCALAFONADO_1: 'Escalafonado 1º',
      ESCALAFONADO_2: 'Escalafonado 2º',
      COLEGIO: 'Colegio profesional',
      GREMIO: 'Entidad gremial',
    } as any)[key] || String(v || '');
  };

  const juradoFor = (jurados: any[], representacion: string, fallbackIndex: number) =>
    jurados.find(j => String(j.representacion || '').toUpperCase() === representacion) || jurados[fallbackIndex] || {};

  const actaMarkers = (e: any, jurados: any[], inscriptos: any[]): Record<string, unknown> => {
    const f = fmtActaFechaLarga(e.fecha_txt);
    const presidente = juradoFor(jurados, 'MINISTERIO', 0);
    const escalafonado1 = juradoFor(jurados, 'ESCALAFONADO_1', 1);
    const escalafonado2 = juradoFor(jurados, 'ESCALAFONADO_2', 2);
    const colegio = juradoFor(jurados, 'COLEGIO', 3);
    const gremio = juradoFor(jurados, 'GREMIO', 4);
    const dependencia = cleanActaText(e.dependencia_texto) || dependenciaTexto(e);
    const regimen = cleanActaText(e.regimen_horario) || cleanActaText(e.regimen_horario_nombre);
    const cargo = actaCargo(e);
    const base: Record<string, unknown> = {
      '#TIPOCONCURSO#': String(e.modalidad || '').toUpperCase(),
      '#F#': f.dia,
      '#M#': f.mes,
      '#A#': f.anio,
      '#R#': cleanActaText(e.resolucion_llamado),
      '#D#': cleanActaText(e.disposicion_llamado),
      '#PR#': presidente.apellido_nombre || '',
      '#PRPR#': presidente.profesion || '',
      '#EPR#': presidente.especialidad || '',
      '#E1#': escalafonado1.apellido_nombre || '',
      '#PRE1#': escalafonado1.profesion || '',
      '#EE1#': escalafonado1.especialidad || '',
      '#E2#': escalafonado2.apellido_nombre || '',
      '#PRE2#': escalafonado2.profesion || '',
      '#EE2#': escalafonado2.especialidad || '',
      '#CP#': colegio.apellido_nombre || '',
      '#PRCP#': colegio.profesion || '',
      '#ECP#': colegio.especialidad || '',
      '#EG#': gremio.apellido_nombre || '',
      '#PREG#': gremio.profesion || '',
      '#EEG#': gremio.especialidad || '',
      '#CARGOLLAMADO#': cargo,
      '#CARGOLLAMADO"': cargo,
      '#DEPENDENCIA#': dependencia,
      '#LOCALIDAD#': 'GONZALEZ CATAN',
      '#REGIMENHORARIO#': regimen,
      '#HORA#': e.hora_cierre_txt || '',
    };
    for (let i = 1; i <= 5; i++) {
      const item = inscriptos[i - 1];
      base[`#CONCURSANTE${i}#`] = item ? `${item.apellido || ''}, ${item.nombre || ''}`.replace(/^,\s*/, '').trim() : '';
      base[`#PUNTAJE${i}#`] = fmtPuntaje(item?.puntaje);
    }
    return base;
  };

  const generateActaDocx = async (id: number): Promise<{ buffer: Buffer; filename: string; data: any } | null> => {
    const data = await loadActaData(id);
    if (!data) return null;
    const { examen: e, jurados, inscriptos } = data;
    const templateName = e.tipo === 'ingreso' ? 'CONCURSO DE INGRESO ACTA.docx' : 'CONCURSO DE FUNCIONES ACTA.docx';
    const prodPath = path.join(process.cwd(), 'templates', templateName);
    const devPath = path.join(process.cwd(), 'src', 'templates', templateName);
    const templatePath = fs.existsSync(prodPath) ? prodPath : devPath;
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Plantilla no encontrada: ${templateName}. Guarda el archivo de ingreso como .docx para poder reemplazar marcadores sin perder formato.`);
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Plantilla Word inválida');
    let xml = await docFile.async('string');
    const esIngreso = e.tipo === 'ingreso';
    const titulo = esIngreso
      ? `CONCURSO ${e.modalidad ? `${e.modalidad} ` : ''}DE INGRESO`
      : `CONCURSO ${e.modalidad || 'CERRADO'} DE FUNCIONES`;
    xml = replaceActaParagraph(xml, 'CONCURSO ABIERTO DE FUNCIONES', titulo);
    xml = replaceActaParagraph(xml, 'CONCURSO CERRADO DE FUNCIONES', titulo);
    if (esIngreso) {
      // Acta de ingreso: se respeta el texto de la plantilla (la de funciones) y SOLO se completan los datos.
      const blanco = '………………';
      const f = fmtActaFechaLarga(e.fecha_txt);
      xml = replaceActaParagraph(xml, 'En la ciudad de', `En la ciudad de ${e.ciudad || blanco}, en el Hospital ${e.hospital || blanco}, ubicado en la calle ${e.domicilio || blanco}, a los ${f.dia} días del mes de ${f.mes} de ${f.anio}, en el marco del proceso del llamado a concurso de ingreso establecido mediante ${e.disposicion_llamado || blanco}, se reúnen los integrantes del jurado:`);
      xml = replaceActaParagraph(xml, 'con el propósito de dejar establecido', `con el propósito de dejar establecido el orden de mérito definitivo, correspondiente al proceso de concurso de ingreso llevado a cabo para el cargo de ${actaCargo(e)}, el que seguidamente se indica:`);
      xml = replaceActaParagraph(xml, 'No siendo para más', `No siendo para más, y habiéndose cumplido con el objetivo de la reunión, se levanta la sesión, siendo las ${e.hora_cierre_txt || '………'} horas, previa firma y aclaración de los miembros del jurado como así también de los concursantes en prueba de lo actuado, dejando aclarado que la presente acta queda firme, consentida y sin apelación.`);
    } else {
      const rango = e.fecha_hasta_txt && e.fecha_hasta_txt !== e.fecha_txt
        ? `, correspondiente al período ${fmtActaDate(e.fecha_txt)} al ${fmtActaDate(e.fecha_hasta_txt)}`
        : `, con fecha ${fmtActaDate(e.fecha_txt)}`;
      xml = replaceActaParagraph(xml, 'En la ciudad de', `En la ciudad de ${e.ciudad || '........................'}, en el Hospital ${e.hospital || '........................'}, ubicado en ${e.domicilio || '........................'}${rango}, en el marco del llamado establecido mediante disposición ${e.disposicion_llamado || '........................'}, se reúnen los integrantes del jurado:`);
      xml = replaceActaParagraph(xml, 'con el propósito de dejar establecido', `Con el propósito de dejar establecido el orden de mérito definitivo correspondiente a ${actaCargo(e)}, se indica el siguiente orden de prelación:`);
      xml = replaceActaParagraph(xml, 'No siendo para más', `No siendo para más, y habiéndose cumplido con el objetivo de la reunión, se levanta la sesión siendo las ${e.hora_cierre_txt || '........'} horas, previa firma y aclaración de los miembros del jurado y concursantes, quedando la presente acta firme, consentida y sin apelación.`);
    }
    xml = replaceActaParagraph(xml, 'Observaciones:', `Observaciones: ${e.acta_observaciones || e.observaciones || ''}`);
    const juradoRows = jurados.map((j: any) => [actaRepresentacion(j.representacion), j.apellido_nombre, j.profesion || '', j.especialidad || '']);
    const prelacionRows = inscriptos.map((i: any, idx: number) => [i.orden_prelacion || idx + 1, `${i.apellido || ''}, ${i.nombre || ''}`, fmtPuntaje(i.puntaje)]);
    xml = replaceActaTableRows(xml, 0, juradoRows);
    xml = replaceActaTableRows(xml, 1, prelacionRows);
    zip.file('word/document.xml', xml);
    const safeDisp = String(e.disposicion_llamado || e.id).replace(/[^\w-]+/g, '_');
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), filename: `acta_concurso_${safeDisp}.docx`, data };
  };

  const generateActaDocxNumerales = async (id: number): Promise<{ buffer: Buffer; filename: string; data: any } | null> => {
    const data = await loadActaData(id);
    if (!data) return null;
    const { examen: e, jurados, inscriptos } = data;
    const templateName = e.tipo === 'ingreso' ? 'CONCURSO DE INGRESO ACTA.docx' : 'CONCURSO DE FUNCIONES ACTA.docx';
    const prodPath = path.join(process.cwd(), 'templates', templateName);
    const devPath = path.join(process.cwd(), 'src', 'templates', templateName);
    const templatePath = fs.existsSync(prodPath) ? prodPath : devPath;
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Plantilla no encontrada: ${templateName}. Guarda el archivo de ingreso como .docx para poder reemplazar marcadores sin perder formato.`);
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
    const markers = actaMarkers(e, jurados, inscriptos);
    const candidates = Object.keys(zip.files).filter(p =>
      p.startsWith('word/') &&
      p.endsWith('.xml') &&
      (p.includes('document.xml') || p.includes('header') || p.includes('footer'))
    );
    if (!candidates.length) throw new Error('Plantilla Word invalida');
    for (const p of candidates) {
      const f = zip.file(p);
      if (!f) continue;
      zip.file(p, replaceDocxMarkers(await f.async('string'), markers));
    }
    const safeDisp = String(e.disposicion_llamado || e.id).replace(/[^\w-]+/g, '_');
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), filename: `acta_concurso_${safeDisp}.docx`, data };
  };

  router.get('/ingresos', async (req: Request, res: Response) => {
    try {
      const servicioId = intOrNull(req.query.servicio_id);
      const ocupacionId = intOrNull(req.query.ocupacion_id);
      const dni = cleanDigits(req.query.dni);
      const q = String(req.query.q ?? '').trim();
      const where: string[] = [
        'p.deleted_at IS NULL',
        'a.deleted_at IS NULL',
        "a.estado_empleo = 'ACTIVO'",
        "(a.ley_id IN (4, 5) OR l.nombre LIKE '%10471%' OR l.nombre LIKE '%10.471%')",
        "(pl.id IS NULL OR pl.nombre = 'INTERINO')",
      ];
      const repl: Record<string, unknown> = {};

      if (servicioId) {
        where.push(`EXISTS (
          SELECT 1 FROM agentes_servicios ags_f
          WHERE ags_f.dni = p.dni
            AND ags_f.servicio_id = :servicioId
            AND ags_f.deleted_at IS NULL
            AND ags_f.fecha_hasta IS NULL
        )`);
        repl.servicioId = servicioId;
      }
      if (ocupacionId) { where.push('a.ocupacion_id = :ocupacionId'); repl.ocupacionId = ocupacionId; }
      if (dni) { where.push('p.dni = :dni'); repl.dni = Number(dni); }
      if (q) {
        where.push('(p.apellido LIKE :q OR p.nombre LIKE :q OR CONCAT(p.apellido, " ", p.nombre) LIKE :q)');
        repl.q = `%${q}%`;
      }

      const rows = await sequelize.query<IngresoRow>(`
        SELECT
          p.dni,
          p.apellido,
          p.nombre,
          a.legajo,
          DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
          YEAR(a.fecha_ingreso) AS anio_ingreso,
          l.id AS ley_id,
          l.nombre AS ley_nombre,
          oc.id AS ocupacion_id,
          oc.nombre AS ocupacion_nombre,
          (
            SELECT ags.servicio_id
            FROM agentes_servicios ags
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS servicio_id,
          (
            SELECT srv.nombre
            FROM agentes_servicios ags
            JOIN servicios srv ON srv.id = ags.servicio_id
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS servicio_nombre,
          (
            SELECT sec.nombre
            FROM agentes_servicios ags
            JOIN sectores sec ON sec.id = ags.sector_id
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS sector_nombre,
          a.estado_empleo
        FROM personal p
        JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
        LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
        LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
        LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
        WHERE ${where.join(' AND ')}
        ORDER BY a.fecha_ingreso ASC, p.apellido ASC, p.nombre ASC
      `, { replacements: repl, type: QueryTypes.SELECT });

      return res.json({ ok: true, data: rows, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando ingresos' });
    }
  });

  router.get('/concurso-funciones', async (req: Request, res: Response) => {
    try {
      const servicioId = intOrNull(req.query.servicio_id);
      const ocupacionId = intOrNull(req.query.ocupacion_id);
      const dni = cleanDigits(req.query.dni);
      const q = String(req.query.q ?? '').trim();
      const soloActivos = req.query.solo_activos !== '0';
      // 'sala' (>1 año de planta) | 'servicio' (>2 años de planta) | 'jurado' (>15 años de antigüedad)
      const modo = String(req.query.cargo ?? '').toLowerCase();

      const where: string[] = [
        'p.deleted_at IS NULL',
        'a.deleted_at IS NULL',
        'a.fecha_ingreso IS NOT NULL',
        "(a.ley_id IN (4, 5) OR l.nombre LIKE '%10471%' OR l.nombre LIKE '%10.471%')",
        // Solo titulares: planta PERMANENTE (aplica tanto a Planta como a Guardia de la 10471)
        "pl.nombre = 'PERMANENTE'",
      ];
      if (modo === 'jurado') {
        where.push('TIMESTAMPDIFF(YEAR, a.fecha_ingreso, CURDATE()) > 15');
      } else {
        const anios = aniosMinimosCargo(cargoConcurso(modo));
        where.push(`${FECHA_PLANTA_SQL} < DATE_SUB(CURDATE(), INTERVAL ${anios} YEAR)`);
      }
      const repl: Record<string, unknown> = {};

      if (soloActivos) where.push("(a.estado_empleo IS NULL OR a.estado_empleo = 'ACTIVO')");
      if (servicioId) {
        where.push(`EXISTS (
          SELECT 1 FROM agentes_servicios ags_f
          WHERE ags_f.dni = p.dni
            AND ags_f.servicio_id = :servicioId
            AND ags_f.deleted_at IS NULL
            AND ags_f.fecha_hasta IS NULL
        )`);
        repl.servicioId = servicioId;
      }
      if (ocupacionId) { where.push('a.ocupacion_id = :ocupacionId'); repl.ocupacionId = ocupacionId; }
      if (dni) { where.push('p.dni = :dni'); repl.dni = Number(dni); }
      if (q) {
        where.push('(p.apellido LIKE :q OR p.nombre LIKE :q OR CONCAT(p.apellido, " ", p.nombre) LIKE :q)');
        repl.q = `%${q}%`;
      }

      const rows = await sequelize.query<IngresoRow>(`
        SELECT
          p.dni,
          p.apellido,
          p.nombre,
          a.legajo,
          DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
          YEAR(a.fecha_ingreso) AS anio_ingreso,
          TIMESTAMPDIFF(YEAR, a.fecha_ingreso, CURDATE()) AS antiguedad_anios,
          TIMESTAMPDIFF(MONTH, a.fecha_ingreso, CURDATE()) AS antiguedad_meses,
          DATE_FORMAT(${FECHA_PLANTA_SQL}, '%Y-%m-%d') AS fecha_planta,
          TIMESTAMPDIFF(YEAR, ${FECHA_PLANTA_SQL}, CURDATE()) AS planta_anios,
          l.id AS ley_id,
          l.nombre AS ley_nombre,
          oc.id AS ocupacion_id,
          oc.nombre AS ocupacion_nombre,
          (
            SELECT ags.servicio_id
            FROM agentes_servicios ags
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS servicio_id,
          (
            SELECT srv.nombre
            FROM agentes_servicios ags
            JOIN servicios srv ON srv.id = ags.servicio_id
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS servicio_nombre,
          (
            SELECT sec.nombre
            FROM agentes_servicios ags
            JOIN sectores sec ON sec.id = ags.sector_id
            WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC
            LIMIT 1
          ) AS sector_nombre,
          a.estado_empleo
        FROM personal p
        JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
        JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
        LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
        LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
        WHERE ${where.join(' AND ')}
        ORDER BY a.fecha_ingreso ASC, p.apellido ASC, p.nombre ASC
      `, { replacements: repl, type: QueryTypes.SELECT });

      return res.json({ ok: true, data: rows, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando concurso de funciones' });
    }
  });

  router.get('/concurso-funciones/catalogos', async (_req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const [dependenciasRaw, servicios, ocupaciones, regimenes] = await Promise.all([
        sequelize.query<any>(`
          SELECT id, nombre
          FROM dependencias
          WHERE deleted_at IS NULL
          ORDER BY nombre ASC
        `, { type: QueryTypes.SELECT }),
        sequelize.query<any>(`
          SELECT
            s.id,
            s.nombre,
            r.reparticion_nombre,
            d.nombre AS dependencia_nombre
          FROM servicios s
          LEFT JOIN reparticiones r ON r.id = s.reparticion_id AND r.deleted_at IS NULL
          LEFT JOIN dependencias d ON d.id = r.dependencia_id AND d.deleted_at IS NULL
          WHERE s.deleted_at IS NULL
          ORDER BY r.reparticion_nombre ASC, s.nombre ASC
        `, { type: QueryTypes.SELECT }),
        sequelize.query<any>(`
          SELECT
            oc.id,
            oc.nombre,
            oc.regimen_horario_id,
            rh.nombre AS regimen_horario_nombre
          FROM ocupaciones oc
          LEFT JOIN regimenes_horarios rh ON rh.id = oc.regimen_horario_id AND rh.deleted_at IS NULL
          WHERE oc.deleted_at IS NULL
          ORDER BY oc.nombre ASC
        `, { type: QueryTypes.SELECT }),
        sequelize.query<any>(`
          SELECT id, nombre
          FROM regimenes_horarios
          WHERE deleted_at IS NULL
          ORDER BY nombre ASC
        `, { type: QueryTypes.SELECT }),
      ]);
      const dependencias = dependenciasRaw.map(d => ({ ...d, nombre_formal: dependenciaTexto(d) }));
      return res.json({ ok: true, data: { dependencias, servicios, ocupaciones, regimenes } });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando catalogos de concurso' });
    }
  });

  router.get('/concurso-funciones/examenes', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const rows = await sequelize.query<any>(`
        SELECT
          e.id,
          e.tipo,
          e.cargo,
          e.modalidad,
          e.nombre_cargo,
          e.tipo_unidad,
          e.servicio_id,
          s.nombre AS servicio_nombre,
          r.reparticion_nombre,
          e.ocupacion_id,
          oc.nombre AS ocupacion_nombre,
          e.regimen_horario_id,
          e.regimen_horario,
          ANY_VALUE(rh.nombre) AS regimen_horario_nombre,
          e.dependencia_texto,
          e.resolucion_llamado,
          e.disposicion_llamado,
          e.titulo,
          DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha,
          DATE_FORMAT(e.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
          TIME_FORMAT(e.hora, '%H:%i') AS hora,
          e.lugar,
          e.ciudad,
          e.hospital,
          e.domicilio,
          TIME_FORMAT(e.hora_cierre, '%H:%i') AS hora_cierre,
          e.estado,
          DATE_FORMAT(e.fecha_cierre, '%Y-%m-%d %H:%i:%s') AS fecha_cierre,
          e.acta_observaciones,
          e.observaciones,
          e.created_at,
          e.updated_at,
          COUNT(i.id) AS inscriptos_count
        FROM concursos_funciones_examenes e
        LEFT JOIN concursos_funciones_inscriptos i ON i.examen_id = e.id
        LEFT JOIN servicios s ON s.id = e.servicio_id AND s.deleted_at IS NULL
        LEFT JOIN reparticiones r ON r.id = s.reparticion_id AND r.deleted_at IS NULL
        LEFT JOIN ocupaciones oc ON oc.id = e.ocupacion_id AND oc.deleted_at IS NULL
        LEFT JOIN regimenes_horarios rh ON rh.id = COALESCE(e.regimen_horario_id, oc.regimen_horario_id) AND rh.deleted_at IS NULL
        WHERE e.deleted_at IS NULL AND e.tipo = :tipo
        GROUP BY e.id
        ORDER BY e.fecha ASC, e.hora ASC, e.id ASC
      `, { replacements: { tipo: tipoConcurso(req.query.tipo) }, type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando exámenes' });
    }
  });

  router.get('/concurso-funciones/alertas', async (_req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const rows = await sequelize.query<any>(`
        SELECT
          e.id,
          e.tipo,
          e.titulo,
          DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(e.hora, '%H:%i') AS hora,
          e.lugar,
          DATEDIFF(e.fecha, CURDATE()) AS dias,
          COUNT(i.id) AS inscriptos_count
        FROM concursos_funciones_examenes e
        LEFT JOIN concursos_funciones_inscriptos i ON i.examen_id = e.id
        WHERE e.deleted_at IS NULL
          AND DATEDIFF(e.fecha, CURDATE()) BETWEEN 0 AND 6
        GROUP BY e.id
        ORDER BY e.fecha ASC, e.hora ASC
      `, { type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando alertas' });
    }
  });

  router.post('/concurso-funciones/examenes', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const titulo = String(req.body?.titulo ?? '').trim();
      const fecha = String(req.body?.fecha ?? '').slice(0, 10);
      const fechaHasta = String(req.body?.fecha_hasta ?? '').slice(0, 10);
      const disposicion = String(req.body?.disposicion_llamado ?? '').trim();
      if (!titulo || !disposicion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ ok: false, error: 'Título, disposición del llamado y fecha desde son obligatorios' });
      }
      if (fechaHasta && (!/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta) || fechaHasta < fecha)) {
        return res.status(400).json({ ok: false, error: 'La fecha hasta debe ser igual o posterior a la fecha desde' });
      }
      const tipo = tipoConcurso(req.body?.tipo);
      const cargo = tipo === 'funciones' ? cargoConcurso(req.body?.cargo) ?? 'sala' : null;
      const modalidad = modalidadConcurso(tipo, cargo);
      const servicioId = tipo === 'funciones' ? intOrNull(req.body?.servicio_id) : null;
      const dependenciaId = intOrNull(req.body?.dependencia_id);
      const ocupacionId = intOrNull(req.body?.ocupacion_id);
      const [servicioInfo, dependenciaInfo, ocupacionInfo] = await Promise.all([
        loadServicioInfo(servicioId),
        loadDependenciaInfo(dependenciaId),
        loadOcupacionInfo(ocupacionId),
      ]);
      const regimenHorarioId = intOrNull(req.body?.regimen_horario_id) ?? intOrNull(ocupacionInfo?.regimen_horario_id);
      const regimenHorario = String(req.body?.regimen_horario ?? '').trim() || cleanActaText(ocupacionInfo?.regimen_horario_nombre) || null;
      const dependencia = String(req.body?.dependencia_texto ?? '').trim() || dependenciaTexto(dependenciaInfo) || dependenciaTexto(servicioInfo) || null;
      const nombreCargo = String(req.body?.nombre_cargo ?? '').trim() || cleanActaText(ocupacionInfo?.ocupacion_nombre) || null;
      const [result] = await sequelize.query(`
        INSERT INTO concursos_funciones_examenes
          (tipo, cargo, modalidad, nombre_cargo, tipo_unidad, servicio_id, ocupacion_id,
           regimen_horario_id, regimen_horario, dependencia_texto, resolucion_llamado, disposicion_llamado,
           titulo, fecha, fecha_hasta, hora, lugar, ciudad, hospital, domicilio,
           hora_cierre, estado, acta_observaciones, observaciones, created_by)
        VALUES (:tipo, :cargo, :modalidad, :nombreCargo, :tipoUnidad, :servicioId, :ocupacionId,
                :regimenHorarioId, :regimenHorario, :dependenciaTexto, :resolucion, :disposicion,
                :titulo, :fecha, :fechaHasta, :hora, :lugar, :ciudad, :hospital, :domicilio,
                :horaCierre, :estado, :actaObservaciones, :observaciones, :userId)
      `, {
        replacements: {
          tipo,
          cargo,
          modalidad,
          nombreCargo,
          tipoUnidad: String(req.body?.tipo_unidad ?? '').toUpperCase() || null,
          servicioId,
          ocupacionId,
          regimenHorarioId,
          regimenHorario,
          dependenciaTexto: dependencia,
          resolucion: String(req.body?.resolucion_llamado ?? '').trim() || null,
          disposicion,
          titulo,
          fecha,
          fechaHasta: fechaHasta || null,
          hora: req.body?.hora || null,
          lugar: String(req.body?.lugar ?? '').trim() || null,
          ciudad: String(req.body?.ciudad ?? '').trim() || 'GONZALEZ CATAN',
          hospital: String(req.body?.hospital ?? '').trim() || null,
          domicilio: String(req.body?.domicilio ?? '').trim() || null,
          horaCierre: req.body?.hora_cierre || null,
          estado: String(req.body?.estado ?? 'BORRADOR').toUpperCase(),
          actaObservaciones: String(req.body?.acta_observaciones ?? '').trim() || null,
          observaciones: String(req.body?.observaciones ?? '').trim() || null,
          userId: authUserId(req),
        },
      }) as any;
      return res.json({ ok: true, data: { id: result?.insertId ?? result } });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error creando examen' });
    }
  });

  router.put('/concurso-funciones/examenes/:id', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const titulo = String(req.body?.titulo ?? '').trim();
      const fecha = String(req.body?.fecha ?? '').slice(0, 10);
      const fechaHasta = String(req.body?.fecha_hasta ?? '').slice(0, 10);
      const disposicion = String(req.body?.disposicion_llamado ?? '').trim();
      if (!titulo || !disposicion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ ok: false, error: 'Título, disposición del llamado y fecha desde son obligatorios' });
      }
      if (fechaHasta && (!/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta) || fechaHasta < fecha)) {
        return res.status(400).json({ ok: false, error: 'La fecha hasta debe ser igual o posterior a la fecha desde' });
      }
      const tipo = tipoConcurso(req.body?.tipo);
      const cargo = cargoConcurso(req.body?.cargo);
      const modalidad = modalidadConcurso(tipo, cargo);
      const servicioId = tipo === 'funciones' ? intOrNull(req.body?.servicio_id) : null;
      const dependenciaId = intOrNull(req.body?.dependencia_id);
      const ocupacionId = intOrNull(req.body?.ocupacion_id);
      const [servicioInfo, dependenciaInfo, ocupacionInfo] = await Promise.all([
        loadServicioInfo(servicioId),
        loadDependenciaInfo(dependenciaId),
        loadOcupacionInfo(ocupacionId),
      ]);
      const regimenHorarioId = intOrNull(req.body?.regimen_horario_id) ?? intOrNull(ocupacionInfo?.regimen_horario_id);
      const regimenHorario = String(req.body?.regimen_horario ?? '').trim() || cleanActaText(ocupacionInfo?.regimen_horario_nombre) || null;
      const dependencia = String(req.body?.dependencia_texto ?? '').trim() || dependenciaTexto(dependenciaInfo) || dependenciaTexto(servicioInfo) || null;
      const nombreCargo = String(req.body?.nombre_cargo ?? '').trim() || cleanActaText(ocupacionInfo?.ocupacion_nombre) || null;
      await sequelize.query(`
        UPDATE concursos_funciones_examenes
        SET titulo=:titulo, fecha=:fecha, fecha_hasta=:fechaHasta, hora=:hora, lugar=:lugar,
            cargo=IF(tipo='funciones', COALESCE(:cargo, cargo), NULL),
            modalidad=:modalidad, nombre_cargo=:nombreCargo, tipo_unidad=:tipoUnidad,
            servicio_id=:servicioId, ocupacion_id=:ocupacionId, regimen_horario_id=:regimenHorarioId,
            regimen_horario=:regimenHorario, dependencia_texto=:dependenciaTexto,
            resolucion_llamado=:resolucion, disposicion_llamado=:disposicion, ciudad=:ciudad, hospital=:hospital,
            domicilio=:domicilio, hora_cierre=:horaCierre, estado=:estado,
            fecha_cierre=IF(:estado IN ('CERRADO','ACTA_DEFINITIVA'), COALESCE(fecha_cierre, NOW()), NULL),
            cerrado_por=IF(:estado IN ('CERRADO','ACTA_DEFINITIVA'), :userId, NULL),
            acta_observaciones=:actaObservaciones, observaciones=:observaciones,
            updated_by=:userId, updated_at=NOW()
        WHERE id=:id AND deleted_at IS NULL
      `, {
        replacements: {
          id: Number(req.params.id),
          cargo,
          modalidad,
          nombreCargo,
          tipoUnidad: String(req.body?.tipo_unidad ?? '').toUpperCase() || null,
          servicioId,
          ocupacionId,
          regimenHorarioId,
          regimenHorario,
          dependenciaTexto: dependencia,
          resolucion: String(req.body?.resolucion_llamado ?? '').trim() || null,
          disposicion,
          titulo,
          fecha,
          fechaHasta: fechaHasta || null,
          hora: req.body?.hora || null,
          lugar: String(req.body?.lugar ?? '').trim() || null,
          ciudad: String(req.body?.ciudad ?? '').trim() || 'GONZALEZ CATAN',
          hospital: String(req.body?.hospital ?? '').trim() || null,
          domicilio: String(req.body?.domicilio ?? '').trim() || null,
          horaCierre: req.body?.hora_cierre || null,
          estado: String(req.body?.estado ?? 'BORRADOR').toUpperCase(),
          actaObservaciones: String(req.body?.acta_observaciones ?? '').trim() || null,
          observaciones: String(req.body?.observaciones ?? '').trim() || null,
          userId: authUserId(req),
        },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error actualizando examen' });
    }
  });

  router.delete('/concurso-funciones/examenes/:id', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      await sequelize.query(`
        UPDATE concursos_funciones_examenes
        SET deleted_at=NOW(), updated_by=:userId, updated_at=NOW()
        WHERE id=:id AND deleted_at IS NULL
      `, { replacements: { id: Number(req.params.id), userId: authUserId(req) } });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error eliminando examen' });
    }
  });

  router.get('/concurso-funciones/examenes/:id/inscriptos', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const rows = await sequelize.query<any>(`
        SELECT
          i.id,
          i.examen_id,
          i.dni,
          i.created_at,
          COALESCE(p.apellido, i.apellido) AS apellido,
          COALESCE(p.nombre, i.nombre) AS nombre,
          (p.dni IS NULL) AS externo,
          i.puntaje,
          i.orden_prelacion,
          i.estado,
          i.observaciones,
          a.legajo,
          (
            SELECT srv.nombre
            FROM agentes_servicios ags
            JOIN servicios srv ON srv.id = ags.servicio_id
            WHERE ags.dni = i.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
            ORDER BY ags.id DESC LIMIT 1
          ) AS servicio_nombre
        FROM concursos_funciones_inscriptos i
        LEFT JOIN personal p ON p.dni = i.dni AND p.deleted_at IS NULL
        LEFT JOIN agentes a ON a.dni = i.dni AND a.deleted_at IS NULL
        WHERE i.examen_id = :id
        ORDER BY i.orden_prelacion IS NULL, i.orden_prelacion ASC, i.puntaje DESC, apellido ASC, nombre ASC, i.dni ASC
      `, { replacements: { id: Number(req.params.id) }, type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando inscriptos' });
    }
  });

  router.post('/concurso-funciones/examenes/:id/inscriptos', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const dni = cleanDigits(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI obligatorio' });
      const apellidoExt = String(req.body?.apellido ?? '').trim();
      const nombreExt = String(req.body?.nombre ?? '').trim();
      const [examen] = await sequelize.query<any>(
        'SELECT id, tipo, cargo FROM concursos_funciones_examenes WHERE id=:id AND deleted_at IS NULL LIMIT 1',
        { replacements: { id: Number(req.params.id) }, type: QueryTypes.SELECT },
      );
      if (!examen) return res.status(404).json({ ok: false, error: 'Examen no encontrado' });
      const [personal] = await sequelize.query<any>(
        'SELECT dni FROM personal WHERE dni=:dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni: Number(dni) }, type: QueryTypes.SELECT },
      );
      let externo = false;
      if (!personal) {
        // Postulante externo (sin legajo): requiere apellido y nombre, vale para ingreso y funciones
        if (!apellidoExt || !nombreExt) {
          return res.status(404).json({ ok: false, error: 'No existe un agente con ese DNI. Si es un postulante externo, completá apellido y nombre.' });
        }
        externo = true;
      } else if (tipoConcurso(examen.tipo) === 'funciones') {
        // Agente del hospital en concurso de funciones: titular 10471 + antigüedad desde el pase a planta
        const [titular] = await sequelize.query<any>(`
          SELECT a.id
          FROM agentes a
          JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
          LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
          WHERE a.dni = :dni AND a.deleted_at IS NULL
            AND (a.ley_id IN (4, 5) OR l.nombre LIKE '%10471%' OR l.nombre LIKE '%10.471%')
            AND pl.nombre = 'PERMANENTE'
          LIMIT 1
        `, { replacements: { dni: Number(dni) }, type: QueryTypes.SELECT });
        if (!titular) {
          return res.status(422).json({ ok: false, error: 'Solo pueden inscribirse agentes titulares (planta permanente) de la Ley 10471, ya sea Planta o Guardia' });
        }
        const cargo = cargoConcurso(examen.cargo);
        const anios = aniosMinimosCargo(cargo);
        const [antig] = await sequelize.query<any>(`
          SELECT
            DATE_FORMAT(${FECHA_PLANTA_SQL}, '%d/%m/%Y') AS fecha_planta,
            (${FECHA_PLANTA_SQL} < DATE_SUB(CURDATE(), INTERVAL :anios YEAR)) AS cumple
          FROM agentes a
          WHERE a.dni = :dni AND a.deleted_at IS NULL
          LIMIT 1
        `, { replacements: { dni: Number(dni), anios }, type: QueryTypes.SELECT });
        if (!antig?.fecha_planta) {
          return res.status(422).json({ ok: false, error: 'El agente no tiene cargada la fecha de pase a planta (nombramiento/titularización)' });
        }
        if (!Number(antig.cumple)) {
          const cargoNombre = cargo === 'servicio' ? 'Jefatura de Servicio' : 'Jefatura de Sala';
          return res.status(422).json({ ok: false, error: `Para ${cargoNombre} se requiere más de ${anios} año${anios > 1 ? 's' : ''} desde el pase a planta (pasó a planta el ${antig.fecha_planta})` });
        }
      }
      await sequelize.query(`
        INSERT INTO concursos_funciones_inscriptos (examen_id, dni, apellido, nombre, created_by)
        VALUES (:examenId, :dni, :apellido, :nombre, :userId)
      `, {
        replacements: {
          examenId: Number(req.params.id),
          dni: Number(dni),
          apellido: externo ? apellidoExt.toUpperCase() : null,
          nombre: externo ? nombreExt.toUpperCase() : null,
          userId: authUserId(req),
        },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      if (String(err?.message ?? '').includes('uq_cf_inscripto')) {
        return res.status(409).json({ ok: false, error: 'El agente ya está inscripto en este examen' });
      }
      return res.status(500).json({ ok: false, error: err?.message || 'Error inscribiendo agente' });
    }
  });

  router.delete('/concurso-funciones/examenes/:id/inscriptos/:dni', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      await sequelize.query(
        'DELETE FROM concursos_funciones_inscriptos WHERE examen_id=:id AND dni=:dni',
        { replacements: { id: Number(req.params.id), dni: Number(cleanDigits(req.params.dni)) } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error quitando inscripto' });
    }
  });

  router.put('/concurso-funciones/examenes/:id/inscriptos/:dni', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const puntajeRaw = req.body?.puntaje;
      const ordenRaw = req.body?.orden_prelacion;
      await sequelize.query(`
        UPDATE concursos_funciones_inscriptos
        SET puntaje=:puntaje, orden_prelacion=:orden, estado=:estado, observaciones=:observaciones
        WHERE examen_id=:id AND dni=:dni
      `, {
        replacements: {
          id: Number(req.params.id),
          dni: Number(cleanDigits(req.params.dni)),
          puntaje: puntajeRaw === '' || puntajeRaw == null ? null : Number(puntajeRaw),
          orden: ordenRaw === '' || ordenRaw == null ? null : Number(ordenRaw),
          estado: String(req.body?.estado ?? 'INSCRIPTO').toUpperCase(),
          observaciones: String(req.body?.observaciones ?? '').trim() || null,
        },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error actualizando resultado' });
    }
  });

  router.get('/concurso-funciones/examenes/:id/jurados', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const rows = await sequelize.query<any>(`
        SELECT id, examen_id, representacion, dni, apellido_nombre, profesion, especialidad,
               condicion, asistio, orden, observaciones
        FROM concursos_jurados
        WHERE examen_id=:id
        ORDER BY orden ASC, id ASC
      `, { replacements: { id: Number(req.params.id) }, type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando jurados' });
    }
  });

  router.post('/concurso-funciones/examenes/:id/jurados', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      const nombre = String(req.body?.apellido_nombre ?? '').trim();
      const representacion = String(req.body?.representacion ?? '').trim().toUpperCase();
      if (!nombre || !representacion) {
        return res.status(400).json({ ok: false, error: 'Representación y apellido/nombre son obligatorios' });
      }
      await sequelize.query(`
        INSERT INTO concursos_jurados
          (examen_id, representacion, dni, apellido_nombre, profesion, especialidad,
           condicion, asistio, orden, observaciones, created_by)
        VALUES
          (:examenId, :representacion, :dni, :nombre, :profesion, :especialidad,
           :condicion, :asistio, :orden, :observaciones, :userId)
      `, {
        replacements: {
          examenId: Number(req.params.id),
          representacion,
          dni: cleanDigits(req.body?.dni) ? Number(cleanDigits(req.body?.dni)) : null,
          nombre: nombre.toUpperCase(),
          profesion: String(req.body?.profesion ?? '').trim() || null,
          especialidad: String(req.body?.especialidad ?? '').trim() || null,
          condicion: String(req.body?.condicion ?? 'TITULAR').toUpperCase(),
          asistio: req.body?.asistio === false || req.body?.asistio === 0 ? 0 : 1,
          orden: intOrNull(req.body?.orden) ?? 0,
          observaciones: String(req.body?.observaciones ?? '').trim() || null,
          userId: authUserId(req),
        },
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error agregando jurado' });
    }
  });

  router.delete('/concurso-funciones/examenes/:id/jurados/:juradoId', async (req: Request, res: Response) => {
    try {
      await ensureConcursosFuncionesTables;
      await sequelize.query(
        'DELETE FROM concursos_jurados WHERE id=:juradoId AND examen_id=:id',
        { replacements: { id: Number(req.params.id), juradoId: Number(req.params.juradoId) } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error quitando jurado' });
    }
  });

  router.get('/concurso-funciones/examenes/:id/acta/preview', async (req: Request, res: Response) => {
    try {
      const result = await generateActaDocxNumerales(Number(req.params.id));
      if (!result) return res.status(404).send('<p>Concurso no encontrado</p>');
      const mammoth = await import('mammoth');
      const converted = await mammoth.convertToHtml({ buffer: result.buffer });
      return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><style>
        body{font-family:Georgia,serif;padding:32px 44px;color:#111;font-size:13px;line-height:1.55;max-width:900px;margin:auto}
        p{margin:0 0 12px} table{border-collapse:collapse;width:100%;margin:12px 0 20px}
        td,th{border:1px solid #555;padding:6px 8px;vertical-align:top} img{max-width:100%}
        @media print{body{padding:0}}
      </style></head><body>${converted.value}</body></html>`);
    } catch (err: any) {
      return res.status(500).send(`<p>Error generando vista previa: ${xmlEscape(err?.message || 'Error')}</p>`);
    }
  });

  router.get('/concurso-funciones/examenes/:id/acta/docx', async (req: Request, res: Response) => {
    try {
      const result = await generateActaDocxNumerales(Number(req.params.id));
      if (!result) return res.status(404).json({ ok: false, error: 'Concurso no encontrado' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(result.buffer);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error generando acta' });
    }
  });

  return router;
}
