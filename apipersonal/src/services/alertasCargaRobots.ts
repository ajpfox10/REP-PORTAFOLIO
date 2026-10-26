// src/services/alertasCargaRobots.ts
// Alertas bloqueantes por ERRORES DE DATOS en las cargas de los robots (17/10/2026).
//
// Recorre las colas de los robots (ART, SIAPE, Intranet) y, por cada agente con un error que hay que
// resolver a mano (agente sin servicio, localidad que la ART no tiene, no está en SIAPE, no pertenece
// al plantel, conflicto de período, etc.), deja una alerta en alertas_agente con título
// "Error de carga · <robot>". Esas alertas tapan la app (mismo modal que las de jubilación) hasta que
// alguien las desactiva o hasta que el error desaparece de la cola (el robot reintentó y cargó).
//
// Reglas:
//   · Solo errores de DATOS. Los técnicos (timeouts, pantalla que no respondió, "no aterrizó",
//     fila vieja de Ficheros…) no bloquean: el robot los reintenta solo.
//   · Solo errores registrados A PARTIR de la primera sincronización (app_runtime_config
//     'alertas_carga_desde'); la historia previa no se levanta.
//   · Una alerta por agente × cola × tipo de motivo (clave en alertas_agente.origen). Si alguien la
//     desactivó, ese mismo error no la vuelve a crear.

import crypto from 'crypto';
import { QueryTypes, Sequelize } from 'sequelize';
import { logger } from '../logging/logger';

export const TITULO_PREFIJO = 'Error de carga ·';
const ORIGEN_PREFIJO = 'carga|';
const CONFIG_KEY = 'alertas_carga_desde';
const INTERVALO_MS = 2 * 60_000;

// Motivos que exigen corregir datos
const DATOS = /faltante|no se pudo seleccionar|no est[aá] en (siape|art)|sin resultado|no pertenece a su plantel|sin fila v[aá]lida|conflicto con el ministerio|superposici[oó]n|ya posee|cerrado|no figura|no existe|sin servicio|se abri[oó] .* y buscaba|no encontr[eé] (el |al )?agente|cuil|falta /i;
// Fallas técnicas que el robot reintenta solo (tienen prioridad sobre DATOS)
const TECNICO = /timeout|exceeded|locator|no aterriz|no esta al frente|no está al frente|fila vieja|la fila de ficheros dice|target (page|closed)|net::|navegaci[oó]n|no editable|captura de pantalla fall/i;

interface Fuente {
  clave: string;
  robot: string;
  sql: string;          // columnas: dni, motivo, ts (hora local) — con ? para la fecha desde
}

// Columnas TIMESTAMP (se guardan en UTC y la sesión de Sequelize las devuelve en UTC) se pasan a hora
// local para compararlas con `desde`; las DATETIME ya están en hora local (las escriben los robots).
const offsetLocal = () => {
  const m = -new Date().getTimezoneOffset();
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const ts = (col: string) => `CONVERT_TZ(${col}, @@session.time_zone, '${offsetLocal()}')`;

const fuentes = (): Fuente[] => [
  { clave: 'art_alta', robot: 'ART · alta de trabajador', // sync-guard:ignore
    sql: `SELECT dni, last_error AS motivo, ${ts('updated_at')} AS ts FROM art_alta_queue WHERE status = 'ERROR' AND ${ts('updated_at')} >= ?` },
  { clave: 'art_baja', robot: 'ART · baja de trabajador', // sync-guard:ignore
    sql: `SELECT dni, last_error AS motivo, ${ts('updated_at')} AS ts FROM art_baja_queue WHERE status = 'ERROR' AND ${ts('updated_at')} >= ?` },
  { clave: 'art_catan', robot: 'ART · pasar a Catán', // sync-guard:ignore
    sql: `SELECT dni, CASE WHEN estado = 'NO_EN_ART' THEN CONCAT('No está en ART. ', COALESCE(detalle,'')) ELSE detalle END AS motivo,
                 ${ts('updated_at')} AS ts
            FROM art_control_establecimiento WHERE estado IN ('ERROR','PARCIAL','NO_EN_ART') AND ${ts('updated_at')} >= ?` },
  { clave: 'siape_bajas', robot: 'SIAPE · bajas', // sync-guard:ignore
    sql: `SELECT dni, detalle AS motivo, actualizado_en AS ts FROM baja_carga_siape WHERE estado = 'ERROR' AND actualizado_en >= ?` },
  { clave: 'siape_francos', robot: 'SIAPE · francos / días', // sync-guard:ignore
    sql: `SELECT dni, detalle AS motivo, actualizado_en AS ts FROM siape_carga_dias WHERE estado = 'ERROR' AND actualizado_en >= ?` },
  { clave: 'siape_rotaciones', robot: 'SIAPE · rotaciones', // sync-guard:ignore
    sql: `SELECT dni, detalle AS motivo, actualizado_en AS ts FROM rotacion_carga_siape WHERE estado LIKE '%ERROR%' AND actualizado_en >= ?` },
  { clave: 'siape_stress', robot: 'SIAPE · carga de stress', // sync-guard:ignore
    sql: `SELECT dni, motivo, ${ts('actualizado_at')} AS ts FROM cola_carga_stress WHERE estado = 'error' AND ${ts('actualizado_at')} >= ?` },
  { clave: 'siape_corrector', robot: 'SIAPE · corrector de stress', // sync-guard:ignore
    sql: `SELECT dni, motivo, ${ts('actualizado_at')} AS ts FROM cola_correccion_stress WHERE estado = 'error' AND ${ts('actualizado_at')} >= ?` },
  { clave: 'siape_examen', robot: 'SIAPE · examen', // sync-guard:ignore
    sql: `SELECT dni, motivo, ${ts('actualizado_at')} AS ts FROM cola_examen_siape WHERE estado = 'error' AND ${ts('actualizado_at')} >= ?` },
  { clave: 'intranet_novedades', robot: 'Intranet · novedades', // sync-guard:ignore
    sql: `SELECT dni, detalle AS motivo, actualizado_en AS ts FROM novedades_carga_intranet WHERE estado IN ('ERROR','ERROR_NAV') AND actualizado_en >= ?` },
  { clave: 'intranet_art26', robot: 'Intranet · Art. 26', // sync-guard:ignore
    sql: `SELECT dni, detalle AS motivo, actualizado_en AS ts FROM art26_carga_intranet WHERE estado IN ('ERROR','ERROR_NAV') AND actualizado_en >= ?` },
];

export const esErrorDeDatos = (motivo: string) => !!motivo && DATOS.test(motivo) && !TECNICO.test(motivo);

/** Tipo de motivo: el texto sin fechas, números ni capturas, para agrupar errores iguales. */
function tipoMotivo(m: string) {
  return m.replace(/captura:.*$/i, '').replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '#').replace(/\d+/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, 120).toUpperCase();
}
const limpiar = (m: string) => m.replace(/\s*Captura:.*$/i, '').replace(/\s+/g, ' ').trim();

const listo = new WeakSet<Sequelize>();
async function ensureEsquema(sequelize: Sequelize) {
  if (listo.has(sequelize)) return;
  const [cols] = await sequelize.query(`SHOW COLUMNS FROM alertas_agente LIKE 'origen'`);
  if (!(cols as any[]).length) {
    await sequelize.query(`ALTER TABLE alertas_agente ADD COLUMN origen VARCHAR(80) NULL, ADD KEY idx_alertas_agente_origen (origen)`);
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_runtime_config (
      config_key VARCHAR(100) NOT NULL,
      config_json JSON NOT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (config_key),
      KEY idx_app_runtime_config_updated_by (updated_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  listo.add(sequelize);
}

/** Fecha desde la que se levantan errores: se fija en la primera sincronización. */
async function fechaDesde(sequelize: Sequelize): Promise<string> {
  const [r] = await sequelize.query<any>(
    `SELECT config_json FROM app_runtime_config WHERE config_key = ?`,
    { replacements: [CONFIG_KEY], type: QueryTypes.SELECT },
  );
  if (r) {
    const j = typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json;
    if (j?.desde) return j.desde;
  }
  // Hora LOCAL del servidor: las colas las escriben los robots (Python/Node) con la hora local, y el
  // NOW() de la sesión de Sequelize viene en UTC.
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const ahora = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  await sequelize.query(
    `INSERT IGNORE INTO app_runtime_config (config_key, config_json) VALUES (?, ?)`,
    { replacements: [CONFIG_KEY, JSON.stringify({ desde: ahora })] },
  );
  return ahora;
}

let ultima = 0;
let enCurso: Promise<void> | null = null;

/** Sincroniza (como mucho cada 2 min). Nunca tira: si falla, lo deja en el log. */
export function sincronizarAlertasCarga(sequelize: Sequelize, forzar = false): Promise<void> {
  if (enCurso) return enCurso;
  if (!forzar && Date.now() - ultima < INTERVALO_MS) return Promise.resolve();
  const p: Promise<void> = sincronizar(sequelize)
    .catch((err: any) => { logger.error({ msg: 'alertas de carga: error sincronizando', error: err?.message }); })
    .finally(() => { ultima = Date.now(); enCurso = null; });
  enCurso = p;
  return p;
}

async function sincronizar(sequelize: Sequelize) {
  await ensureEsquema(sequelize);
  const desde = await fechaDesde(sequelize);

  // Errores de datos vigentes, agrupados por agente × fuente × tipo de motivo
  const grupos = new Map<string, { dni: number; robot: string; motivo: string; n: number; ultimo: string }>();
  for (const f of fuentes()) {
    let filas: any[] = [];
    try {
      filas = await sequelize.query<any>(f.sql, { replacements: [desde], type: QueryTypes.SELECT });
    } catch (err: any) {
      // tabla que no existe en este ambiente: se saltea
      logger.warn({ msg: 'alertas de carga: no pude leer la cola', fuente: f.clave, error: err?.message });
      continue;
    }
    for (const r of filas) {
      const dni = Number(String(r.dni ?? '').replace(/\D/g, ''));
      const motivo = String(r.motivo ?? '').trim();
      if (!dni || !esErrorDeDatos(motivo)) continue;
      const tipo = tipoMotivo(motivo);
      const origen = ORIGEN_PREFIJO + crypto.createHash('sha1').update(`${f.clave}|${dni}|${tipo}`).digest('hex').slice(0, 40);
      const g = grupos.get(origen);
      const ts = String(r.ts ?? '');
      if (g) { g.n++; if (ts > g.ultimo) { g.ultimo = ts; g.motivo = limpiar(motivo); } }
      else grupos.set(origen, { dni, robot: f.robot, motivo: limpiar(motivo), n: 1, ultimo: ts });
    }
  }

  const existentes = await sequelize.query<any>(
    `SELECT id, origen, activa, deleted_at FROM alertas_agente WHERE origen LIKE ?`,
    { replacements: [`${ORIGEN_PREFIJO}%`], type: QueryTypes.SELECT },
  );
  const porOrigen = new Map(existentes.map((e: any) => [e.origen, e]));

  let creadas = 0, actualizadas = 0, resueltas = 0;
  for (const [origen, g] of grupos) {
    const mensaje = g.n > 1 ? `${g.motivo} (${g.n} registros con el mismo error)` : g.motivo;
    const e = porOrigen.get(origen);
    if (!e) {
      await sequelize.query(
        `INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por, origen, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, NULL, ?, NOW(), NOW())`,
        { replacements: [g.dni, `${TITULO_PREFIJO} ${g.robot}`, mensaje.slice(0, 2000), origen] },
      );
      creadas++;
    } else if (e.activa && !e.deleted_at) {
      await sequelize.query(`UPDATE alertas_agente SET mensaje = ?, updated_at = NOW() WHERE id = ? AND mensaje <> ?`,
        { replacements: [mensaje.slice(0, 2000), e.id, mensaje.slice(0, 2000)] });
      actualizadas++;
    }
    // desactivada a mano: no se recrea por el mismo error
  }
  // Errores que ya no están en la cola (el robot reintentó y cargó, o se corrigió): se cierran solas
  for (const e of existentes) {
    if (e.activa && !e.deleted_at && !grupos.has(e.origen)) {
      await sequelize.query(
        `UPDATE alertas_agente SET activa = 0, deleted_at = NOW(), desactivado_at = NOW(), desactivado_por = NULL, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL`,
        { replacements: [e.id] },
      );
      resueltas++;
    }
  }
  if (creadas || resueltas) logger.info({ msg: 'alertas de carga sincronizadas', desde, creadas, actualizadas, resueltas });
}
