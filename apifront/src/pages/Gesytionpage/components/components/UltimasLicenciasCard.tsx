import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../api/http';

// Última licencia de cada tipo del agente en el archivo del Ministerio (MINISTERIO/UPA4/UPA18.xls)
// (si no está ahí, de la tabla anual del Ministerio) y en SIAPE (SIAPE.xlsx), lado a lado, con la fecha de cada archivo. Backend: GET /ultimas-licencias.

interface Lic { novedad: string; desde: string; hasta: string | null; origen: string; tablaAnual?: boolean }
interface Fila { ministerio: Lic | null; siape: Lic | null; coincide: boolean | null; grupo: 'ANUAL' | 'COMPLEMENTARIA' | 'OTRA' }
interface Archivo { archivo: string; fecha: string | null; filas: number; error?: string }
interface Resp { ok: boolean; data: Fila[]; archivos: { ministerio: Archivo[]; siape: Archivo[] }; error?: string }

const fmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const COLOR_GRUPO: Record<Fila['grupo'], string> = { ANUAL: '#60a5fa', COMPLEMENTARIA: '#a78bfa', OTRA: '#94a3b8' };

function Celda({ l, conOrigen }: { l: Lic | null; conOrigen?: boolean }) {
  if (!l) return <td style={{ padding: '4px 6px', opacity: 0.5 }}>— no figura —</td>;
  return (
    <td style={{ padding: '4px 6px' }}>
      <div style={{ fontWeight: 600 }}>{l.novedad}</div>
      <div style={{ fontFamily: 'monospace' }}>{fmt(l.desde)} → {fmt(l.hasta ?? l.desde)}</div>
      {conOrigen && l.origen && <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{l.origen}{l.tablaAnual ? ' · tabla anual' : ''}</div>}
    </td>
  );
}

function PieArchivos({ titulo, archivos }: { titulo: string; archivos: Archivo[] }) {
  return (
    <div>
      <strong>{titulo}:</strong>{' '}
      {archivos.map((a, i) => (
        <span key={a.archivo} style={{ color: a.error ? '#f87171' : undefined }}>
          {i > 0 && ' · '}{a.archivo} {a.error ? `(${a.error})` : `del ${fmtHora(a.fecha)}`}
        </span>
      ))}
    </div>
  );
}

export type UltimasLicencias = { resp: Resp | null; loading: boolean; error: string | null };
export type { Fila as UltimaLicenciaFila, Lic as UltimaLicencia, Resp as UltimasLicenciasResp };
export { fmt as fmtFechaLic, fmtHora as fmtHoraArchivo };

/** Trae /ultimas-licencias para los DNIs del agente (incluye DNIs anteriores por cambio de DNI). */
export function useUltimasLicencias(dnisKey: string): UltimasLicencias {
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResp(null);
    setError(null);
    if (!dnisKey) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<Resp>(`/ultimas-licencias?dni=${encodeURIComponent(dnisKey)}`)
      .then(r => { if (!cancelled) r?.ok ? setResp(r) : setError(r?.error || 'Error'); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dnisKey]);

  return { resp, loading, error };
}

export function UltimasLicenciasCard({ dnisKey, datos }: { dnisKey: string; datos: UltimasLicencias }) {
  const { resp, loading, error } = datos;

  if (!dnisKey) return null;

  return (
    <div className="card gp-card-14" style={{ fontSize: '0.8rem' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🗓️ Últimas licencias — Ministerio vs SIAPE</div>
      {loading && <div>🔄 Leyendo archivos…</div>}
      {error && <div style={{ color: '#f87171' }}>{error}</div>}
      {resp && (
        <>
          {resp.data.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Sin licencias en ninguno de los dos archivos.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', opacity: 0.7 }}>
                    <th style={{ padding: '4px 6px' }}>Tipo</th>
                    <th style={{ padding: '4px 6px' }}>Ministerio</th>
                    <th style={{ padding: '4px 6px' }}>SIAPE</th>
                  </tr>
                </thead>
                <tbody>
                  {resp.data.map((f, i) => {
                    const distinto = f.coincide === false || (f.grupo !== 'OTRA' && (!f.ministerio || !f.siape));
                    return (
                      <tr key={i} style={{
                        borderTop: '1px solid rgba(148,163,184,0.2)',
                        background: distinto ? 'rgba(245,158,11,0.10)' : undefined,
                      }}>
                        <td style={{ padding: '4px 6px', color: COLOR_GRUPO[f.grupo], fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {f.grupo === 'ANUAL' ? 'Anual' : f.grupo === 'COMPLEMENTARIA' ? 'Complementaria' : 'Otra'}
                          {f.coincide === true && <span title="Mismas fechas en los dos" style={{ color: '#4ade80' }}> ✓</span>}
                          {f.coincide === false && <span title="Fechas distintas" style={{ color: '#fbbf24' }}> ≠</span>}
                        </td>
                        <Celda l={f.ministerio} conOrigen />
                        <Celda l={f.siape} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: '0.72rem', opacity: 0.75, display: 'grid', gap: 2 }}>
            <PieArchivos titulo="Ministerio" archivos={resp.archivos.ministerio} />
            <PieArchivos titulo="SIAPE" archivos={resp.archivos.siape} />
          </div>
        </>
      )}
    </div>
  );
}
