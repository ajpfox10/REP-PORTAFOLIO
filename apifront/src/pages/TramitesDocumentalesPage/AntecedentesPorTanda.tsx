// src/pages/TramitesDocumentalesPage/AntecedentesPorTanda.tsx
// Panel "Por tanda": todos los antecedentes recibidos por mail (robot gmail_antecedentes)
// agrupados por la tanda del agente, con extranjeros marcados y filtro por año del mail.
// Datos: GET /tramites-documentales/antecedentes-recibidos (tandas + extranjero por DNI).
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';

type Item = {
  id: number; dni: string | null; nombre: string | null; novedad: string | null; estado: string;
  detalle: string | null; creado_at: string; tandas: string[]; extranjero: boolean;
};

const SIN_TANDA = 'Sin tanda';
const SIN_IDENT = 'Sin identificar';

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

export function AntecedentesPorTanda({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anio, setAnio] = useState<number | 'todos'>('todos');
  const [soloExt, setSoloExt] = useState(false);
  const [cerrados, setCerrados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{ ok: boolean; data: Item[] }>('/tramites-documentales/antecedentes-recibidos');
        setItems(r.data || []);
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
    (anio === 'todos' || anioDe(it.creado_at) === anio) && (!soloExt || it.extranjero)), [items, anio, soloExt]);

  const grupos = useMemo(() => {
    const g = new Map<string, Item[]>();
    const push = (k: string, it: Item) => { if (!g.has(k)) g.set(k, []); g.get(k)!.push(it); };
    for (const it of filtrados) {
      if (!it.dni) push(SIN_IDENT, it);
      else if (!it.tandas.length) push(SIN_TANDA, it);
      else for (const t of it.tandas) push(t, it);
    }
    const orden = (k: string) => (k === SIN_IDENT ? 2 : k === SIN_TANDA ? 1 : 0);
    return Array.from(g.entries()).sort((a, b) => orden(a[0]) - orden(b[0]) || a[0].localeCompare(b[0], 'es', { numeric: true }));
  }, [filtrados]);

  const nExt = (items || []).filter(it => (anio === 'todos' || anioDe(it.creado_at) === anio) && it.extranjero).length;

  const chip = (activo: boolean): React.CSSProperties => ({
    padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', cursor: 'pointer',
    border: '1px solid rgba(124,58,237,0.5)', background: activo ? 'rgba(124,58,237,0.45)' : 'transparent', color: '#e9d5ff',
  });
  const th: React.CSSProperties = { padding: '4px 6px' };

  return (
    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50, width: 'min(860px, 94vw)', maxHeight: 520, overflow: 'auto',
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
              <button type="button" style={chip(soloExt)} onClick={() => setSoloExt(v => !v)}>🌎 Solo extranjeros ({nExt})</button>
            </div>

            {grupos.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No hay antecedentes con ese filtro.</div>
            ) : grupos.map(([g, lista]) => {
              const agentes = new Set(lista.map(x => x.dni || `#${x.id}`)).size;
              const cerrado = !!cerrados[g];
              return (
                <div key={g} style={{ marginBottom: 10 }}>
                  <button type="button" onClick={() => setCerrados(c => ({ ...c, [g]: !c[g] }))}
                    style={{ width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                      border: '1px solid rgba(124,58,237,0.35)',
                      background: g === SIN_IDENT ? 'rgba(250,204,21,0.12)' : g === SIN_TANDA ? 'rgba(148,163,184,0.12)' : 'rgba(124,58,237,0.22)',
                      color: g === SIN_IDENT ? '#facc15' : '#e9d5ff' }}>
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
                              <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{fechaLarga(it.creado_at)}</td>
                              <td style={{ padding: '4px 6px' }}>
                                {it.nombre || '—'}
                                {it.extranjero && (
                                  <span style={{ marginLeft: 6, padding: '0 6px', borderRadius: 6, background: 'rgba(14,165,233,0.2)', color: '#7dd3fc', fontSize: '0.68rem', fontWeight: 700 }}>🌎 Extranjero</span>
                                )}
                              </td>
                              <td style={{ padding: '4px 6px' }}>{it.dni || '—'}</td>
                              <td style={{ padding: '4px 6px', textTransform: 'capitalize' }}>{tipo}</td>
                              <td style={{ padding: '4px 6px' }}>
                                <span style={{ padding: '1px 8px', borderRadius: 6, background: c.bg, color: c.fg, fontWeight: 700 }}>{formato}</span>
                              </td>
                              <td style={{ padding: '4px 6px', color: it.estado === 'ok' ? '#4ade80' : it.estado === 'error' ? '#fca5a5' : '#facc15' }}>
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
