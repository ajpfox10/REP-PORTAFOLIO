// src/routes/legajoEnlace.routes.ts
// Legajo por enlace (mig 138) — lado de la oficina. Lo público está en src/publico (/l/:token).
//
//   GET  /legajo/enlace/config               → dirección pública (la misma de la Agenda) + mensaje de WhatsApp
//   PUT  /legajo/enlace/config               → { plantilla }
//   GET  /legajo/enlace/agente/:dni          → último enlace del agente + celular (ficha de Gestión / Legajo)
//   POST /legajo/enlace/habilitar            → { dnis: number[], dias?, observacion? } (uno o una tanda)
//   GET  /legajo/enlace/lista?estado=        → enlaces (por defecto los abiertos: HABILITADO/ENVIADO/DEVUELTO)
//   GET  /legajo/enlace/:id/previa           → qué se cargaría al aprobar + respuestas
//   POST /legajo/enlace/:id/aprobar          → { pisar }
//   POST /legajo/enlace/:id/devolver         → { motivo, dias? } vuelve al agente para corregir (mismo enlace)
//   POST /legajo/enlace/:id/anular

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { celularDe } from './licenciasMedicasControl.routes';
import {
  LegajoEnlaceError, CONFIG_KEY, PLANTILLA_DEFAULT, DIAS_VENCE_DEFAULT,
  ensureAutocargaTabla, vencer, habilitar, anular, devolver, previa, aprobar,
} from '../services/legajoAutocarga';

const ESTADOS = ['HABILITADO', 'ENVIADO', 'DEVUELTO', 'APROBADO', 'ANULADO', 'VENCIDO'];

export function registrarLegajoEnlace(router: Router, sequelize: Sequelize, read: any, write: any, userId: (req: Request) => number | null) {
  // se crea al arrancar: crear_usuario_publico.cjs necesita que exista para dar el permiso
  ensureAutocargaTabla(sequelize).catch(() => { /* se reintenta en cada pedido */ });
  const q = <T extends object = any>(sql: string, replacements: any = {}): Promise<T[]> => sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
  const fallo = (res: Response, err: any, donde: string) => {
    if (err instanceof LegajoEnlaceError) return res.status(err.status).json({ ok: false, error: err.message });
    logger.error({ msg: `legajo enlace ${donde}`, error: err?.message });
    return res.status(500).json({ ok: false, error: err?.message || 'Error' });
  };
  const ruta = (fn: (req: Request) => Promise<any>) => async (req: Request, res: Response) => {
    try { await ensureAutocargaTabla(sequelize); return res.json({ ok: true, data: await fn(req) }); }
    catch (err) { return fallo(res, err, req.path); }
  };
  const idDe = (req: Request) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new LegajoEnlaceError('id inválido');
    return id;
  };

  const leerJson = async (key: string) => {
    const row = (await q<any>(`SELECT config_json FROM app_runtime_config WHERE config_key = :k`, { k: key }).catch(() => []))[0];
    return row?.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) : {};
  };
  // La dirección pública es la de la Agenda de turnos (mismo servidor y túnel): se configura ahí.
  const leerConfig = async () => {
    const ag = await leerJson('agenda_turnos');
    const lg = await leerJson(CONFIG_KEY);
    const url = String(ag.url_publica ?? process.env.TURNOS_PUBLICO_URL ?? '');
    return {
      url_publica: url, plantilla: lg.plantilla || PLANTILLA_DEFAULT, plantillaDefault: PLANTILLA_DEFAULT,
      url_publica_temporal: !!ag.url_publica_temporal && /\.trycloudflare\.com$/i.test(url),
      dias_default: DIAS_VENCE_DEFAULT,
    };
  };

  router.get('/enlace/config', read, ruta(() => leerConfig()));
  router.put('/enlace/config', write, ruta(async req => {
    const plantilla = String(req.body?.plantilla ?? '').trim();
    if (plantilla && !plantilla.includes('{LINK}')) throw new LegajoEnlaceError('El mensaje tiene que tener {LINK}');
    await sequelize.query(
      `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
       VALUES (:k, :j, :u, NOW(), NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
      { replacements: { k: CONFIG_KEY, j: JSON.stringify({ plantilla: plantilla || PLANTILLA_DEFAULT }), u: userId(req) } });
    return leerConfig();
  }));

  router.get('/enlace/agente/:dni(\\d+)', read, ruta(async req => {
    await vencer(sequelize);
    const dni = Number(req.params.dni);
    const [per] = await q<any>(
      `SELECT p.dni, p.apellido, p.nombre, p.telefono,
              EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO') AS activo
         FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL`, { dni });
    if (!per) throw new LegajoEnlaceError('El agente no está en el sistema', 404);
    const [ultimo] = await q<any>(
      `SELECT id, token, estado, DATE_FORMAT(vence_el, '%Y-%m-%d') AS vence_el, DATE_FORMAT(enviado_at, '%Y-%m-%d %H:%i') AS enviado_at,
              DATE_FORMAT(revisado_at, '%Y-%m-%d %H:%i') AS revisado_at, devolucion_motivo, DATE_FORMAT(created_at, '%Y-%m-%d') AS creado
         FROM legajo_autocarga WHERE dni = :dni ORDER BY id DESC LIMIT 1`, { dni });
    const abierto = ultimo && ['HABILITADO', 'DEVUELTO'].includes(ultimo.estado);
    return {
      agente: { dni: per.dni, apellido: per.apellido, nombre: per.nombre, activo: !!Number(per.activo), ...celularDe(per.telefono) },
      enlace: ultimo ? { ...ultimo, token: abierto ? ultimo.token : null } : null,
      ...(await leerConfig()),
    };
  }));

  router.post('/enlace/habilitar', write, ruta(async req => {
    const dnis = (Array.isArray(req.body?.dnis) ? req.body.dnis : []).map((d: any) => Number(String(d).replace(/\D/g, ''))).filter(Boolean);
    if (!dnis.length) throw new LegajoEnlaceError('Indicá al menos un DNI');
    if (dnis.length > 500) throw new LegajoEnlaceError('Máximo 500 DNIs por tanda');
    const obs = String(req.body?.observacion ?? '').trim().slice(0, 255) || null;
    const r = await habilitar(sequelize, dnis, userId(req), Number(req.body?.dias) || DIAS_VENCE_DEFAULT, obs);
    // celulares para mandar el WhatsApp desde la tanda
    const ok = r.filter(x => x.ok).map(x => x.dni);
    const tels = ok.length ? await q<any>(`SELECT dni, telefono FROM personal WHERE dni IN (:ok)`, { ok }) : [];
    const tel = new Map(tels.map(t => [Number(t.dni), celularDe(t.telefono).celular]));
    return r.map(x => ({ ...x, celular: tel.get(x.dni) ?? null }));
  }));

  router.get('/enlace/lista', read, ruta(async req => {
    await vencer(sequelize);
    const est = String(req.query.estado ?? '').toUpperCase();
    const filtro = est === 'TODOS' ? [] : ESTADOS.includes(est) ? [est] : ['HABILITADO', 'ENVIADO', 'DEVUELTO'];
    const rows = await q<any>(
      `SELECT l.id, l.dni, p.apellido, p.nombre, p.telefono, l.estado, l.token,
              DATE_FORMAT(l.vence_el, '%Y-%m-%d') AS vence_el, DATE_FORMAT(l.created_at, '%Y-%m-%d') AS creado,
              DATE_FORMAT(l.guardado_at, '%Y-%m-%d %H:%i') AS guardado_at, DATE_FORMAT(l.enviado_at, '%Y-%m-%d %H:%i') AS enviado_at,
              DATE_FORMAT(l.revisado_at, '%Y-%m-%d %H:%i') AS revisado_at, l.devolucion_motivo, l.resumen, l.observacion,
              (l.respuestas IS NOT NULL) AS empezo
         FROM legajo_autocarga l JOIN personal p ON p.dni = l.dni
        ${filtro.length ? 'WHERE l.estado IN (:filtro)' : ''}
        ORDER BY (l.estado = 'ENVIADO') DESC, COALESCE(l.enviado_at, l.created_at) DESC, l.id DESC
        LIMIT 2000`, { filtro });
    const conteo = await q<any>(`SELECT estado, COUNT(*) AS n FROM legajo_autocarga GROUP BY estado`);
    return {
      rows: rows.map(r => ({
        ...r, empezo: !!Number(r.empezo), ...celularDe(r.telefono), telefono: undefined,
        resumen: r.resumen ? (typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen) : null,
        token: ['HABILITADO', 'DEVUELTO'].includes(r.estado) ? r.token : null,
      })),
      conteo: Object.fromEntries(conteo.map(c => [c.estado, Number(c.n)])),
    };
  }));

  router.get('/enlace/:id(\\d+)/previa', read, ruta(req => previa(sequelize, idDe(req))));
  router.post('/enlace/:id(\\d+)/aprobar', write, ruta(req => aprobar(sequelize, idDe(req), !!req.body?.pisar, userId(req))));
  router.post('/enlace/:id(\\d+)/devolver', write, ruta(async req => {
    await devolver(sequelize, idDe(req), req.body?.motivo, userId(req), Number(req.body?.dias) || 7);
    return { devuelto: true };
  }));
  router.post('/enlace/:id(\\d+)/anular', write, ruta(async req => { await anular(sequelize, idDe(req), userId(req)); return { anulado: true }; }));
}
