/**
 * @file services/jubilacionCarga.service.ts
 * Checklist de carga del trámite jubilatorio y cálculo del período de alerta.
 *
 * El IPS trabaja con bajas a fin de trimestre. Los papeles se presentan del 1 al
 * 10 del mes que cae TRES meses antes del mes de baja (cronograma espejado en el
 * front, en CRONOGRAMA_JUBILACION de HerramientasPage).
 *
 *   Baja 31/03 → papeles del 1 al 10 de diciembre (año anterior)
 *   Baja 30/06 → papeles del 1 al 10 de marzo
 *   Baja 30/09 → papeles del 1 al 10 de junio
 *   Baja 31/12 → papeles del 1 al 10 de septiembre
 *
 * Entre el cierre de una ventana (día 10) y la apertura de la siguiente (día 1
 * del mes +3) queda el hueco donde hay que cargar en SIAPE. La alerta de carga
 * salta en el punto medio de ese hueco: con papeles en marzo cae alrededor del
 * 20 de abril. Se calcula, no se hardcodea: si el IPS mueve el cronograma
 * alcanza con tocar MES_PRESENTACION.
 */

export const ITEMS_CHECKLIST = [
  'DOCUMENTACION',
  'IFGRA',
  'EXPEDIENTE_GDEBA',
  'SIAPE',
  'INTRANET',
  'RESOLUCION',
  'EXPEDIENTE_IPS',
] as const;

export type ItemChecklist = typeof ITEMS_CHECKLIST[number];

export type MesCorte = 'MARZO' | 'JUNIO' | 'SEPTIEMBRE' | 'DICIEMBRE';

// Mes de baja → mes en que se presentan los papeles (1-12) y cuántos años antes.
// Marzo es el único que presenta en el año anterior (diciembre).
const MES_PRESENTACION: Record<MesCorte, { mes: number; offsetAnio: number }> = {
  MARZO:      { mes: 12, offsetAnio: -1 },
  JUNIO:      { mes: 3,  offsetAnio: 0  },
  SEPTIEMBRE: { mes: 6,  offsetAnio: 0  },
  DICIEMBRE:  { mes: 9,  offsetAnio: 0  },
};

const DIA_APERTURA = 1;   // la ventana de presentación abre el 1
const DIA_CIERRE   = 10;  // y cierra el 10

export type PeriodoCarga = {
  /** Identificador estable del período: '<año de baja>-<MES_CORTE>', ej. '2026-JUNIO' */
  periodo: string;
  /** Año en que cae la baja */
  anioBaja: number;
  /** Cierre de la ventana de presentación de papeles (ISO) */
  fechaCierrePapeles: string;
  /** Apertura de la ventana siguiente (ISO) */
  fechaAperturaSiguiente: string;
  /** Punto medio: el día en que salta la alerta de carga (ISO) */
  fechaAlerta: string;
};

const toISO = (d: Date): string => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

/** Hoy en ISO, en hora local. toISOString() devuelve UTC y adelanta el día. */
export function fechaLocalISO(d: Date = new Date()): string {
  return toISO(d);
}

/**
 * Período de carga de un agente con ese mes de corte, para un año de baja dado.
 */
export function periodoCarga(mesCorte: MesCorte, anioBaja: number): PeriodoCarga {
  const { mes, offsetAnio } = MES_PRESENTACION[mesCorte];
  const anioPresentacion = anioBaja + offsetAnio;

  const cierre = new Date(anioPresentacion, mes - 1, DIA_CIERRE);
  // La ventana siguiente abre tres meses después (el Date normaliza el año).
  const apertura = new Date(anioPresentacion, mes - 1 + 3, DIA_APERTURA);

  const medio = new Date(cierre.getTime() + (apertura.getTime() - cierre.getTime()) / 2);
  medio.setHours(0, 0, 0, 0);

  return {
    periodo: `${anioBaja}-${mesCorte}`,
    anioBaja,
    fechaCierrePapeles:     toISO(cierre),
    fechaAperturaSiguiente: toISO(apertura),
    fechaAlerta:            toISO(medio),
  };
}

/**
 * Período vigente para ese mes de corte a la fecha dada: el que corresponde a la
 * próxima baja que todavía no ocurrió. Si la baja de este año ya pasó, mira la
 * del año que viene.
 *
 * `fechaJubilacion` (si está cargada en la ficha) manda sobre el almanaque: el
 * año de baja sale de ahí, así un agente que se jubila en 2027 no arrastra la
 * alerta del período 2026.
 */
export function periodoVigente(
  mesCorte: MesCorte,
  hoy: Date = new Date(),
  fechaJubilacion?: string | null,
): PeriodoCarga {
  if (fechaJubilacion) {
    const anio = Number(String(fechaJubilacion).slice(0, 4));
    if (Number.isFinite(anio) && anio > 1900) return periodoCarga(mesCorte, anio);
  }

  // Último día del mes de baja de este año: si ya pasó, el período es el próximo.
  const mesBaja = { MARZO: 3, JUNIO: 6, SEPTIEMBRE: 9, DICIEMBRE: 12 }[mesCorte];
  const finBaja = new Date(hoy.getFullYear(), mesBaja, 0); // día 0 del mes siguiente = último del mes
  finBaja.setHours(23, 59, 59, 999);

  return periodoCarga(mesCorte, hoy > finBaja ? hoy.getFullYear() + 1 : hoy.getFullYear());
}

/**
 * ¿Ya corresponde avisar? True cuando hoy alcanzó el punto medio del hueco.
 */
export function alertaVencida(periodo: PeriodoCarga, hoy: Date = new Date()): boolean {
  const h = new Date(hoy); h.setHours(0, 0, 0, 0);
  const [y, m, d] = periodo.fechaAlerta.split('-').map(Number);
  return h.getTime() >= new Date(y, m - 1, d).getTime();
}

// ── Corte que corresponde al dar de alta ─────────────────────────────────────
// El mes de corte no se elige a mano: es el primer corte cuya ventana de
// presentación de papeles todavía NO cerró (el día 10 del mes que va tres meses
// antes de la baja). Pasado el 10, ese corte ya no se alcanza y el agente va al
// siguiente.
//
// Se puede atrasar a un corte anterior (trámite que se está regularizando),
// nunca adelantar a uno posterior: eso lo valida el endpoint contra
// corteVigente().

const MES_BAJA: Record<MesCorte, number> = {
  MARZO: 3, JUNIO: 6, SEPTIEMBRE: 9, DICIEMBRE: 12,
};
const MESES_CORTE = Object.keys(MES_BAJA) as MesCorte[];

export type OpcionCorte = {
  mesCorte: MesCorte;
  anioBaja: number;
  /** Fin del trimestre: la baja efectiva (ISO) */
  fechaBaja: string;
  /** Ventana de presentación de papeles (ISO) */
  papelesDesde: string;
  papelesHasta: string;
  /** true en el corte que corresponde hoy */
  vigente: boolean;
};

/** Último día del mes de baja de ese corte. */
function fechaBaja(mesCorte: MesCorte, anio: number): Date {
  return new Date(anio, MES_BAJA[mesCorte], 0); // día 0 del mes siguiente
}

function armarOpcion(mesCorte: MesCorte, anioBaja: number, vigente: boolean): OpcionCorte {
  const per = periodoCarga(mesCorte, anioBaja);
  const [y, m] = per.fechaCierrePapeles.split('-').map(Number);
  return {
    mesCorte,
    anioBaja,
    fechaBaja:    toISO(fechaBaja(mesCorte, anioBaja)),
    papelesDesde: toISO(new Date(y, m - 1, DIA_APERTURA)),
    papelesHasta: per.fechaCierrePapeles,
    vigente,
  };
}

/**
 * Corte al que entra un agente dado de alta hoy: el de ventana de papeles más
 * próxima que todavía no cerró.
 */
export function corteVigente(hoy: Date = new Date()): OpcionCorte {
  const h = new Date(hoy); h.setHours(0, 0, 0, 0);

  // Candidatos de este año y del que viene, ordenados por fecha de baja.
  const candidatos: Array<{ mesCorte: MesCorte; anio: number; cierre: Date }> = [];
  for (const anio of [h.getFullYear(), h.getFullYear() + 1]) {
    for (const mesCorte of MESES_CORTE) {
      const [y, m, d] = periodoCarga(mesCorte, anio).fechaCierrePapeles.split('-').map(Number);
      candidatos.push({ mesCorte, anio, cierre: new Date(y, m - 1, d) });
    }
  }
  candidatos.sort((a, b) => a.cierre.getTime() - b.cierre.getTime());

  const elegido = candidatos.find((c) => c.cierre.getTime() >= h.getTime()) ?? candidatos[candidatos.length - 1];
  return armarOpcion(elegido.mesCorte, elegido.anio, true);
}

/**
 * Opciones ofrecidas al cargar un agente: el corte vigente y los `atras`
 * anteriores. Nunca uno posterior.
 */
export function opcionesCorte(hoy: Date = new Date(), atras = 4): OpcionCorte[] {
  const vig = corteVigente(hoy);
  const out: OpcionCorte[] = [vig];

  let mesCorte = vig.mesCorte;
  let anio     = vig.anioBaja;
  for (let i = 0; i < atras; i++) {
    const idx = MESES_CORTE.indexOf(mesCorte);
    if (idx === 0) { mesCorte = MESES_CORTE[MESES_CORTE.length - 1]; anio -= 1; }
    else           { mesCorte = MESES_CORTE[idx - 1]; }
    out.push(armarOpcion(mesCorte, anio, false));
  }
  return out;
}

// ── Excepción con fecha de vencimiento ───────────────────────────────────────
// La ventana de papeles de septiembre 2026 cerró el día 10, así que a partir del
// 11 el corte que corresponde pasó a ser marzo 2027. Por pedido expreso, durante
// la semana del 20 al 27/09/2026 las altas siguen saliendo preseleccionadas en
// diciembre 2026.
//
// Es SÓLO el valor por defecto del selector: diciembre ya era elegible como
// corte atrasado y la validación de "no adelantar" no cambia. Vence sola el
// 28/09/2026 y a partir de ahí esta constante puede borrarse.
const EXCEPCION_DICIEMBRE_2026_HASTA = '2026-09-27';

/**
 * Corte que el front preselecciona. Igual al vigente salvo que corra una
 * excepción vigente.
 */
export function corteSugerido(hoy: Date = new Date()): OpcionCorte {
  if (fechaLocalISO(hoy) <= EXCEPCION_DICIEMBRE_2026_HASTA) {
    const dic = opcionesCorte(hoy).find((o) => o.mesCorte === 'DICIEMBRE' && o.anioBaja === 2026);
    if (dic) return dic;
  }
  return corteVigente(hoy);
}

/**
 * ¿Ese corte es posterior al vigente? Es lo único que no se permite.
 * `anioBaja` sale de fecha_jubilacion cuando está cargada.
 */
export function corteEsPosteriorAlVigente(
  mesCorte: MesCorte,
  anioBaja: number,
  hoy: Date = new Date(),
): boolean {
  const vig = corteVigente(hoy);
  return fechaBaja(mesCorte, anioBaja).getTime() > fechaBaja(vig.mesCorte, vig.anioBaja).getTime();
}

/** Ítems que faltan tildar, en el orden del trámite. */
export function itemsFaltantes(tildados: string[]): ItemChecklist[] {
  const hechos = new Set(tildados);
  return ITEMS_CHECKLIST.filter((i) => !hechos.has(i));
}
