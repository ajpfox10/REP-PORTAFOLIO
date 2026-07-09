// src/routes/sinSalidaNotif.routes.ts
//
// Notificaciones "sin salida" por mail (no-reply) a cada agente.
// Se monta dentro de buildSinSalidaRouter.
//
// Endpoints (prefijo /sin-salida):
//   POST /notificaciones/preview  → filtros → agentes + días + mensaje + facetas (para el form)
//   POST /notificaciones/enviar   → filtros + confirmar → envía mails (gated) y devuelve resultados
//
// SEGURIDAD: solo se envía a agentes con SIN_SALIDA REAL y email válido. Nunca a
// REVISAR_HORARIO / MAL_FICHADO (esos son errores nuestros). Requiere confirmar=true.

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { evaluarSinSalida, EvalOpts, Turno, AgenteSinSalida } from '../services/sinSalidaEval';
import { sendEmail, noReplyOptions } from '../services/email.service';
import { salidasLiveAgente } from '../services/attlogLive';

function rangoDe(body: any): { desde: string; hasta: string } | null {
  const p = String(body?.periodo ?? '').trim();
  const d = String(body?.desde ?? '').trim();
  const h = String(body?.hasta ?? '').trim();
  const f = String(body?.fecha ?? '').trim();
  const hoy = new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let hasta = `${p}-${String(dim).padStart(2, '0')}`;
    if (hasta > hoy) hasta = hoy;
    return { desde: `${p}-01`, hasta };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && /^\d{4}-\d{2}-\d{2}$/.test(h) && d <= h) return { desde: d, hasta: h > hoy ? hoy : h };
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return { desde: f, hasta: f };
  return null;
}

const TURNO_LABEL: Record<Turno, string> = { MANIANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche', GUARDIA: 'Guardia' };

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function baseOpts(body: any): EvalOpts {
  return {
    periodo: typeof body?.periodo === 'string' ? body.periodo.trim() : undefined,
    desde: typeof body?.desde === 'string' ? body.desde.trim() : undefined,
    hasta: typeof body?.hasta === 'string' ? body.hasta.trim() : undefined,
  };
}

// Aplica los filtros del formulario sobre el resultado (crudo por período).
function filtrar(agentes: AgenteSinSalida[], body: any): AgenteSinSalida[] {
  const servicios = Array.isArray(body?.servicios) && body.servicios.length ? new Set(body.servicios.map((s: string) => String(s).toUpperCase().trim())) : null;
  const turnos = Array.isArray(body?.turnos) && body.turnos.length ? new Set(body.turnos as Turno[]) : null;
  const ubic = Array.isArray(body?.ubicaciones) && body.ubicaciones.length ? new Set(body.ubicaciones.map((u: string) => String(u).toUpperCase().trim())) : null;
  const excluirResidentes = !!body?.excluirResidentes;
  const minDias = Math.max(1, Number(body?.minDias) || 1);
  const soloDni = Array.isArray(body?.soloDni) && body.soloDni.length ? new Set(body.soloDni.map((d: any) => String(d).replace(/\D/g, ''))) : null;

  const out: AgenteSinSalida[] = [];
  for (const a of agentes) {
    if (soloDni && !soloDni.has(a.dni)) continue;
    if (excluirResidentes && /RESIDENTE/i.test(a.ley)) continue;
    if (servicios && !servicios.has(a.servicio.toUpperCase().trim())) continue;
    if (ubic && !ubic.has(a.ubicacion.toUpperCase().trim())) continue;
    let dias = a.dias;
    if (turnos) dias = dias.filter(d => turnos.has(d.turno));
    if (dias.length < minDias) continue;
    out.push({ ...a, dias });
  }
  out.sort((x, y) => y.dias.length - x.dias.length || x.nombre.localeCompare(y.nombre));
  return out;
}

function mensajeAgente(a: AgenteSinSalida): { asunto: string; texto: string; html: string } {
  const dias = a.dias.map(d => fechaLarga(d.fecha)).join(', ');
  const asunto = 'Registro de fichaje de salida pendiente';
  const cuerpo =
    `Estimado/a ${a.nombre}:\n\n` +
    `Por intermedio de la presente se le informa que no registramos fichaje de salida el/los día(s): ${dias}.\n\n` +
    `En caso de discrepancia, comunicarse con el WhatsApp de la oficina.\n\n` +
    `De repetirse la situación de no fichar la salida, según normativa vigente será considerado/a AUSENTE ese día.\n\n` +
    `Este es un correo automático, por favor no responda a este mensaje.`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;max-width:640px">
       <p>Estimado/a <strong>${a.nombre}</strong>:</p>
       <p>Por intermedio de la presente se le informa que <strong>no registramos fichaje de salida</strong> el/los día(s):</p>
       <p style="font-size:15px;color:#b02a37"><strong>${dias}</strong></p>
       <p>En caso de discrepancia, comunicarse con el WhatsApp de la oficina.</p>
       <p>De repetirse la situación de no fichar la salida, según normativa vigente será considerado/a <strong>AUSENTE</strong> ese día.</p>
       <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
       <p style="font-size:12px;color:#888">Este es un correo automático, por favor no responda a este mensaje.</p>
     </div>`;
  return { asunto, texto: cuerpo, html };
}

export function registerSinSalidaNotifRoutes(router: Router, sequelize?: import('sequelize').Sequelize): void {
  // ── PREVIEW ────────────────────────────────────────────────────────────────
  router.post('/notificaciones/preview', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(503).json({ ok: false, error: 'DB no disponible' });
    try {
      const evalRes = await evaluarSinSalida(baseOpts(req.body), sequelize);
      if (evalRes.dbError) return res.status(200).json({ ok: true, dbError: evalRes.dbError, agentes: [], facetas: emptyFacetas(), resumen: evalRes.resumen });

      // Facetas (sobre TODO el período) para poblar el formulario
      const facetas = {
        servicios: [...new Set(evalRes.agentes.map(a => a.servicio))].filter(Boolean).sort(),
        ubicaciones: [...new Set(evalRes.agentes.map(a => a.ubicacion))].filter(Boolean).sort(),
        turnos: [...new Set(evalRes.agentes.flatMap(a => a.dias.map(d => d.turno)))].map(t => ({ value: t, label: TURNO_LABEL[t] })),
      };

      // Devolvemos la lista COMPLETA (sin filtrar) — el filtrado por servicio/turno/
      // ubicación/residentes/mín. días se hace en vivo del lado del cliente.
      return res.json({
        ok: true,
        facetas,
        resumen: evalRes.resumen,
        agentes: evalRes.agentes.map(a => ({
          dni: a.dni, nombre: a.nombre, servicio: a.servicio, ley: a.ley, ubicacion: a.ubicacion,
          email: a.email, emailValido: a.emailValido,
          dias: a.dias.map(d => ({ fecha: d.fecha, turno: d.turno, turnoLabel: TURNO_LABEL[d.turno] })),
          totalDias: a.dias.length,
          horario: a.horario,
          coincidencia: a.coincidencia,
          mensaje: mensajeAgente(a).texto,
        })),
      });
    } catch (err: any) {
      logger.error({ msg: 'notificaciones/preview error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al previsualizar' });
    }
  });

  // ── ENVIAR (gated) ───────────────────────────────────────────────────────────
  router.post('/notificaciones/enviar', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(503).json({ ok: false, error: 'DB no disponible' });
    if (req.body?.confirmar !== true) return res.status(400).json({ ok: false, error: 'Falta confirmar=true' });
    try {
      const evalRes = await evaluarSinSalida(baseOpts(req.body), sequelize);
      if (evalRes.dbError) return res.status(503).json({ ok: false, error: evalRes.dbError });

      const filtrados = filtrar(evalRes.agentes, req.body).filter(a => a.emailValido);
      if (filtrados.length === 0) return res.json({ ok: true, enviados: 0, resultados: [], total: 0, aviso: 'No hay agentes con email válido en la selección' });

      const noReply = noReplyOptions('Oficina de Personal');
      const resultados: Array<{ dni: string; nombre: string; email: string; ok: boolean; error?: string }> = [];
      let enviados = 0;
      for (const a of filtrados) {
        const m = mensajeAgente(a);
        try {
          const r = await sendEmail({ to: a.email!, subject: m.asunto, text: m.texto, html: m.html, ...noReply });
          if (r.ok) enviados++;
          resultados.push({ dni: a.dni, nombre: a.nombre, email: a.email!, ok: r.ok, error: r.ok ? undefined : r.error });
        } catch (e: any) {
          resultados.push({ dni: a.dni, nombre: a.nombre, email: a.email!, ok: false, error: e?.message || 'Error al enviar' });
        }
      }

      (res.locals as any).audit = {
        action: 'sin_salida_notificacion_enviar',
        table_name: 'checkinout',
        record_pk: `${req.body?.periodo || req.body?.desde || ''}`,
        request_json: { filtros: { periodo: req.body?.periodo, desde: req.body?.desde, hasta: req.body?.hasta, servicios: req.body?.servicios, turnos: req.body?.turnos, ubicaciones: req.body?.ubicaciones, minDias: req.body?.minDias }, total: filtrados.length, enviados },
      };
      logger.info({ msg: 'notificaciones sin-salida enviadas', total: filtrados.length, enviados });
      return res.json({ ok: true, total: filtrados.length, enviados, fallidos: filtrados.length - enviados, resultados });
    } catch (err: any) {
      logger.error({ msg: 'notificaciones/enviar error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al enviar notificaciones' });
    }
  });

  // ── FICHAJES EN VIVO de un agente: entrada (sincronizada) + salida (pull del reloj) ──
  router.post('/notificaciones/fichajes-agente-live', requirePermission('api:access'), async (req: Request, res: Response) => {
    const dni = String(req.body?.dni ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (!dni) return res.status(400).json({ ok: false, error: 'Falta "dni"' });
    const rango = rangoDe(req.body);
    if (!rango) return res.status(400).json({ ok: false, error: 'Falta período/fecha válidos' });
    try {
      // Entrada: del checkinout sincronizado (el reloj de entrada no se baja en vivo)
      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const conn = await mysql.createConnection({
        host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
        user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '', database: cfg.mysqlDb || 'adms_db',
        connectTimeout: 10_000, dateStrings: true,
      });
      const hastaPlus = new Date(rango.hasta + 'T00:00:00Z'); hastaPlus.setUTCDate(hastaPlus.getUTCDate() + 1);
      const [dbRows] = await conn.query<RowDataPacket[]>(
        `SELECT ci.checktime, COALESCE(ci.SN,'') SN
           FROM checkinout ci INNER JOIN userinfo ui ON ci.userid=ui.userid
          WHERE ui.badgenumber=? AND ci.checktype=0
            AND ci.checktime>=? AND ci.checktime<=? ORDER BY ci.checktime ASC`,
        [dni, `${rango.desde} 00:00:00`, `${hastaPlus.toISOString().slice(0, 10)} 14:00:00`]
      );
      await conn.end();
      const entradas = dbRows.map(r => ({ fecha: String(r.checktime).slice(0, 10), hora: String(r.checktime).slice(11, 16), sn: String(r.SN), tipo: 'Entrada' as const }));

      // Salida: en vivo del aparato
      const live = await salidasLiveAgente(dni, rango.desde, rango.hasta, req.body?.force === true);

      const data = [...entradas, ...live.punches].sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
      return res.json({ ok: true, data, fuente: { salida: 'aparato', entrada: 'sincronizado', relojes: live.relojes, cacheEdadSeg: live.cacheEdadSeg } });
    } catch (err: any) {
      logger.error({ msg: 'fichajes-agente-live error', error: err?.message });
      return res.status(503).json({ ok: false, error: err?.message || 'No se pudo consultar el reloj en vivo' });
    }
  });
}

function emptyFacetas() { return { servicios: [], ubicaciones: [], turnos: [] as Array<{ value: string; label: string }> }; }
