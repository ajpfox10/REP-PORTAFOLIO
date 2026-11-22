// src/services/docuAuditoria.ts — quién guardó cada archivo en DOCU, desde qué PC y por qué vía (22/11/2026).
// Tabla docu_auditoria (mig 146). La escriben docu-upload / docu-move de Trámites y los robots (Python,
// INSERT directo). La lee la pestaña "Auditoría" de Trámites Documentales (GET /tramites-documentales/auditoria),
// que además suma lo que ya queda en tblarchivos (escáner, mail) y los archivos de DOCU sin registro.
// Nunca frena la operación que audita.
import type { Request } from 'express';
import { Sequelize } from 'sequelize';
import { logger } from '../logging/logger';
import { ipDe, nombreDeIp } from './pcsConectadas';

const listas = new WeakSet<Sequelize>();

export async function ensureDocuAuditoria(sq: Sequelize): Promise<void> {
  if (listas.has(sq)) return;
  await sq.query(`
    CREATE TABLE IF NOT EXISTS docu_auditoria (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      dni         INT NOT NULL,
      ruta        VARCHAR(600) NOT NULL,
      documento   VARCHAR(200) NULL,
      origen      VARCHAR(20) NOT NULL,
      usuario_id  INT NULL,
      pc          VARCHAR(120) NULL,
      ip          VARCHAR(45) NULL,
      robot       VARCHAR(80) NULL,
      detalle     VARCHAR(500) NULL,
      creado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_docu_aud_dni (dni, creado_at),
      KEY ix_docu_aud_creado (creado_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  listas.add(sq);
}

export type DocuAuditoriaFila = {
  dni: number;
  ruta: string;          // relativa a DOCU
  documento?: string | null;
  origen: 'robot' | 'subida' | 'movido' | 'escaner' | 'mail';
  robot?: string | null;
  detalle?: string | null;
};

/** Usuario logueado del pedido (solo personas: user/dev; nunca api_key). */
export function usuarioDe(req: Request | null): number | null {
  const a = (req as any)?.auth;
  if (!a || (a.principalType !== 'user' && a.principalType !== 'dev')) return null;
  return Number(a.principalId) || null;
}

/** Registra en segundo plano (no espera el nombre de la PC ni la base). */
export function auditarDocu(sq: Sequelize, req: Request | null, filas: DocuAuditoriaFila[]): void {
  if (!filas.length) return;
  const ip = req ? ipDe(req) || null : null;
  const usuarioId = usuarioDe(req);
  void (async () => {
    try {
      await ensureDocuAuditoria(sq);
      const pc = ip ? await nombreDeIp(ip) : null;
      for (const f of filas) {
        await sq.query(
          `INSERT INTO docu_auditoria (dni, ruta, documento, origen, usuario_id, pc, ip, robot, detalle)
           VALUES (:dni, :ruta, :documento, :origen, :usuarioId, :pc, :ip, :robot, :detalle)`,
          {
            replacements: {
              dni: f.dni, ruta: f.ruta.slice(0, 600), documento: f.documento?.slice(0, 200) ?? null,
              origen: f.origen, usuarioId, pc, ip, robot: f.robot?.slice(0, 80) ?? null,
              detalle: f.detalle?.slice(0, 500) ?? null,
            },
          });
      }
    } catch (e: any) {
      logger.warn({ msg: '[docu-auditoria] no se pudo registrar', error: e?.message });
    }
  })();
}
