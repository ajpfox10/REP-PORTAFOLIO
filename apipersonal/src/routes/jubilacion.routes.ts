/**
 * @file routes/jubilacion.routes.ts
 * @description Rutas del módulo Jubilación IPS.
 *
 * Endpoints:
 *   GET  /jubilacion/agente-datos/:dni       Datos del agente para cargar el form
 *   GET  /jubilacion/agente/:dni             Lista cálculos guardados de un agente
 *   POST /jubilacion/calcular                Calcula (sin guardar) — devuelve resultado
 *   POST /jubilacion/guardar                 Calcula y guarda en jubilacion_calculos
 *   PUT  /jubilacion/:id                     Actualiza observaciones / servicios
 *   DELETE /jubilacion/:id                   Soft-delete un cálculo
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes }      from 'sequelize';
import { z }                          from 'zod';
import { can }                        from '../middlewares/rbacCrud';
import { env }                        from '../config/env';
import { logger }                     from '../logging/logger';

// ── RBAC ──────────────────────────────────────────────────────────────────────
function rbac(table: string, action: 'read' | 'create' | 'update' | 'delete') {
  return (req: Request, res: Response, next: any) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!can(auth.permissions || [], table, action))
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    return next();
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
const servicioExternoSchema = z.object({
  organismo:    z.string().min(1).max(200),
  anios:        z.number().int().min(0).max(60),
  meses:        z.number().int().min(0).max(11),
  dias:         z.number().int().min(0).max(30),
  es_insalubre: z.boolean(),
});

const calculoSchema = z.object({
  dni:                     z.number().int().positive(),
  situacion_revista:       z.enum(['NORMAL', 'BECADO', 'RESIDENTE', 'ARTICULO_48']),
  beca_aporto:             z.boolean().optional().default(false),
  es_insalubre_ips:        z.boolean(),
  diferencial_2pct_pagado: z.boolean(),
  anses_anios:             z.number().int().min(0).max(60),
  anses_meses:             z.number().int().min(0).max(11),
  anses_dias:              z.number().int().min(0).max(30),
  anses_insalubre:         z.boolean(),
  servicios_externos:      z.array(servicioExternoSchema).max(20),
  observaciones:           z.string().max(2000).optional().nullable(),
});

// ── Motor de cálculo (puro, sin I/O) ─────────────────────────────────────────

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = String(s).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

function diffFechas(desde: Date, hasta: Date): { anios: number; meses: number; dias: number } {
  let anios = hasta.getFullYear() - desde.getFullYear();
  let meses = hasta.getMonth()    - desde.getMonth();
  let dias  = hasta.getDate()     - desde.getDate();
  if (dias < 0) {
    meses--;
    dias += new Date(hasta.getFullYear(), hasta.getMonth(), 0).getDate();
  }
  if (meses < 0) { anios--; meses += 12; }
  return { anios: Math.max(0, anios), meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

function toDias(p: { anios: number; meses: number; dias: number }) {
  return p.anios * 365 + p.meses * 30 + p.dias;
}

function fromDias(d: number) {
  const anios = Math.floor(d / 365);
  const rem   = d - anios * 365;
  const meses = Math.floor(rem / 30);
  return { anios, meses, dias: rem - meses * 30 };
}

function sumPeriodos(periodos: { anios: number; meses: number; dias: number }[]) {
  return fromDias(periodos.reduce((acc, p) => acc + toDias(p), 0));
}

function aplicarProrrateo(p: { anios: number; meses: number; dias: number }) {
  return fromDias(Math.round(toDias(p) * 1.4));
}

const FECHA_CORTE = new Date(2015, 5, 1); // 2015-06-01

const REQ_ORDINARIA = { edadDias: 60 * 365, servicioDias: 35 * 365 };
const REQ_INSALUBRE = { edadDias: 50 * 365, servicioDias: 25 * 365 };

interface CalculoInput {
  fecha_nacimiento:        string | null;
  fecha_ingreso_ips:       string | null;   // puede ser ingreso de beca
  fecha_nombramiento_ips:  string | null;   // nombramiento formal
  situacion_revista:       string;
  beca_aporto:             boolean;         // ¿aportó durante la beca?
  es_insalubre_ips:        boolean;         // profesión o sector insalubre
  diferencial_2pct_pagado: boolean;         // ¿pagó el 2% diferencial?
  anses_anios:             number;
  anses_meses:             number;
  anses_dias:              number;
  anses_insalubre:         boolean;
  servicios_externos: Array<{
    organismo: string; anios: number; meses: number; dias: number; es_insalubre: boolean;
  }>;
}

function calcular(input: CalculoInput) {
  const hoy           = new Date();
  const fechaNac      = parseDate(input.fecha_nacimiento);
  const fechaIngreso  = parseDate(input.fecha_ingreso_ips);
  const fechaNom      = parseDate(input.fecha_nombramiento_ips);

  const edad     = fechaNac ? diffFechas(fechaNac, hoy) : null;
  const edadDias = edad ? toDias(edad) : 0;

  // ── Detección de beca ───────────────────────────────────────────────────────
  const tieneBeca = !!(fechaIngreso && fechaNom && fechaIngreso < fechaNom);

  // sinAportes: residente/art48 nunca aportan; becado solo si no eligió aportar
  const sinAportes =
    input.situacion_revista === 'RESIDENTE'   ||
    input.situacion_revista === 'ARTICULO_48' ||
    (input.situacion_revista === 'BECADO' && !input.beca_aporto);

  // Inicio del período "nombrado" (si hay nombramiento; si no, desde ingreso)
  const fechaInicioNombrado = fechaNom ?? fechaIngreso;

  // ── Período de beca (solo si aportó) ────────────────────────────────────────
  let servBeca        = { anios: 0, meses: 0, dias: 0 };
  let servBecaAntes15 = { anios: 0, meses: 0, dias: 0 };
  let servBecaDesde15 = { anios: 0, meses: 0, dias: 0 };

  if (tieneBeca && input.beca_aporto && !sinAportes) {
    servBeca = diffFechas(fechaIngreso!, fechaNom!);
    if (fechaIngreso! < FECHA_CORTE) {
      const corteBeca = fechaNom! < FECHA_CORTE ? fechaNom! : FECHA_CORTE;
      servBecaAntes15 = diffFechas(fechaIngreso!, corteBeca);
      if (fechaNom! > FECHA_CORTE) servBecaDesde15 = diffFechas(FECHA_CORTE, fechaNom!);
    } else {
      servBecaDesde15 = { ...servBeca };
    }
  }

  // ── Período nombrado ─────────────────────────────────────────────────────────
  let servNomb        = { anios: 0, meses: 0, dias: 0 };
  let servNombAntes15 = { anios: 0, meses: 0, dias: 0 };
  let servNombDesde15 = { anios: 0, meses: 0, dias: 0 };

  if (fechaInicioNombrado && !sinAportes) {
    servNomb = diffFechas(fechaInicioNombrado, hoy);
    if (fechaInicioNombrado < FECHA_CORTE) {
      servNombAntes15 = diffFechas(fechaInicioNombrado, FECHA_CORTE);
      servNombDesde15 = diffFechas(FECHA_CORTE, hoy);
    } else {
      servNombDesde15 = { ...servNomb };
    }
  }

  // ── Totales IPS ──────────────────────────────────────────────────────────────
  const servIPSTotal   = sumPeriodos([servBeca, servNomb]);
  const servIPSAntes15 = sumPeriodos([servBecaAntes15, servNombAntes15]);
  const servIPSDesde15 = sumPeriodos([servBecaDesde15, servNombDesde15]);

  // ── ¿Efectivamente insalubre? ────────────────────────────────────────────────
  // Profesión/sector insalubre O pagó el diferencial 2% (retroactivo → ya es insalubre)
  const esInsalubreEfectivo = input.es_insalubre_ips || input.diferencial_2pct_pagado;

  // ── Cargo deudor 2% ──────────────────────────────────────────────────────────
  // Aplica a trabajadores NO insalubres con servicio antes de Jun/2015 que aún
  // no pagaron el diferencial del 2% para transformar ese período en insalubre.
  // Si lo pagaron (diferencial_2pct_pagado=true) → esInsalubreEfectivo=true y el
  // período antes-2015 queda contabilizado como insalubre.
  let cargDeudor2pct    = false;
  let cargDeudorPeriodo = { anios: 0, meses: 0, dias: 0 };

  if (!input.es_insalubre_ips && !input.diferencial_2pct_pagado && fechaInicioNombrado) {
    if (fechaInicioNombrado < FECHA_CORTE) {
      cargDeudor2pct    = true;
      cargDeudorPeriodo = diffFechas(fechaInicioNombrado, FECHA_CORTE);
    }
  }

  // ── Superpuestos — caja de mayor aporte gana el período superpuesto ──────────
  // La caja perdedora conserva solo sus años NO superpuestos ("el resto la continua")
  // Criterio: insalubre (16%) > común; si ambas iguales → más antigüedad gana
  type Sup = { organismo: string; ganador: string; motivo: string } & ReturnType<typeof fromDias>;
  const superpuestos: Sup[] = [];

  let ipsRemainingDias  = toDias(servIPSTotal);
  let ansesAjustadoDias = toDias({ anios: input.anses_anios, meses: input.anses_meses, dias: input.anses_dias });

  function quienGana(
    aInsalubre: boolean, aDias: number,
    bInsalubre: boolean, bDias: number,
    aLabel: string, bLabel: string,
  ): { ganador: string; motivo: string } {
    if (aInsalubre && !bInsalubre)
      return { ganador: aLabel, motivo: `${aLabel} insalubre (16%) > ${bLabel} común — mayor aporte` };
    if (!aInsalubre && bInsalubre)
      return { ganador: bLabel, motivo: `${bLabel} insalubre (16%) > ${aLabel} común — mayor aporte` };
    if (aDias >= bDias)
      return { ganador: aLabel, motivo: `${aLabel} tiene mayor antigüedad acumulada` };
    return { ganador: bLabel, motivo: `${bLabel} tiene mayor antigüedad acumulada` };
  }

  // IPS vs ANSES
  if (ipsRemainingDias > 0 && ansesAjustadoDias > 0) {
    const overlap = Math.min(ipsRemainingDias, ansesAjustadoDias);
    if (overlap > 0) {
      const { ganador, motivo } = quienGana(
        esInsalubreEfectivo, ipsRemainingDias,
        input.anses_insalubre, ansesAjustadoDias,
        'IPS', 'ANSES',
      );
      superpuestos.push({ organismo: 'IPS ↔ ANSES', ganador, motivo, ...fromDias(overlap) });
      if (ganador === 'IPS') ansesAjustadoDias = Math.max(0, ansesAjustadoDias - overlap);
      else                   ipsRemainingDias  = Math.max(0, ipsRemainingDias  - overlap);
    }
  }

  // IPS vs cada servicio externo
  const extAjustados = input.servicios_externos.map(s => {
    const extDias = toDias(s);
    if (extDias === 0 || ipsRemainingDias === 0) return { ...s, ajustadoDias: extDias };
    const overlap = Math.min(ipsRemainingDias, extDias);
    if (overlap === 0) return { ...s, ajustadoDias: extDias };

    const { ganador, motivo } = quienGana(
      esInsalubreEfectivo, ipsRemainingDias,
      s.es_insalubre, extDias,
      'IPS', s.organismo,
    );
    superpuestos.push({ organismo: `IPS ↔ ${s.organismo}`, ganador, motivo, ...fromDias(overlap) });

    if (ganador === 'IPS') {
      return { ...s, ajustadoDias: Math.max(0, extDias - overlap) };
    } else {
      ipsRemainingDias = Math.max(0, ipsRemainingDias - overlap);
      return { ...s, ajustadoDias: extDias };
    }
  });

  const servIPSAjustado = fromDias(ipsRemainingDias);
  const ansesNeto       = fromDias(ansesAjustadoDias);

  // ── Acumulación por tipo ─────────────────────────────────────────────────────
  // Reglas:
  //   · Profesión insalubre (esInsalubreEfectivo) → TODO el servicio IPS = INSALUBRE
  //   · Profesión NO insalubre:
  //       - Beca (aportó)       → INSALUBRE (aportó al 16% desde el inicio)
  //       - Nombrado antes 6/2015 → COMÚN (aportaba al 14%)
  //       - Nombrado desde 6/2015 → INSALUBRE (Decreto 598/2015 aplica a todos)
  // El factor distribuye el descuento por superposición proporcionalmente.
  const insalubrePeriodos: ReturnType<typeof fromDias>[] = [];
  const comunPeriodos:     ReturnType<typeof fromDias>[] = [];

  if (ipsRemainingDias > 0) {
    if (esInsalubreEfectivo) {
      insalubrePeriodos.push(fromDias(ipsRemainingDias));
    } else {
      const ipsTotalDias = toDias(servIPSTotal);
      if (ipsTotalDias > 0) {
        const factor        = ipsRemainingDias / ipsTotalDias;
        const becaAdj       = Math.round((input.beca_aporto ? toDias(servBeca) : 0) * factor);
        const nomb15Adj     = Math.round(toDias(servNombAntes15) * factor);
        const nombD15Adj    = ipsRemainingDias - becaAdj - nomb15Adj;

        if (becaAdj    > 0) insalubrePeriodos.push(fromDias(becaAdj));    // beca → insalubre
        if (nomb15Adj  > 0) comunPeriodos.push(fromDias(nomb15Adj));      // antes 6/2015 → común
        if (nombD15Adj > 0) insalubrePeriodos.push(fromDias(nombD15Adj)); // desde 6/2015 → insalubre
      } else {
        insalubrePeriodos.push(fromDias(ipsRemainingDias));
      }
    }
  }

  if (ansesAjustadoDias > 0) {
    (input.anses_insalubre ? insalubrePeriodos : comunPeriodos).push(ansesNeto);
  }
  for (const ext of extAjustados) {
    if (ext.ajustadoDias > 0) {
      (ext.es_insalubre ? insalubrePeriodos : comunPeriodos).push(fromDias(ext.ajustadoDias));
    }
  }

  const totalInsalubre      = sumPeriodos(insalubrePeriodos);
  const totalComun          = sumPeriodos(comunPeriodos);
  const insalubreProrateado = aplicarProrrateo(totalInsalubre);
  const totalProrateado     = sumPeriodos([insalubreProrateado, totalComun]);

  // ── Elegibilidad ─────────────────────────────────────────────────────────────
  const totalInsalubreDias  = toDias(totalInsalubre);
  const totalComunDias      = toDias(totalComun);
  const totalProrateadoDias = toDias(totalProrateado);

  const insalubreAniosEfectivos = totalInsalubreDias / 365;
  const edadRequeridaMixtaDias  = Math.max(
    REQ_INSALUBRE.edadDias,
    REQ_ORDINARIA.edadDias - Math.round(insalubreAniosEfectivos * (10 / 25) * 365),
  );

  let tipoJubilacion: string | null = null;
  let cumpleServicio = false;
  let cumpleEdad     = false;

  if (totalInsalubreDias >= REQ_INSALUBRE.servicioDias && edadDias >= REQ_INSALUBRE.edadDias) {
    tipoJubilacion = 'AGOTAMIENTO_PREMATURO'; cumpleServicio = true; cumpleEdad = true;
  } else if (totalComunDias >= REQ_ORDINARIA.servicioDias && edadDias >= REQ_ORDINARIA.edadDias) {
    tipoJubilacion = 'ORDINARIA'; cumpleServicio = true; cumpleEdad = true;
  } else if (totalProrateadoDias >= REQ_ORDINARIA.servicioDias && edadDias >= edadRequeridaMixtaDias) {
    tipoJubilacion = 'PRORRATEO'; cumpleServicio = true; cumpleEdad = true;
  }

  // ── Falta ────────────────────────────────────────────────────────────────────
  let reqServicioDias: number;
  let reqEdadDias: number;
  let baseServicioDias: number;

  if (totalInsalubreDias > 0 && totalComunDias > 0) {
    reqServicioDias = REQ_ORDINARIA.servicioDias; reqEdadDias = edadRequeridaMixtaDias; baseServicioDias = totalProrateadoDias;
  } else if (totalInsalubreDias > 0) {
    reqServicioDias = REQ_INSALUBRE.servicioDias; reqEdadDias = REQ_INSALUBRE.edadDias; baseServicioDias = totalInsalubreDias;
  } else {
    reqServicioDias = REQ_ORDINARIA.servicioDias; reqEdadDias = REQ_ORDINARIA.edadDias; baseServicioDias = totalComunDias;
  }

  return {
    // IPS desglose
    tiene_beca:                   tieneBeca,
    beca_aporto:                  input.beca_aporto,
    sin_aportes:                  sinAportes,
    servicio_beca:                servBeca,
    servicio_beca_antes_2015:     servBecaAntes15,
    servicio_beca_desde_2015:     servBecaDesde15,
    servicio_nombrado:            servNomb,
    servicio_nombrado_antes_2015: servNombAntes15,
    servicio_nombrado_desde_2015: servNombDesde15,
    servicio_ips:                 servIPSTotal,
    servicio_ips_antes_2015:      servIPSAntes15,
    servicio_ips_desde_2015:      servIPSDesde15,
    servicio_ips_ajustado:        servIPSAjustado,
    es_insalubre_efectivo:        esInsalubreEfectivo,
    diferencial_2pct_pagado:      input.diferencial_2pct_pagado,
    cargo_deudor_2pct:            cargDeudor2pct,
    cargo_deudor_periodo:         cargDeudorPeriodo,
    // Superpuestos
    anses_neto:                   ansesNeto,
    superpuestos,
    // Totales
    total_insalubre:              totalInsalubre,
    total_comun:                  totalComun,
    total_prorateado:             totalProrateado,
    // Elegibilidad
    edad_actual:                  edad,
    tipo_jubilacion:              tipoJubilacion,
    cumple_servicio:              cumpleServicio,
    cumple_edad:                  cumpleEdad,
    falta_servicio:               fromDias(Math.max(0, reqServicioDias - baseServicioDias)),
    falta_edad:                   fromDias(Math.max(0, reqEdadDias - edadDias)),
    req_servicio_dias:            reqServicioDias,
    req_edad_dias:                reqEdadDias,
    pct_servicio_completado:      reqServicioDias > 0 ? Math.min(100, Math.round(baseServicioDias / reqServicioDias * 100)) : 0,
    pct_edad_completada:          reqEdadDias > 0 ? Math.min(100, Math.round(edadDias / reqEdadDias * 100)) : 0,
  };
}

// ── SQL helper ────────────────────────────────────────────────────────────────
const SQL_AGENTE = `
  SELECT p.dni, p.apellido, p.nombre, p.fecha_nacimiento,
         a.fecha_ingreso, a.fecha_de_nombramiento, l.nombre AS ley_nombre,
         o.nombre AS ocupacion_nombre,
         COALESCE(o.es_insalubre, 0) AS ocupacion_es_insalubre,
         CASE
           WHEN l.nombre LIKE '%[Bb]eca%' OR l.nombre LIKE '%beca%' OR l.nombre LIKE '%Beca%' THEN 'BECADO'
           WHEN l.nombre LIKE '%[Rr]esidente%' OR l.nombre LIKE '%residente%' THEN 'RESIDENTE'
           WHEN l.id = 14 THEN 'ARTICULO_48'
           ELSE 'NORMAL'
         END AS situacion_sugerida
  FROM personal p
  LEFT JOIN agentes a   ON a.dni = p.dni AND a.deleted_at IS NULL
  LEFT JOIN ley l       ON l.id  = a.ley_id
  LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
  WHERE p.dni = :dni AND p.deleted_at IS NULL
  LIMIT 1`;

// ── Router ────────────────────────────────────────────────────────────────────
export function buildJubilacionRouter(sequelize: Sequelize): Router {
  const router = Router();

  // GET /jubilacion/agente-datos/:dni — datos del agente para el form
  router.get(
    '/agente-datos/:dni',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
        return res.json({ ok: true, data: (rows as any[])[0] });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] agente-datos error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/agente/:dni — lista cálculos guardados del agente
  router.get(
    '/agente/:dni',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        const rows = await sequelize.query(
          `SELECT id, apellido, nombre, fecha_nacimiento, fecha_ingreso_ips,
                  ley_nombre, situacion_revista, es_insalubre_ips,
                  anses_anios, anses_meses, anses_dias, anses_insalubre,
                  servicios_externos, resultado, observaciones,
                  creado_por_nombre, modificado_por_nombre, created_at, updated_at
           FROM jubilacion_calculos
           WHERE dni = :dni AND deleted_at IS NULL
           ORDER BY created_at DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT },
        );
        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] list error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/calcular — calcula sin guardar
  router.post(
    '/calcular',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body = parsed.data;

      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });

        const ag        = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          anses_anios:             body.anses_anios,
          anses_meses:             body.anses_meses,
          anses_dias:              body.anses_dias,
          anses_insalubre:         body.anses_insalubre,
          servicios_externos:      body.servicios_externos,
        });

        return res.json({ ok: true, agente: ag, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] calcular error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/guardar — calcula y persiste
  router.post(
    '/guardar',
    rbac('jubilacion_calculos', 'create'),
    async (req: Request, res: Response) => {
      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.id ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });

        const ag        = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          anses_anios:             body.anses_anios,
          anses_meses:             body.anses_meses,
          anses_dias:              body.anses_dias,
          anses_insalubre:         body.anses_insalubre,
          servicios_externos:      body.servicios_externos,
        });

        const [insertResult] = await sequelize.query(
          `INSERT INTO jubilacion_calculos
             (dni, apellido, nombre, fecha_nacimiento, fecha_ingreso_ips, ley_nombre,
              situacion_revista, es_insalubre_ips,
              anses_anios, anses_meses, anses_dias, anses_insalubre,
              servicios_externos, resultado, observaciones,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso_ips, :ley_nombre,
              :situacion_revista, :es_insalubre_ips,
              :anses_anios, :anses_meses, :anses_dias, :anses_insalubre,
              :servicios_externos, :resultado, :observaciones,
              :creado_por, :creado_por_nombre)`,
          {
            replacements: {
              dni:                body.dni,
              apellido:           ag.apellido,
              nombre:             ag.nombre,
              fecha_nacimiento:   ag.fecha_nacimiento   ?? null,
              fecha_ingreso_ips:  ag.fecha_ingreso      ?? null,
              ley_nombre:         ag.ley_nombre         ?? null,
              situacion_revista:  body.situacion_revista,
              es_insalubre_ips:   body.es_insalubre_ips ? 1 : 0,
              anses_anios:        body.anses_anios,
              anses_meses:        body.anses_meses,
              anses_dias:         body.anses_dias,
              anses_insalubre:    body.anses_insalubre ? 1 : 0,
              servicios_externos: JSON.stringify(body.servicios_externos),
              resultado:          JSON.stringify(resultado),
              observaciones:      body.observaciones ?? null,
              creado_por:         userId,
              creado_por_nombre:  userName,
            },
            type: QueryTypes.INSERT,
          },
        );

        return res.status(201).json({ ok: true, id: insertResult, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] guardar error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PUT /jubilacion/:id — actualiza
  router.put(
    '/:id',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.id ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: 'Agente no encontrado' });

        const ag        = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          anses_anios:             body.anses_anios,
          anses_meses:             body.anses_meses,
          anses_dias:              body.anses_dias,
          anses_insalubre:         body.anses_insalubre,
          servicios_externos:      body.servicios_externos,
        });

        await sequelize.query(
          `UPDATE jubilacion_calculos
           SET situacion_revista      = :situacion_revista,
               es_insalubre_ips       = :es_insalubre_ips,
               anses_anios            = :anses_anios,
               anses_meses            = :anses_meses,
               anses_dias             = :anses_dias,
               anses_insalubre        = :anses_insalubre,
               servicios_externos     = :servicios_externos,
               resultado              = :resultado,
               observaciones          = :observaciones,
               modificado_por         = :modificado_por,
               modificado_por_nombre  = :modificado_por_nombre
           WHERE id = :id AND deleted_at IS NULL`,
          {
            replacements: {
              id,
              situacion_revista:     body.situacion_revista,
              es_insalubre_ips:      body.es_insalubre_ips ? 1 : 0,
              anses_anios:           body.anses_anios,
              anses_meses:           body.anses_meses,
              anses_dias:            body.anses_dias,
              anses_insalubre:       body.anses_insalubre ? 1 : 0,
              servicios_externos:    JSON.stringify(body.servicios_externos),
              resultado:             JSON.stringify(resultado),
              observaciones:         body.observaciones ?? null,
              modificado_por:        userId,
              modificado_por_nombre: userName,
            },
            type: QueryTypes.UPDATE,
          },
        );

        return res.json({ ok: true, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] update error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // DELETE /jubilacion/:id — soft delete
  router.delete(
    '/:id',
    rbac('jubilacion_calculos', 'delete'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
      try {
        await sequelize.query(
          `UPDATE jubilacion_calculos SET deleted_at = NOW() WHERE id = :id AND deleted_at IS NULL`,
          { replacements: { id }, type: QueryTypes.UPDATE },
        );
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  return router;
}
