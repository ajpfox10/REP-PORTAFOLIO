// src/services/resolucionesVincular.ts
// Mantiene al día el vínculo resolución → PDF de RESOLUCIONES Y VARIOS:
//  1) registra en tblarchivos (dni=1) los PDF de la carpeta principal que todavía no tienen fila;
//  2) vincula (resoluciones.archivo_id) las que no tienen archivo y tienen UN solo candidato.
// Lo usan: el botón "↻ Buscar de nuevo" del aviso, el guardado de una resolución sin escaneo
// y (con la misma lógica, en JS) el robot diario scripts/resoluciones_registrar_y_vincular.cjs.

import fs from 'fs';
import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../config/env';
import { matchResolucionGeneral, ArchivoGeneral } from './resolucionArchivoMatch';

const RUTA_DB = '\\\\192.168.0.21\\g\\RESOLUCIONES Y VARIOS';
const EXT_OK = /\.(pdf|jpe?g|png|tiff?|bmp|gif|docx?)$/i;
const LETRAS = 'A-Za-zÁÉÍÓÚÑáéíóúñ';

/** tipo/numero/anio a partir del nombre (solo informativo, como las filas viejas). */
function parsearNombre(nombre: string): { tipo: string | null; numero: string | null; anio: number | null } {
  const base = nombre.replace(/\.+[a-z0-9]{2,5}$/i, '').trim().replace(/\s*-\s*/g, '-')
    .replace(new RegExp(`^([${LETRAS}]+)\\s+(?=\\d)`), '$1-').split(/\s+/)[0] || '';
  const pre = (base.match(new RegExp(`^[${LETRAS}]+`)) || [''])[0].toUpperCase();
  const nums: string[] = base.match(/\d+/g) || [];
  if (!pre && nums.length >= 3) return { tipo: nums[0].slice(0, 50), numero: nums[1], anio: Number(nums[2]) };
  const iAnio = nums.findIndex(g => g.length === 4 && +g >= 1950 && +g <= 2099);
  let anio: number | null = null; let numero: string | null = null;
  if (iAnio >= 0) { anio = Number(nums[iAnio]); numero = nums.find((_, i) => i !== iAnio) ?? null; }
  else if (nums.length >= 2) { numero = nums[0]; anio = Number(nums[nums.length - 1]); }
  else numero = nums[0] ?? null;
  return { tipo: pre ? pre.slice(0, 50) : null, numero, anio: Number.isFinite(anio as number) ? anio : null };
}

export async function registrarArchivosFaltantes(sequelize: Sequelize): Promise<number> {
  const dir = String(env.DOCUMENTS_BASE_DIR || '').trim();
  if (!dir || !fs.existsSync(dir)) return 0;
  const existentes = await sequelize.query<{ n: string | null }>(
    `SELECT nombre_archivo_original AS n FROM tblarchivos
      WHERE dni = 1 AND ruta LIKE '%RESOLUCIONES Y VARIOS' AND deleted_at IS NULL`,
    { type: QueryTypes.SELECT },
  );
  const ya = new Set(existentes.map(e => String(e.n || '').toLowerCase()));
  const faltan = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && EXT_OK.test(d.name) && !ya.has(d.name.toLowerCase()))
    .map(d => d.name);
  for (let i = 0; i < faltan.length; i += 500) {
    const lote = faltan.slice(i, i + 500);
    const valores: any[] = [];
    const filas = lote.map(n => {
      const { tipo, numero, anio } = parsearNombre(n);
      valores.push(RUTA_DB, n, tipo, numero, anio);
      return '(1, ?, ?, ?, ?, ?, 1)';
    });
    await sequelize.query(
      `INSERT INTO tblarchivos (dni, ruta, nombre_archivo_original, tipo, numero, anio, procesada) VALUES ${filas.join(',')}`,
      { replacements: valores },
    );
  }
  return faltan.length;
}

export interface ResultadoVinculo { id: number; dni: number; numero: string; archivo: string }

/** Vincula las resoluciones sin archivo que tienen un solo candidato (todas, o solo `ids`). */
export async function vincularPendientes(sequelize: Sequelize, ids?: number[]): Promise<ResultadoVinculo[]> {
  const filtroIds = ids && ids.length ? 'AND r.id IN (:ids)' : '';
  const pendientes = await sequelize.query<any>(
    `SELECT r.id, r.dni, r.numero, r.fecha, p.apellido
       FROM resoluciones r LEFT JOIN personal p ON p.dni = r.dni
      WHERE r.archivo_id IS NULL AND r.deleted_at IS NULL
        AND r.numero IS NOT NULL AND TRIM(r.numero) <> '' ${filtroIds}`,
    { type: QueryTypes.SELECT, replacements: { ids: ids && ids.length ? ids : [0] } },
  );
  if (!pendientes.length) return [];
  const generales = await sequelize.query<ArchivoGeneral>(
    `SELECT id, nombre, nombre_archivo_original FROM tblarchivos
      WHERE dni = 1 AND ruta LIKE '%RESOLUCIONES Y VARIOS' AND deleted_at IS NULL`,
    { type: QueryTypes.SELECT },
  );
  const hechos: ResultadoVinculo[] = [];
  for (const r of pendientes) {
    const m = matchResolucionGeneral(r, generales, r.apellido || '');
    if (!m.archivo) continue;
    await sequelize.query(
      'UPDATE resoluciones SET archivo_id = :a WHERE id = :id AND archivo_id IS NULL',
      { replacements: { a: m.archivo.id, id: r.id } },
    );
    hechos.push({ id: r.id, dni: r.dni, numero: r.numero, archivo: String(m.archivo.nombre_archivo_original || m.archivo.nombre || '') });
  }
  return hechos;
}
