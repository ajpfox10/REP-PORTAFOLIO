// src/pages/BecariosArtPage/CruceArtTab.tsx
// Pestaña "Cruce ART ↔ base" de Carga de ART: padrón de ProvinciART del establecimiento Catán
// (tabla art_nomina, la baja el robot "Cruce padrón ART ↔ base" de la página Robots) contra agentes.
// - A dar de baja: siguen en ART y en la base no tienen ningún tramo vigente (los encola el robot
//   y los da de baja "Baja de trabajadores en ART").
// - En ART y no en la base.
// - En la base y no en ART: activos (sin reemplazantes) + aparte comisión / trámite / inactivo.

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Fila = Record<string, any>;
interface Cruce {
  descargado_en: string | null;
  total_nomina: number;
  a_dar_de_baja: Fila[];
  en_art_no_en_base: Fila[];
  en_base_no_en_art: Fila[];
}

const S = {
  panel: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 16, marginBottom: 14 },
  th: { padding: '5px 8px', textAlign: 'left' as const, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, color: '#94a3b8', whiteSpace: 'nowrap' as const, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '6px 8px', fontSize: '0.78rem', verticalAlign: 'top' as const, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  btn: { cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontWeight: 600, fontSize: '0.74rem', border: 'none' },
  badge: { borderRadius: 4, padding: '2px 7px', fontSize: '0.7rem', fontWeight: 700 },
  vacio: { color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem', padding: '10px 0' },
};

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(d?: string | null) {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}
function fmtCuil(c?: string | null) {
  const d = String(c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (c || '—');
}

const ESTADO_COLA: Record<string, [string, string, string]> = {
  PENDING:    ['Encolado',   'rgba(59,130,246,0.15)', '#93c5fd'],
  PROCESSING: ['Procesando', 'rgba(245,158,11,0.15)', '#fbbf24'],
  ERROR:      ['Error',      'rgba(239,68,68,0.15)',  '#f87171'],
  DONE:       ['Hecho',      'rgba(34,197,94,0.15)',  '#4ade80'],
  SKIPPED:    ['Salteado',   'rgba(148,163,184,0.15)', '#cbd5e1'],
};
function BadgeCola({ status }: { status?: string | null }) {
  if (!status) return <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>;
  const [l, bg, c] = ESTADO_COLA[status] ?? [status, 'rgba(255,255,255,0.06)', '#cbd5e1'];
  return <span style={{ ...S.badge, background: bg, color: c }}>{l}</span>;
}

function Seccion({ titulo, ayuda, color, n, children }: { titulo: string; ayuda: string; color: string; n: number; children: React.ReactNode }) {
  return (
    <div style={S.panel}>
      <div style={{ fontWeight: 700, color }}>{titulo}: {n}</div>
      <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', margin: '2px 0 10px' }}>{ayuda}</div>
      {children}
    </div>
  );
}

export function CruceArtTab() {
  const toast = useToast();
  const [d, setD] = useState<Cruce | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enCurso, setEnCurso] = useState<Record<string, boolean>>({});
  const [verOtros, setVerOtros] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<any>('/becarios-art/cruce');
      if (r?.ok) setD(r);
      else toast.error('No se pudo armar el cruce', r?.error);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setCargando(false);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  async function accion(key: string, url: string, okMsg: string) {
    setEnCurso(p => ({ ...p, [key]: true }));
    try {
      const r = await apiFetch<any>(url, { method: 'POST', body: JSON.stringify({}) });
      if (r?.ok) { toast.ok(okMsg); cargar(); }
      else toast.error(r?.error ?? 'No se pudo');
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setEnCurso(p => ({ ...p, [key]: false }));
    }
  }

  const activos = (d?.en_base_no_en_art ?? []).filter(f => Number(f.activo) === 1);
  const otros = (d?.en_base_no_en_art ?? []).filter(f => Number(f.activo) !== 1);

  return (
    <div>
      <div style={{ ...S.panel, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>Cruce del padrón de ART con la base</div>
          <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            Padrón de ProvinciART del establecimiento Catán (488242): <strong>{d?.total_nomina ?? 0}</strong> trabajadores,
            bajado el <strong>{fmt(d?.descargado_en)}</strong>. Se actualiza con el robot "Cruce padrón ART ↔ base" de la página Robots.
          </div>
        </div>
        <button style={{ ...S.btn, background: '#334155', color: '#94a3b8' }} onClick={cargar} disabled={cargando} title="Recargar">
          {cargando ? '…' : '↺'}
        </button>
      </div>

      <Seccion titulo="A dar de baja en ART" color="#f87171" n={d?.a_dar_de_baja.length ?? 0}
        ayuda="Siguen en el padrón de ART y en la base no tienen ningún tramo vigente. Los da de baja el robot 'Baja de trabajadores en ART'.">
        {!d?.a_dar_de_baja.length ? <div style={S.vacio}>Nadie: el padrón de ART no tiene agentes dados de baja en la base.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead><tr>
              <th style={S.th}>Trabajador (ART)</th><th style={S.th}>DNI</th><th style={S.th}>CUIL</th>
              <th style={S.th}>Egreso (base)</th><th style={S.th}>Baja en ART</th><th style={S.th}>Detalle</th><th style={S.th}></th>
            </tr></thead>
            <tbody>
              {d.a_dar_de_baja.map(f => (
                <tr key={`b${f.dni}`}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{f.trabajador}</td>
                  <td style={S.td}>{f.dni}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{fmtCuil(f.cuil)}</td>
                  <td style={S.td}>{fmtFecha(f.fecha_egreso)}</td>
                  <td style={S.td}><BadgeCola status={f.baja_status} /></td>
                  <td style={{ ...S.td, fontSize: '0.72rem', color: '#fca5a5', maxWidth: 320 }}>{f.baja_error ?? ''}</td>
                  <td style={{ ...S.td, textAlign: 'right' as const }}>
                    {f.baja_status !== 'PENDING' && f.baja_status !== 'PROCESSING' && (
                      <button style={{ ...S.btn, background: '#b91c1c', color: '#fff' }} disabled={enCurso[`b${f.dni}`]}
                        onClick={() => accion(`b${f.dni}`, `/becarios-art/bajas/${f.dni}/reintentar`, 'Encolado para dar de baja')}>
                        {enCurso[`b${f.dni}`] ? '…' : 'Dar de baja'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>

      <Seccion titulo="En ART y no en la base" color="#c4b5fd" n={d?.en_art_no_en_base.length ?? 0}
        ayuda="Figuran en el padrón de ART de Catán pero no hay ningún agente con ese DNI. Revisar: cargarlos en la base o sacarlos de ART.">
        {!d?.en_art_no_en_base.length ? <div style={S.vacio}>Nadie.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead><tr>
              <th style={S.th}>Trabajador (ART)</th><th style={S.th}>DNI</th><th style={S.th}>CUIL</th><th style={S.th}>Email</th><th style={S.th}>¿En personal?</th>
            </tr></thead>
            <tbody>
              {d.en_art_no_en_base.map(f => (
                <tr key={`a${f.cuil}`}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{f.trabajador}</td>
                  <td style={S.td}>{f.dni ?? '—'}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{fmtCuil(f.cuil)}</td>
                  <td style={S.td}>{f.email ?? '—'}</td>
                  <td style={S.td}>{Number(f.en_personal) ? 'Sí, sin tramo en agentes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>

      <Seccion titulo="Activos en la base y no en ART" color="#fbbf24" n={activos.length}
        ayuda="Agentes ACTIVOS (sin reemplazantes, que no van a ART) que no están en el padrón de Catán. 'Dar de alta' los manda a la cola de alta automática.">
        {!activos.length ? <div style={S.vacio}>Nadie.</div> : (
          <TablaBase filas={activos} enCurso={enCurso} accion={accion} />
        )}
        {otros.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <button style={{ ...S.btn, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }} onClick={() => setVerOtros(v => !v)}>
              {verOtros ? '▾' : '▸'} Además {otros.length} en comisión / trámite / inactivo que no están en ART
            </button>
            {verOtros && <div style={{ marginTop: 8 }}><TablaBase filas={otros} enCurso={enCurso} accion={accion} /></div>}
          </div>
        )}
      </Seccion>
    </div>
  );
}

function TablaBase({ filas, enCurso, accion }: {
  filas: Fila[];
  enCurso: Record<string, boolean>;
  accion: (key: string, url: string, okMsg: string) => void;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
      <thead><tr>
        <th style={S.th}>Apellido y nombre</th><th style={S.th}>DNI</th><th style={S.th}>CUIL</th><th style={S.th}>Estado</th>
        <th style={S.th}>Ley</th><th style={S.th}>Ingreso</th><th style={S.th}>Alta en ART</th><th style={S.th}>Detalle</th><th style={S.th}></th>
      </tr></thead>
      <tbody>
        {filas.map(f => (
          <tr key={`n${f.dni}`}>
            <td style={{ ...S.td, fontWeight: 600 }}>{f.apellido}, {f.nombre}</td>
            <td style={S.td}>{f.dni}</td>
            <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>{fmtCuil(f.cuil)}</td>
            <td style={S.td}>{f.estado_empleo}</td>
            <td style={{ ...S.td, fontSize: '0.72rem' }}>{f.ley ?? '—'}</td>
            <td style={S.td}>{fmtFecha(f.fecha_ingreso)}</td>
            <td style={S.td}><BadgeCola status={f.alta_status} /></td>
            <td style={{ ...S.td, fontSize: '0.72rem', color: '#fca5a5', maxWidth: 300 }}>{f.alta_error ?? ''}</td>
            <td style={{ ...S.td, textAlign: 'right' as const }}>
              {f.alta_status !== 'PENDING' && f.alta_status !== 'PROCESSING' && (
                <button style={{ ...S.btn, background: '#7c3aed', color: '#fff' }} disabled={enCurso[`n${f.dni}`]}
                  title="Lo manda a la cola de alta automática en ART"
                  onClick={() => accion(`n${f.dni}`, `/becarios-art/errores/${f.dni}/reintentar`, 'Enviado a la cola de alta')}>
                  {enCurso[`n${f.dni}`] ? '…' : 'Dar de alta'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
