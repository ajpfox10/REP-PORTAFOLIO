// ─────────────────────────────────────────────────────────────────────────────
// Nota de designación para GDEBA (nombramiento en Planta Permanente, Ley 10.430)
// para los agentes de una tanda de Trámites documentales.
//
// Datos por agente:
//   establecimiento → dependencia vigente (agentes_servicios); si no, la del último
//                     registro SIAPE (historial.dependencia HOSPITAL / UPA 4 / UPA 18)
//   tratamiento     → personal.sexo_id (1 = Sr., 2 = Sra.)
//   horas           → horasSemanalesAgente (misma regla que los certificados)
//   cargo           → nombre de la ocupación (decisión del usuario 11/11/2026; el
//                     nomenclador todavía no está asignado)
//   agrupamiento / categoría → último registro SIAPE con agrupamiento (historial);
//                     sin categoría: 8 si es PROFESIONAL, 5 el resto.
// Plantilla: src/templates/nota_designacion_gdeba.docx (hecha desde
// D:\G\NOTA DE DESIGNACION.docx con marcadores {{...}}).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { QueryTypes, Sequelize } from 'sequelize';
import JSZip from 'jszip';
import { fillDocxTemplate } from '../routes/certificados.routes';
import { horasSemanalesAgente } from './cargaHoraria';

export const NOTA_DESIG_SUBCARPETA = 'Nota designacion GDEBA';

// Misma DDL que las migraciones 118 + 120: así en prod las tablas se crean solas al
// primer uso (patrón runtime del proyecto).
const ensured = new WeakSet<Sequelize>();
export async function ensureNotaDesignacionTable(sequelize: Sequelize): Promise<void> {
  if (ensured.has(sequelize)) return;
  await sequelize.query(`CREATE TABLE IF NOT EXISTS tramites_nota_designacion (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tanda VARCHAR(80) NOT NULL,
  dni INT NOT NULL,
  tratamiento VARCHAR(10) NOT NULL,
  apellido_nombre VARCHAR(200) NOT NULL,
  establecimiento VARCHAR(150) NOT NULL,
  ley VARCHAR(20) NOT NULL DEFAULT '10.430',
  horas VARCHAR(10) NOT NULL,
  cargo VARCHAR(200) NOT NULL,
  agrupamiento VARCHAR(60) NOT NULL,
  categoria VARCHAR(10) NOT NULL,
  texto TEXT NOT NULL,
  texto_editado TINYINT(1) NOT NULL DEFAULT 0,
  archivo VARCHAR(500) NULL,
  estado ENUM('GENERADA','ENVIADA_FIRMA','FIRMADA','ERROR') NOT NULL DEFAULT 'GENERADA',
  gdeba_numero VARCHAR(80) NULL,
  gdeba_error VARCHAR(500) NULL,
  enviada_at DATETIME NULL,
  firmada_at DATETIME NULL,
  estado_at DATETIME NULL,
  estado_por INT NULL,
  generada_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generada_por INT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nota_desig_tanda_dni (tanda, dni),
  KEY ix_nota_desig_estado (estado),
  CONSTRAINT fk_nota_desig_personal FOREIGN KEY (dni) REFERENCES personal (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS tramites_nota_designacion_plantilla (
  tanda VARCHAR(80) NOT NULL PRIMARY KEY,
  plantilla TEXT NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensured.add(sequelize);
}

export type NotaDesignacionDatos = {
  dni: number;
  tratamiento: string;
  apellidoNombre: string;
  artEstab: string;
  establecimiento: string;
  ley: string;
  horas: string;
  cargo: string;
  agrupamiento: string;
  categoria: string;
  faltan: string[];
};

const ESTAB: Record<'HTAL' | 'UPA4' | 'UPA18', { art: string; nombre: string }> = {
  HTAL: { art: 'el hospital', nombre: 'HIGA SIMPLEMENTE EVITA' },
  UPA4: { art: 'la', nombre: 'UNIDAD DE PRONTA ATENCIÓN N°4 (1699)' },
  UPA18: { art: 'la', nombre: 'UNIDAD DE PRONTA ATENCIÓN N°18 (1826)' },
};

function estabDe(nombre: string | null | undefined): keyof typeof ESTAB | null {
  const s = String(nombre || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (s.includes('UPA18') || s.includes('PRONTAATENCIONN18')) return 'UPA18';
  if (s.includes('UPA4') || s.includes('PRONTAATENCIONN4')) return 'UPA4';
  if (s.includes('HIGA') || s.includes('HOSPITAL') || s.includes('EVITA')) return 'HTAL';
  return null;
}

const upper = (v: unknown) => String(v ?? '').trim().toLocaleUpperCase('es-AR');

/** Datos de la nota para un agente (sin tocar disco). */
export async function datosNotaDesignacion(sequelize: Sequelize, dni: number, dependenciaVigente?: string | null): Promise<NotaDesignacionDatos> {
  const [p] = await sequelize.query<any>(
    `SELECT p.apellido, p.nombre, p.sexo_id,
            (SELECT oc.nombre FROM agentes a
               LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
              WHERE a.dni = p.dni AND a.deleted_at IS NULL
              ORDER BY (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC
              LIMIT 1) AS ocupacion
       FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  const [h] = await sequelize.query<any>(
    `SELECT agrupamiento, categoria_salarial, dependencia FROM historial
      WHERE dni = :dni AND agrupamiento IS NOT NULL AND agrupamiento <> ''
      ORDER BY fecha_desde DESC, id DESC LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  const horas = await horasSemanalesAgente(sequelize, dni);

  const faltan: string[] = [];
  const est = estabDe(dependenciaVigente) || estabDe(h?.dependencia);
  if (!est) faltan.push('establecimiento');
  const tratamiento = Number(p?.sexo_id) === 2 ? 'Sra.' : Number(p?.sexo_id) === 1 ? 'Sr.' : '';
  if (!tratamiento) faltan.push('sexo');
  const apellidoNombre = upper(`${p?.apellido ?? ''} ${p?.nombre ?? ''}`);
  if (!p) faltan.push('persona');
  const cargo = upper(p?.ocupacion);
  if (!cargo) faltan.push('cargo (ocupación)');
  const agrupamiento = upper(h?.agrupamiento);
  if (!agrupamiento) faltan.push('agrupamiento');
  let categoria = String(h?.categoria_salarial ?? '').trim();
  if (!categoria && agrupamiento) categoria = agrupamiento.startsWith('PROFESIONAL') ? '8' : '5';
  if (!categoria) faltan.push('categoría');
  if (!horas.horas) faltan.push('horas');

  return {
    dni,
    tratamiento,
    apellidoNombre,
    artEstab: est ? ESTAB[est].art : '',
    establecimiento: est ? ESTAB[est].nombre : '',
    ley: '10.430',
    horas: horas.horas,
    cargo,
    agrupamiento,
    categoria,
    faltan,
  };
}

const alTratamiento = (t: string) => (t === 'Sra.' ? 'a la Sra.' : 'al Sr.');

/** Marcadores que acepta la plantilla de la tanda (los ve el usuario en el panel). */
export const MARCADORES_NOTA: Array<{ clave: string; descripcion: string }> = [
  { clave: '{APELLIDO_NOMBRE}', descripcion: 'Apellido y nombre en mayúsculas' }, // sync-guard:ignore
  { clave: '{DNI}', descripcion: 'Número de DNI' }, // sync-guard:ignore
  { clave: '{AL_TRATAMIENTO}', descripcion: '"al Sr." / "a la Sra."' }, // sync-guard:ignore
  { clave: '{TRATAMIENTO}', descripcion: '"Sr." / "Sra."' }, // sync-guard:ignore
  { clave: '{ART_ESTAB}', descripcion: '"el hospital" / "la"' }, // sync-guard:ignore
  { clave: '{ESTABLECIMIENTO}', descripcion: 'HIGA SIMPLEMENTE EVITA / UNIDAD DE PRONTA ATENCIÓN N°4 (1699) / N°18 (1826)' }, // sync-guard:ignore
  { clave: '{LEY}', descripcion: '10.430' }, // sync-guard:ignore
  { clave: '{HORAS}', descripcion: 'Horas semanales (48 / 36)' }, // sync-guard:ignore
  { clave: '{CARGO}', descripcion: 'Cargo (ocupación)' }, // sync-guard:ignore
  { clave: '{AGRUPAMIENTO}', descripcion: 'Agrupamiento SIAPE' }, // sync-guard:ignore
  { clave: '{CATEGORIA}', descripcion: 'Categoría' }, // sync-guard:ignore
];

/** Texto modelo (el de la nota original del usuario) cuando la tanda no tiene uno propio. */
export const PLANTILLA_NOTA_DEFAULT = [
  'DIRECCIÓN PROVINCIAL DE HOSPITALES',
  'Sr./Sra. Director/a Provincial',
  '',
  'Me dirijo a usted con el fin de solicitar la designación en la Planta Permanente para desempeñar funciones en {ART_ESTAB} {ESTABLECIMIENTO} {AL_TRATAMIENTO}:',
  '',
  'APELLIDO Y NOMBRE COMPLETO: {APELLIDO_NOMBRE}',
  'TIPO Y NUMERO DE DOCUMENTO DE IDENTIDAD: DNI {DNI}',
  'REGIMEN ESTATUTARIO Y ESCALAFONARIO: LEY N° {LEY}',
  'REGIMEN HORARIO: {HORAS} HS SEMANALES DE LABOR PLANTA',
  'CARGO: {CARGO}',
  'AGRUPAMIENTO: {AGRUPAMIENTO}',
  'CATEGORIA: {CATEGORIA}',
].join('\n');

/** Reemplaza los marcadores de la plantilla con los datos del agente. */
export function aplicarPlantilla(plantilla: string, d: NotaDesignacionDatos): string {
  const v: Record<string, string> = {
    APELLIDO_NOMBRE: d.apellidoNombre, DNI: String(d.dni), AL_TRATAMIENTO: alTratamiento(d.tratamiento),
    TRATAMIENTO: d.tratamiento, ART_ESTAB: d.artEstab, ESTABLECIMIENTO: d.establecimiento, LEY: d.ley,
    HORAS: d.horas, CARGO: d.cargo, AGRUPAMIENTO: d.agrupamiento, CATEGORIA: d.categoria,
  };
  return plantilla.replace(/\r\n/g, '\n').replace(/\{([A-Z_]+)\}/g, (m, k) => (k in v ? v[k] : m));
}

/** Texto plano de la nota con el modelo original (lo que el robot pega en GDEBA). */
export function textoNotaDesignacion(d: NotaDesignacionDatos): string {
  return aplicarPlantilla(PLANTILLA_NOTA_DEFAULT, d);
}

/** Plantilla vigente de la tanda (la propia o el modelo original). */
export async function plantillaDeTanda(sequelize: Sequelize, tanda: string): Promise<{ plantilla: string; propia: boolean }> {
  await ensureNotaDesignacionTable(sequelize);
  const [r] = await sequelize.query<any>(
    'SELECT plantilla FROM tramites_nota_designacion_plantilla WHERE tanda = :tanda',
    { replacements: { tanda }, type: QueryTypes.SELECT },
  );
  return r?.plantilla ? { plantilla: String(r.plantilla), propia: true } : { plantilla: PLANTILLA_NOTA_DEFAULT, propia: false };
}

function templatePath(): string {
  const prod = path.join(process.cwd(), 'templates', 'nota_designacion_gdeba.docx');
  const dev = path.join(process.cwd(), 'src', 'templates', 'nota_designacion_gdeba.docx');
  return fs.existsSync(prod) ? prod : dev;
}

/** .docx de la nota a partir de la plantilla. */
export async function docxNotaDesignacion(d: NotaDesignacionDatos): Promise<Buffer> {
  const tpl = fs.readFileSync(templatePath());
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out = await fillDocxTemplate(tpl, {
    '{{ART_ESTAB}}': x(d.artEstab),
    '{{ESTABLECIMIENTO}}': x(d.establecimiento),
    // la plantilla dice " al {{TRATAMIENTO}}:" → "al Sr." / "a la Sra."
    'al {{TRATAMIENTO}}': alTratamiento(d.tratamiento),
    '{{APELLIDO_NOMBRE}}': x(d.apellidoNombre),
    '{{DNI}}': String(d.dni),
    '{{HORAS}}': x(d.horas),
    '{{CARGO}}': x(d.cargo),
    '{{AGRUPAMIENTO}}': x(d.agrupamiento),
    '{{CATEGORIA}}': x(d.categoria),
  });
  return out as Buffer;
}

/**
 * .docx desde el texto final de la nota (plantilla de la tanda o texto retocado a mano).
 * Usa la plantilla .docx solo por la página/márgenes y arma un párrafo por línea con el
 * formato de la nota original: las 2 primeras líneas en negrita y, en las líneas
 * "ETIQUETA: valor", la etiqueta en negrita.
 */
export async function docxDesdeTexto(texto: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fs.readFileSync(templatePath()));
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Plantilla .docx inválida');
  const xml = await f.async('string');
  const sect = (xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (t: string, b: boolean) =>
    `<w:r><w:rPr>${b ? '<w:b/>' : ''}<w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  const parrafos = texto.replace(/\r\n/g, '\n').split('\n').map((linea, i) => {
    if (!linea.trim()) return '<w:p/>';
    if (i < 2) return `<w:p>${run(linea, true)}</w:p>`;
    const m = linea.match(/^([A-ZÁÉÍÓÚÑ0-9 ./°º-]{3,60}:)(.*)$/);
    return m ? `<w:p>${run(m[1], true)}${run(m[2], false)}</w:p>` : `<w:p>${run(linea, false)}</w:p>`;
  }).join('');
  zip.file('word/document.xml', xml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${parrafos}${sect}</w:body>`));
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}
