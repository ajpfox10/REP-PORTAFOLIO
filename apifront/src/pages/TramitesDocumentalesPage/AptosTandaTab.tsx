// src/pages/TramitesDocumentalesPage/AptosTandaTab.tsx
// Cruza los agentes de una TANDA con el Excel de APTOS (D:\G\APTOS\APTOS.xlsx) por DNI
// y calcula el vencimiento del apto = fecha de aprobación + N meses (editable).
//   🔴 VENCIDO    → vence < hoy
//   🟡 POR VENCER → vence dentro de M meses (editable) y todavía no vencido
//   🟢 VIGENTE    → resto
//   ⚪ SIN APTO   → el DNI no aparece en el Excel
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';

type AptoRow = {
  dni: number; apellido: string; nombre: string; fecha: string;
  resolucion: string; tipo: string; estado_examen: string;
};
type TandaRow = {
  tanda: string; dni: number; apellidoNombre: string;
  ocupacionLey: string | null; leyNombre: string | null; plantaNombre: string | null;
  estadoEmpleo: string | null; ocupacionNombre: string | null;
};

type Estado = 'VIGENTE' | 'POR VENCER' | 'VENCIDO' | 'SIN APTO';

const EST_COLOR: Record<Estado, { bg: string; fg: string }> = {
  'VIGENTE':    { bg: 'rgba(34,197,94,0.12)',  fg: '#4ade80' },
  'POR VENCER': { bg: 'rgba(234,179,8,0.18)',  fg: '#facc15' },
  'VENCIDO':    { bg: 'rgba(239,68,68,0.18)',  fg: '#fca5a5' },
  'SIN APTO':   { bg: 'rgba(148,163,184,0.10)', fg: '#94a3b8' },
};

const LS_VIG = 'aptosTanda.mesesVigencia';
const LS_AVI = 'aptosTanda.mesesAviso';
const LS_RES = 'aptosTanda.contarResuelto';

function parseFecha(s: string): Date | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}
function hoy0(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmt(d: Date | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function dias(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// RESOLUCION que cuenta como apto aprobado: "APTO" o "APTO CON PREEXISTENCIA".
// Opcionalmente (según elija el usuario) también "RESUELTO" (juntas médicas / periódicos).
// OJO: NO usar /apto/i porque matchea "NO APTO".
function esApto(resolucion: string, contarResuelto: boolean): boolean {
  const r = String(resolucion || '').trim().toUpperCase();
  if (r.startsWith('APTO')) return true;
  if (contarResuelto && r === 'RESUELTO') return true;
  return false;
}

// Devuelve el apto vigente del agente (fila que cuenta como apto más reciente, para el
// vencimiento) y la última fila con fecha (cualquier resolución, para mostrar contexto
// cuando no hay apto: "última: NO APTO / PENDIENTE / ...").
function aptoDeAgente(dni: number, byDni: Map<number, AptoRow[]>, contarResuelto: boolean) {
  const list = byDni.get(dni) || [];
  const conFecha = list
    .map((a) => ({ a, d: parseFecha(a.fecha) }))
    .filter((x): x is { a: AptoRow; d: Date } => x.d != null)
    .sort((x, y) => y.d.getTime() - x.d.getTime());
  const apto = conFecha.find((x) => esApto(x.a.resolucion, contarResuelto)) || null;
  const ultimo = conFecha[0] || null;
  return { apto, ultimo };
}

export function AptosTandaTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [conteos, setConteos] = useState<Map<string, number>>(new Map());
  const [tandaRows, setTandaRows] = useState<TandaRow[]>([]);
  const [aptos, setAptos] = useState<AptoRow[]>([]);
  const [existe, setExiste] = useState(true);
  const [selectedTanda, setSelectedTanda] = useState('');
  const [loading, setLoading] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<Estado | 'todos'>('todos');

  const [mesesVig, setMesesVig] = useState<number>(() => Number(localStorage.getItem(LS_VIG)) || 18);
  const [mesesAviso, setMesesAviso] = useState<number>(() => Number(localStorage.getItem(LS_AVI)) || 6);
  const [contarResuelto, setContarResuelto] = useState<boolean>(() => localStorage.getItem(LS_RES) === '1');
  useEffect(() => { localStorage.setItem(LS_VIG, String(mesesVig)); }, [mesesVig]);
  useEffect(() => { localStorage.setItem(LS_AVI, String(mesesAviso)); }, [mesesAviso]);
  useEffect(() => { localStorage.setItem(LS_RES, contarResuelto ? '1' : '0'); }, [contarResuelto]);

  // Carga inicial: nombres de tandas (con conteo) + Excel de aptos.
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [t, a] = await Promise.all([
          apiFetch<{ ok: boolean; data: { rows: TandaRow[]; tandas: string[] } }>('/tramites-documentales/tandas'),
          apiFetch<{ ok: boolean; data: { rows: AptoRow[]; existe: boolean } }>('/tramites-documentales/aptos'),
        ]);
        const m = new Map<string, number>();
        for (const r of t.data.rows) m.set(r.tanda, (m.get(r.tanda) || 0) + 1);
        setConteos(m);
        setTandas(t.data.tandas || []);
        setAptos(a.data.rows || []);
        setExiste(a.data.existe);
      } catch (e: any) {
        toast.error('No se pudieron cargar los datos', e?.message || 'Error');
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function elegirTanda(t: string) {
    setSelectedTanda(t); setFiltroEstado('todos'); setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: TandaRow[] } }>(`/tramites-documentales/tandas?tanda=${encodeURIComponent(t)}`);
      setTandaRows(res.data.rows || []);
    } catch (e: any) {
      toast.error('No se pudo cargar la tanda', e?.message || 'Error');
    } finally { setLoading(false); }
  }

  const aptosByDni = useMemo(() => {
    const m = new Map<number, AptoRow[]>();
    for (const a of aptos) { if (!a.dni) continue; const arr = m.get(a.dni) || []; arr.push(a); m.set(a.dni, arr); }
    return m;
  }, [aptos]);

  const filas = useMemo(() => {
    const hoy = hoy0();
    const limiteAviso = addMonths(hoy, mesesAviso);
    return tandaRows.map((ag) => {
      const { apto, ultimo } = aptoDeAgente(ag.dni, aptosByDni, contarResuelto);
      const fechaAprob = apto ? apto.d : null;
      const vence = fechaAprob ? addMonths(fechaAprob, mesesVig) : null;
      let estado: Estado;
      if (!vence) estado = 'SIN APTO';
      else if (vence < hoy) estado = 'VENCIDO';
      else if (vence <= limiteAviso) estado = 'POR VENCER';
      else estado = 'VIGENTE';
      // Con apto → su resolución/tipo; sin apto → la última resolución como contexto.
      const resolucion = apto ? apto.a.resolucion : (ultimo ? `última: ${ultimo.a.resolucion}` : '');
      const tipo = apto ? apto.a.tipo : (ultimo?.a.tipo || '');
      return { ag, resolucion, tipo, fechaAprob, vence, estado, diasRestantes: vence ? dias(vence, hoy) : null };
    });
  }, [tandaRows, aptosByDni, mesesVig, mesesAviso, contarResuelto]);

  const resumen = useMemo(() => {
    const c: Record<Estado, number> = { 'VIGENTE': 0, 'POR VENCER': 0, 'VENCIDO': 0, 'SIN APTO': 0 };
    for (const f of filas) c[f.estado] += 1;
    return c;
  }, [filas]);

  const filtradas = useMemo(
    () => (filtroEstado === 'todos' ? filas : filas.filter((f) => f.estado === filtroEstado)),
    [filas, filtroEstado]
  );

  function exportar() {
    exportToExcel(`aptos_tanda_${selectedTanda || 'sel'}`, filtradas.map((f) => ({
      DNI: f.ag.dni, Agente: f.ag.apellidoNombre,
      Ley: f.ag.leyNombre || f.ag.ocupacionLey || '', Planta: f.ag.plantaNombre || '',
      'Fecha aprobación': fmt(f.fechaAprob), 'Vence': fmt(f.vence),
      'Días restantes': f.diasRestantes ?? '', Estado: f.estado,
      Resolución: f.resolucion, 'Tipo examen': f.tipo,
    })));
  }

  const chip: React.CSSProperties = { padding: '5px 14px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };

  if (!existe) {
    return (
      <div style={{ color: '#f87171', fontSize: '0.85rem', padding: 20 }}>
        No se encontró <b>D:\G\APTOS\APTOS.xlsx</b>. Dejá el Excel ahí y recargá la página.
      </div>
    );
  }

  return (
    <div>
      {/* Selección de tanda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>Tanda</span>
        {tandas.map((t) => (
          <button key={t} type="button" onClick={() => void elegirTanda(t)}
            style={{ ...chip, background: selectedTanda === t ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: selectedTanda === t ? '#fff' : '#cbd5e1' }}>
            {t} <span style={{ opacity: 0.7 }}>({conteos.get(t) || 0})</span>
          </button>
        ))}
        {!tandas.length && <span style={{ color: '#64748b', fontSize: '0.82rem' }}>No hay tandas.</span>}
      </div>

      {/* Parámetros de meses */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: '0.8rem' }}>
          Vigencia del apto (meses)
          <input type="number" min={1} max={120} value={mesesVig}
            onChange={(e) => setMesesVig(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 64, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: '0.8rem' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: '0.8rem' }}>
          Avisar antes de vencer (meses)
          <input type="number" min={0} max={120} value={mesesAviso}
            onChange={(e) => setMesesAviso(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 64, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: '0.8rem' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: '0.8rem', cursor: 'pointer' }}
          title='Además de "APTO", contar "RESUELTO" (juntas médicas / exámenes periódicos) como apto válido.'>
          <input type="checkbox" checked={contarResuelto} onChange={(e) => setContarResuelto(e.target.checked)} />
          Contar “RESUELTO” como apto
        </label>
        <span style={{ color: '#64748b', fontSize: '0.72rem' }}>🟡 vence dentro de {mesesAviso} meses · 🔴 vencido</span>
      </div>

      {loading && <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: 20 }}>Cargando…</div>}
      {!loading && !selectedTanda && <div style={{ color: '#64748b', fontSize: '0.85rem', padding: 20 }}>Elegí una tanda para cruzar con los aptos.</div>}

      {!loading && selectedTanda && (
        <>
          {/* Resumen (chips filtro) */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            {(['todos', 'VENCIDO', 'POR VENCER', 'VIGENTE', 'SIN APTO'] as const).map((k) => {
              const activo = filtroEstado === k;
              const color = k === 'todos' ? '#e2e8f0' : EST_COLOR[k].fg;
              const n = k === 'todos' ? filas.length : resumen[k];
              return (
                <button key={k} type="button" onClick={() => setFiltroEstado(activo ? 'todos' : (k as any))}
                  style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.76rem',
                    border: `1px solid ${activo ? color : 'rgba(255,255,255,0.12)'}`,
                    background: activo ? (k === 'todos' ? 'rgba(255,255,255,0.06)' : EST_COLOR[k as Estado].bg) : 'transparent', color }}>
                  <strong>{n}</strong> {k === 'todos' ? 'total' : k.toLowerCase()}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button type="button" onClick={exportar} disabled={!filtradas.length}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: '0.78rem', cursor: 'pointer' }}>
              ⬇ Exportar ({filtradas.length})
            </button>
          </div>

          {/* Tabla */}
          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Agente', 'DNI', 'Ley / Planta', 'Fecha aprobación', 'Vence', 'Restante', 'Estado', 'Resolución'].map((c) => (
                    <th key={c} style={{ padding: '7px 10px', textAlign: 'left', whiteSpace: 'nowrap', color: '#94a3b8', fontWeight: 600 }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.map((f) => {
                  const col = EST_COLOR[f.estado];
                  return (
                    <tr key={f.ag.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: col.bg }}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#e2e8f0' }}>{f.ag.apellidoNombre}</td>
                      <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{f.ag.dni}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#cbd5e1' }}>
                        {(f.ag.leyNombre || f.ag.ocupacionLey || '—')}{f.ag.plantaNombre ? ` · ${f.ag.plantaNombre}` : ''}
                      </td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmt(f.fechaAprob)}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', fontWeight: 600, color: col.fg }}>{fmt(f.vence)}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: col.fg }}>
                        {f.diasRestantes == null ? '—'
                          : f.diasRestantes < 0 ? `vencido hace ${-f.diasRestantes} d`
                          : `${f.diasRestantes} d`}
                      </td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', fontWeight: 700, color: col.fg }}>{f.estado}</td>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#94a3b8' }}>{f.resolucion || '—'}</td>
                    </tr>
                  );
                })}
                {!filtradas.length && (
                  <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>Sin agentes con ese estado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
