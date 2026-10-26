import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../api/http';

// Bloque "Fichajes y horario" de la pestaña Info: horario vigente del agente, cómo viene hoy, última marca en el
// reloj y los últimos 7 días. Mismo criterio que la pestaña Fichajes de Asistencia. Backend: GET /fichajes-agentes/reciente.

type Tipo = 'E' | 'S' | null;
interface Dia {
  fecha: string; dow: number; horario: string | null; aprox: boolean;
  marcas: { h: string; t: Tipo }[]; entrada: string | null; salida: string | null;
  tardeMin: number; antesMin: number; despuesMin: number; motivos: string[]; estado: string;
  justifica: string | null; feriado: string | null; presenteSinFichar: boolean;
}
interface Resp {
  ok: boolean; error?: string; hoy: string; enReloj: boolean; errorFichadas: string | null;
  horario: { dow: number; entrada: string | null; salida: string | null; cruza: boolean }[] | null;
  horarioFoto: string | null; regimen: string | null;
  ultima: { fecha: string; hora: string; tipo: Tipo } | null;
  dias: Dia[];
}

const DOW_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DOW_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const fmtDia = (iso: string) => `${DOW_CORTO[new Date(`${iso}T12:00:00`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/');
const noLeToca = (d: Dia) => d.motivos.some(m => m.startsWith('esta semana no le toca'));

const VERDE = '#4ade80', AMBAR = '#fbbf24', ROJO = '#f87171', AZUL = '#60a5fa', CELESTE = '#22d3ee', VIOLETA = '#a78bfa', GRIS = '#64748b';

/** Etiqueta y color del estado del día (los de evaluarAgente en fichajesAgentes.routes.ts). */
function estadoDe(d: Dia): { txt: string; color: string } {
  switch (d.estado) {
    case 'OK':           return { txt: 'Bien', color: VERDE };
    case 'DESPUES':      return { txt: `Bien · se quedó ${d.despuesMin}′`, color: VERDE };
    case 'TARDE':        return { txt: `Tarde ${d.tardeMin}′`, color: AMBAR };
    case 'ANTES':        return { txt: `Se fue ${d.antesMin}′ antes`, color: AMBAR };
    case 'TARDE_ANTES':  return { txt: `Tarde ${d.tardeMin}′ · se fue ${d.antesMin}′ antes`, color: AMBAR };
    case 'OTRO_HORARIO': return { txt: 'Fichó otro horario', color: AMBAR };
    case 'INCOMPLETA':   return { txt: d.entrada ? 'Sin salida' : 'Sin entrada', color: AMBAR };
    case 'FALTA':        return { txt: d.presenteSinFichar ? 'Falta · PRESENTE en SIAPE' : 'Falta sin justificar', color: ROJO };
    case 'LICENCIA':     return { txt: d.justifica || 'Licencia', color: AZUL };
    case 'FERIADO':      return { txt: `Feriado${d.feriado ? ` · ${d.feriado}` : ''}`, color: GRIS };
    case 'EXTRA':        return { txt: 'Fichó fuera de horario', color: VIOLETA };
    case 'HOY':          return { txt: 'Turno en curso', color: CELESTE };
    default:             return d.justifica
                           ? { txt: d.justifica, color: AZUL }
                           : { txt: noLeToca(d) ? 'No le toca (alterna)' : 'No le toca', color: GRIS };
  }
}

/** Qué se muestra en "Fichó": entrada → salida evaluadas; en el turno en curso, las marcas crudas del día. */
function fichoDe(d: Dia): string {
  if (d.estado === 'HOY') return d.marcas.length ? d.marcas.map(m => `${m.h}${m.t ? ` ${m.t}` : ''}`).join(' · ') : 'todavía no fichó';
  if (!d.entrada && !d.salida) return '—';
  return `${d.entrada ?? '¿?'} → ${d.salida ?? '¿?'}`;
}

function HoyTile({ d }: { d: Dia | undefined }) {
  let txt = 'Sin datos', color = GRIS, detalle: string | null = null;
  if (d) {
    const ent = d.horario?.split('–')[0];
    if (!d.horario) { txt = d.marcas.length ? 'Hoy no le toca, pero fichó' : 'Hoy no le toca'; color = d.marcas.length ? VIOLETA : GRIS; }
    else if (noLeToca(d)) { txt = 'Esta semana no le toca'; }
    else if (d.estado === 'HOY') {
      if (d.marcas.length) { txt = `Fichó ${d.marcas[0].h}`; color = VERDE; }
      else { txt = `Todavía no fichó · entra ${ent}`; color = CELESTE; }
    } else ({ txt, color } = estadoDe(d));
    detalle = d.horario ? `Le toca ${d.horario}` : null;
    if (d.justifica && d.estado !== 'LICENCIA') detalle = `${detalle ? `${detalle} · ` : ''}${d.justifica}`;
    if (d.marcas.length && d.estado !== 'HOY') detalle = `${detalle ? `${detalle} · ` : ''}marcas ${d.marcas.map(m => m.h).join(', ')}`;
  }
  return (
    <div className="agente-mini-card" style={{ borderColor: `${color}66`, background: `${color}12` }}>
      <span className="agente-mini-label">Hoy</span>
      <span className="agente-mini-value" style={{ color }}>{txt}</span>
      {detalle && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{detalle}</span>}
    </div>
  );
}

function SemanaHorario({ r, alterna }: { r: Resp; alterna: string | null }) {
  if (!r.horario) return <div style={{ fontSize: '0.78rem', color: GRIS }}>Sin horario cargado en SIAPE</div>;
  const hoyDow = new Date(`${r.hoy}T12:00:00`).getDay();
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {r.horario.map(h => {
          const esHoy = h.dow === hoyDow;
          return (
            <div key={h.dow} style={{
              textAlign: 'center', borderRadius: 6, padding: '4px 2px',
              background: h.entrada ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${esHoy ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.07)'}`,
            }}>
              <div style={{ fontSize: '0.66rem', color: esHoy ? CELESTE : GRIS, fontWeight: 700 }}>{DOW_LETRA[h.dow]}</div>
              {h.entrada
                ? <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#e2e8f0', lineHeight: 1.25 }}>
                    {h.entrada}<br />{h.salida}{h.cruza ? <sup style={{ color: GRIS }}>+1</sup> : null}
                  </div>
                : <div style={{ fontSize: '0.7rem', color: '#475569' }}>—</div>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: '0.68rem', color: GRIS, marginTop: 4 }}>
        {alterna && <><span style={{ color: AMBAR }}>Alterna semanas {alterna}</span> · </>}
        {r.regimen && <>{r.regimen} · </>}horario SIAPE del {r.horarioFoto ? fmtFecha(r.horarioFoto) : '—'}
      </div>
    </>
  );
}

export function FichajesRecienteBlock({ dni }: { dni: string }) {
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResp(null);
    setError(null);
    if (!dni) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<Resp>(`/fichajes-agentes/reciente?dni=${encodeURIComponent(dni)}`)
      .then(r => { if (!cancelled) r?.ok ? setResp(r) : setError(r?.error || 'Error'); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dni]);

  const hoy = resp?.dias.find(d => d.fecha === resp.hoy);
  const alterna = resp?.dias.flatMap(d => d.motivos).map(m => /alterna ([^)]+)\)/.exec(m)?.[1]).find(Boolean) ?? null;
  const hayAprox = resp?.dias.some(d => d.aprox);

  return (
    <div className="agente-servicio-block">
      <span className="agente-servicio-title">Fichajes y horario</span>
      {loading && <div style={{ fontSize: '0.78rem', color: GRIS }}>⏳ Leyendo fichadas…</div>}
      {error && <div style={{ fontSize: '0.78rem', color: ROJO }}>{error}</div>}
      {resp && (
        <>
          {resp.errorFichadas && <div style={{ fontSize: '0.75rem', color: ROJO, marginBottom: 6 }}>{resp.errorFichadas}</div>}
          {!resp.enReloj && !resp.errorFichadas && (
            <div style={{ fontSize: '0.75rem', color: AMBAR, marginBottom: 6 }}>No está dado de alta en los relojes</div>
          )}

          <div className="agente-mini-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <HoyTile d={hoy} />
            <div className="agente-mini-card">
              <span className="agente-mini-label">Última fichada</span>
              {resp.ultima
                ? <>
                    <span className="agente-mini-value">
                      {fmtDia(resp.ultima.fecha)} · {resp.ultima.hora}
                      {resp.ultima.tipo && <span style={{ color: GRIS, fontWeight: 400 }}> ({resp.ultima.tipo === 'E' ? 'entrada' : 'salida'})</span>}
                    </span>
                    {resp.ultima.fecha.slice(0, 4) !== resp.hoy.slice(0, 4) && (
                      <span style={{ fontSize: '0.72rem', color: GRIS }}>{fmtFecha(resp.ultima.fecha)}</span>
                    )}
                  </>
                : <span className="agente-mini-value" style={{ color: GRIS }}>Nunca fichó</span>}
            </div>
          </div>

          <div style={{ fontSize: '0.66rem', color: GRIS, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '10px 0 4px' }}>
            Le corresponde
          </div>
          <SemanaHorario r={resp} alterna={alterna} />

          <div style={{ fontSize: '0.66rem', color: GRIS, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '10px 0 4px' }}>
            Últimos 7 días
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: GRIS }}>
                <th style={{ padding: '3px 4px', fontWeight: 600 }}>Día</th>
                <th style={{ padding: '3px 4px', fontWeight: 600 }}>Le toca</th>
                <th style={{ padding: '3px 4px', fontWeight: 600 }}>Fichó</th>
                <th style={{ padding: '3px 4px', fontWeight: 600 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {resp.dias.map(d => {
                const e = estadoDe(d);
                const toca = d.horario && !noLeToca(d);
                return (
                  <tr key={d.fecha} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '3px 4px', whiteSpace: 'nowrap', color: d.fecha === resp.hoy ? CELESTE : '#cbd5e1' }}>{fmtDia(d.fecha)}</td>
                    <td style={{ padding: '3px 4px', fontFamily: 'monospace', whiteSpace: 'nowrap', color: toca ? '#e2e8f0' : '#475569' }}>
                      {toca ? d.horario : '—'}{toca && d.aprox && <span title="Horario actual: no hay foto del horario de ese día" style={{ color: GRIS }}> ≈</span>}
                    </td>
                    <td style={{ padding: '3px 4px', fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#e2e8f0' }}>{fichoDe(d)}</td>
                    <td style={{ padding: '3px 4px', color: e.color, fontWeight: 600 }} title={d.motivos.join(' · ') || undefined}>{e.txt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: '0.68rem', color: GRIS, marginTop: 4 }}>
            Tolerancia 30′ · mismo criterio que Asistencia → Fichajes{hayAprox && ' · ≈ = con el horario actual (no hay foto de ese día)'}
          </div>
        </>
      )}
    </div>
  );
}
