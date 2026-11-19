// src/pages/TramitesDocumentalesPage/AntecedentesPorTanda.tsx
// Panel "Por tanda": todos los antecedentes recibidos por mail (robot gmail_antecedentes)
// agrupados por la tanda del agente, ordenados por agente, con filtro por año del mail.
// "Extranjeros" = becarios del Programa Beca de Radicación (ley_id 12): con ese filtro se ve
// también el bloque "Faltan" (qué certificado le falta a cada becario). Exporta a Excel.
// Datos: GET /tramites-documentales/antecedentes-recibidos.
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { apiFetch } from '../../api/http';

type Item = {
  id: number; dni: string | null; nombre: string | null; novedad: string | null; estado: string;
  detalle: string | null; creado_at: string; tandas: string[]; extranjero: boolean; radicacion?: boolean;
};
type Becario = { dni: number; nombre: string; estado: string; tandas: string[]; recibidos: Record<string, string> };

const SIN_TANDA = 'Sin tanda';
const SIN_IDENT = 'Sin identificar';
// Certificados que se controlan para la renovación de los becarios de radicación.
const TIPOS_CONTROL = [
  { k: 'nacional', label: 'Nacional' },
  { k: 'provincial', label: 'Provincial' },
  { k: 'ético', label: 'Ético' },
  { k: 'matrícula', label: 'Matrícula' },
  { k: 'buena salud', label: 'Buena salud' },
];

const FORMATO_COLOR: Record<string, { bg: string; fg: string }> = {
  PDF: { bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5' },
  JPG: { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  PNG: { bg: 'rgba(34,197,94,0.15)', fg: '#86efac' },
  FOTO: { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
};

function partes(it: Item) {
  const [t, f] = String(it.novedad || '').split(' · ');
  const tipo = t.replace(/^Antecedentes\s*/i, '').trim();
  return { tipo: !tipo || tipo === '?' ? 'sin identificar' : tipo, formato: (f || '').trim() || '—' };
}

function anioDe(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}

function fechaLarga(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fechaCorta(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const porNombre = (a: Item, b: Item) =>
  (a.nombre || '~').localeCompare(b.nombre || '~', 'es', { sensitivity: 'base' }) || b.creado_at.localeCompare(a.creado_at);

const estadoTxt = (e: string) => (e === 'ok' ? 'en DOCU' : e === 'error' ? 'error' : 'revisar');

export function AntecedentesPorTanda({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [becarios, setBecarios] = useState<Becario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anio, setAnio] = useState<number | 'todos'>('todos');
  const [soloExt, setSoloExt] = useState(false);
  const [cerrados, setCerrados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{ ok: boolean; data: Item[]; becariosRadicacion?: Becario[] }>('/tramites-documentales/antecedentes-recibidos');
        setItems(r.data || []);
        setBecarios(r.becariosRadicacion || []);
      } catch (e: any) {
        setError(e?.message || 'No se pudo cargar');
      }
    })();
  }, []);

  const anios = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of items || []) { const a = anioDe(it.creado_at); if (a) m.set(a, (m.get(a) || 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const filtrados = useMemo(() => (items || []).filter(it =>
    (anio === 'todos' || anioDe(it.creado_at) === anio) && (!soloExt || it.radicacion)), [items, anio, soloExt]);

  const grupos = useMemo(() => {
    const g = new Map<string, Item[]>();
    const push = (k: string, it: Item) => { if (!g.has(k)) g.set(k, []); g.get(k)!.push(it); };
    for (const it of filtrados) {
      if (!it.dni) push(SIN_IDENT, it);
      else if (!it.tandas.length) push(SIN_TANDA, it);
      else for (const t of it.tandas) push(t, it);
    }
    for (const lista of g.values()) lista.sort(porNombre);
    const orden = (k: string) => (k === SIN_IDENT ? 2 : k === SIN_TANDA ? 1 : 0);
    return Array.from(g.entries()).sort((a, b) => orden(a[0]) - orden(b[0]) || a[0].localeCompare(b[0], 'es', { numeric: true }));
  }, [filtrados]);

  // Lo recibido de cada becario respetando el filtro de año (el back manda la fecha más reciente por tipo).
  const recibidosDe = (b: Becario) => {
    const out: Record<string, string> = {};
    for (const [k, f] of Object.entries(b.recibidos)) if (anio === 'todos' || anioDe(f) === anio) out[k] = f;
    return out;
  };
  const faltan = useMemo(() => becarios.map(b => {
    const rec = recibidosDe(b);
    return { ...b, rec, faltantes: TIPOS_CONTROL.filter(t => !rec[t.k]).map(t => t.label) };
  }).filter(b => b.faltantes.length > 0), [becarios, anio]); // eslint-disable-line react-hooks/exhaustive-deps
  const sinNada = faltan.filter(b => b.faltantes.length === TIPOS_CONTROL.length).length;

  const nExt = (items || []).filter(it => (anio === 'todos' || anioDe(it.creado_at) === anio) && it.radicacion).length;

  function exportar() {
    const recibidos: (string | number)[][] = [['Grupo', 'Agente', 'DNI', 'Beca radicación', 'Tipo', 'Formato', 'Recibido', 'Estado']];
    for (const [g, lista] of grupos) {
      for (const it of lista) {
        const { tipo, formato } = partes(it);
        recibidos.push([g, it.nombre || '', it.dni || '', it.radicacion ? 'Sí' : '', tipo, formato, fechaLarga(it.creado_at), estadoTxt(it.estado)]);
      }
    }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(recibidos);
    ws1['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 11 }, { wch: 9 }, { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Recibidos');

    const beca: (string | number)[][] = [['Agente', 'DNI', 'Estado', 'Tanda', ...TIPOS_CONTROL.map(t => t.label), 'Le falta']];
    for (const b of becarios) {
      const rec = recibidosDe(b);
      const falt = TIPOS_CONTROL.filter(t => !rec[t.k]).map(t => t.label);
      beca.push([b.nombre, b.dni, b.estado, b.tandas.join(', '), ...TIPOS_CONTROL.map(t => (rec[t.k] ? fechaCorta(rec[t.k]) : '')),
        falt.length === TIPOS_CONTROL.length ? 'TODO' : falt.join(', ')]);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(beca);
    ws2['!cols'] = [{ wch: 36 }, { wch: 11 }, { wch: 10 }, { wch: 22 }, ...TIPOS_CONTROL.map(() => ({ wch: 11 })), { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Becas radicación');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const sufijo = `${anio === 'todos' ? 'todos' : anio}${soloExt ? '_radicacion' : ''}`;
    saveAs(new Blob([out], { type: 'application/octet-stream' }), `antecedentes_por_tanda_${sufijo}.xlsx`);
  }

  const chip = (activo: boolean): React.CSSProperties => ({
    padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', cursor: 'pointer',
    border: '1px solid rgba(124,58,237,0.5)', background: activo ? 'rgba(124,58,237,0.45)' : 'transparent', color: '#e9d5ff',
  });
  const th: React.CSSProperties = { padding: '4px 6px' };
  const td: React.CSSProperties = { padding: '4px 6px' };
  const grupoBtn = (fondo: string, color: string): React.CSSProperties => ({
    width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
    border: '1px solid rgba(124,58,237,0.35)', background: fondo, color,
  });
  const FALTAN = '__faltan__';

  return (
    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50, width: 'min(920px, 94vw)', maxHeight: 560, overflow: 'auto',
      background: '#0f172a', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ fontSize: '0.8rem', color: '#e9d5ff' }}>Antecedentes recibidos por tanda</b>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
      </div>

      {error ? <div style={{ fontSize: '0.75rem', color: '#fca5a5' }}>❌ {error}</div>
        : items === null ? <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Cargando…</div>
        : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Año del mail:</span>
              <button type="button" style={chip(anio === 'todos')} onClick={() => setAnio('todos')}>Todos ({items.length})</button>
              {anios.map(([a, n]) => (
                <button key={a} type="button" style={chip(anio === a)} onClick={() => setAnio(a)}>{a} ({n})</button>
              ))}
              <span style={{ width: 12 }} />
              <button type="button" style={chip(soloExt)} onClick={() => setSoloExt(v => !v)}
                title="Becarios del Programa Beca de Radicación para Profesionales Extranjeros">🌎 Becas de radicación ({nExt})</button>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={exportar}
                style={{ padding: '3px 12px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                  border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.18)', color: '#86efac' }}>
                📥 Exportar a Excel
              </button>
            </div>

            {soloExt && (
              <div style={{ marginBottom: 10 }}>
                <button type="button" onClick={() => setCerrados(c => ({ ...c, [FALTAN]: !c[FALTAN] }))}
                  style={grupoBtn('rgba(239,68,68,0.15)', '#fca5a5')}>
                  {cerrados[FALTAN] ? '▸' : '▾'} Faltan · {faltan.length} de {becarios.length} becario(s) de radicación
                  {` · ${sinNada} sin ningún certificado`}
                </button>
                {!cerrados[FALTAN] && (
                  faltan.length === 0
                    ? <div style={{ fontSize: '0.75rem', color: '#4ade80', padding: 6 }}>✅ Todos los becarios tienen todos los certificados.</div>
                    : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', marginTop: 4 }}>
                        <thead>
                          <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                            <th style={th}>Agente</th><th style={th}>DNI</th>
                            {TIPOS_CONTROL.map(t => <th key={t.k} style={{ ...th, textAlign: 'center' }}>{t.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {faltan.map(b => (
                            <tr key={b.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0' }}>
                              <td style={td}>
                                {b.nombre}
                                {b.estado !== 'ACTIVO' && <span style={{ marginLeft: 6, fontSize: '0.66rem', color: '#facc15' }}>({b.estado.toLowerCase()})</span>}
                              </td>
                              <td style={td}>{b.dni}</td>
                              {TIPOS_CONTROL.map(t => (
                                <td key={t.k} style={{ ...td, textAlign: 'center', color: b.rec[t.k] ? '#4ade80' : '#f87171' }}
                                  title={b.rec[t.k] ? `Recibido ${fechaLarga(b.rec[t.k])}` : 'Falta'}>
                                  {b.rec[t.k] ? '✅' : '✗'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                )}
              </div>
            )}

            {grupos.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No hay antecedentes con ese filtro.</div>
            ) : grupos.map(([g, lista]) => {
              const agentes = new Set(lista.map(x => x.dni || `#${x.id}`)).size;
              const cerrado = !!cerrados[g];
              return (
                <div key={g} style={{ marginBottom: 10 }}>
                  <button type="button" onClick={() => setCerrados(c => ({ ...c, [g]: !c[g] }))}
                    style={grupoBtn(g === SIN_IDENT ? 'rgba(250,204,21,0.12)' : g === SIN_TANDA ? 'rgba(148,163,184,0.12)' : 'rgba(124,58,237,0.22)',
                      g === SIN_IDENT ? '#facc15' : '#e9d5ff')}>
                    {cerrado ? '▸' : '▾'} {g} · {lista.length} certificado(s){g !== SIN_IDENT ? ` · ${agentes} agente(s)` : ''}
                  </button>
                  {!cerrado && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', marginTop: 4 }}>
                      <thead>
                        <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                          <th style={th}>Recibido</th><th style={th}>Agente</th><th style={th}>DNI</th>
                          <th style={th}>Tipo</th><th style={th}>Formato</th><th style={th}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map(it => {
                          const { tipo, formato } = partes(it);
                          const c = FORMATO_COLOR[formato] || { bg: 'rgba(148,163,184,0.12)', fg: '#cbd5e1' };
                          return (
                            <tr key={`${g}-${it.id}`} title={it.detalle || ''} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0' }}>
                              <td style={{ ...td, whiteSpace: 'nowrap' }}>{fechaLarga(it.creado_at)}</td>
                              <td style={td}>
                                {it.nombre || '—'}
                                {it.radicacion && (
                                  <span style={{ marginLeft: 6, padding: '0 6px', borderRadius: 6, background: 'rgba(14,165,233,0.2)', color: '#7dd3fc', fontSize: '0.68rem', fontWeight: 700 }}>🌎 Beca radicación</span>
                                )}
                              </td>
                              <td style={td}>{it.dni || '—'}</td>
                              <td style={{ ...td, textTransform: 'capitalize' }}>{tipo}</td>
                              <td style={td}>
                                <span style={{ padding: '1px 8px', borderRadius: 6, background: c.bg, color: c.fg, fontWeight: 700 }}>{formato}</span>
                              </td>
                              <td style={{ ...td, color: it.estado === 'ok' ? '#4ade80' : it.estado === 'error' ? '#fca5a5' : '#facc15' }}>
                                {it.estado === 'ok' ? '✅ en DOCU' : it.estado === 'error' ? '❌ error' : '⚠️ revisar'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </>
        )}
    </div>
  );
}
