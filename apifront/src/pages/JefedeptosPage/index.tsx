// src/pages/JefedeptosPage/index.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface Jefatura {
  id: number;
  sector: string;
  jefe: string | null;
}

interface Jefedepto {
  id: number;
  jefatura_id: number | null;
  dni: string | null;
  jefedepto: string | null;
  depto: string | null;
  oficinacentral: string | null;
  tipo_funcion: 'INTERINO' | 'POR CONCURSO' | null;
  nro_acto_admin: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  alerta_45_avisada: boolean;
  alerta_45_fecha: string | null;
  alerta_45_usuario_nombre: string | null;
  alerta_45_usuario_email: string | null;
  created_at: string;
  // enriquecido
  apellido?: string;
  nombre?: string;
  sector?: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function addYears(date: string, years: number): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function diasHasta(fecha: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
  const f = new Date(y, m - 1, d);
  return Math.round((f.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const [y, mo, day] = d.slice(0, 10).split('-').map(Number);
    return `${String(day).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
  } catch { return String(d); }
}

function enAlerta(row: Jefedepto): boolean {
  if (!row.fecha_hasta || row.alerta_45_avisada) return false;
  const dias = diasHasta(row.fecha_hasta);
  return dias <= 45 && dias > -30;
}

function getRowStyle(row: Jefedepto): React.CSSProperties {
  if (enAlerta(row)) return { background: 'rgba(234,179,8,0.13)', borderLeft: '3px solid #eab308' };
  if (row.fecha_hasta && diasHasta(row.fecha_hasta) < -30) return { opacity: 0.5 };
  return {};
}

// ─── HOOK BÚSQUEDA AGENTE ────────────────────────────────────────────────────

function useAgenteSearch() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [fullName, setFullName] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any>(null);

  async function onSearch(override?: string) {
    const clean = (override ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido', 'Ingresá un DNI válido'); return; }
    setLoading(true); setRow(null); setMatches([]);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado', `Sin agente con DNI ${clean}`); return; }
      const r = { ...res.data }; if (!r.dni) r.dni = clean;
      setRow(r);
    } catch (e: any) { toast.error('Error', e?.message || 'Error'); }
    finally { setLoading(false); }
  }

  async function onSearchByName() {
    const q = fullName.trim();
    if (!q) { toast.error('Búsqueda inválida', 'Ingresá apellido y/o nombre'); return; }
    setLoading(true); setMatches([]); setRow(null);
    try {
      const results = await searchPersonal(q);
      setMatches(results);
      if (!results.length) toast.error('Sin resultados', `No se encontró "${q}"`);
    } catch (e: any) { toast.error('Error', e?.message || 'Error'); }
    finally { setLoading(false); }
  }

  const loadByDni = async (val: string) => {
    const clean = String(val).replace(/\D/g, '');
    setDni(clean); setMatches([]);
    await onSearch(clean);
  };

  const clear = () => { setRow(null); setMatches([]); setDni(''); setFullName(''); };

  return { dni, setDni, fullName, setFullName, matches, loading, row, onSearch, onSearchByName, loadByDni, clear };
}

// ─── BANNER DE ALERTA (se usa también en Dashboard) ──────────────────────────

export function JefedeptosAlertaBanner() {
  const { session } = useAuth();
  const [alertas, setAlertas] = useState<Jefedepto[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const logged = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>('/jefedeptos?limit=500');
        const rows: Jefedepto[] = res?.data || res || [];

        const enAl = rows.filter(r => enAlerta(r));
        if (!enAl.length) return;

        // enriquecer con datos de personal y jefaturas
        const [jefaturasRes, ...personalRes] = await Promise.all([
          apiFetch<any>('/jefaturas?limit=500').catch(() => null),
          ...enAl.map(r => r.dni ? apiFetch<any>(`/personal/${r.dni}`).catch(() => null) : Promise.resolve(null)),
        ]);

        const jefMap = new Map<number, string>();
        (jefaturasRes?.data || jefaturasRes || []).forEach((j: Jefatura) => jefMap.set(j.id, j.sector));

        const enriched = enAl.map((r, i) => {
          const p = personalRes[i];
          return {
            ...r,
            sector: r.jefatura_id ? jefMap.get(r.jefatura_id) : r.jefedepto ?? undefined,
            apellido: p?.ok && p?.data ? p.data.apellido : undefined,
            nombre: p?.ok && p?.data ? p.data.nombre : undefined,
          };
        });

        setAlertas(enriched);
        setVisible(true);

        if (!logged.current && session) {
          logged.current = true;
          const u = session.user as any;
          await apiFetch('/alerta_vistas', {
            method: 'POST',
            body: JSON.stringify({
              tipo: 'jefedeptos_45d',
              usuario_id: u?.id ?? null,
              usuario_email: u?.email ?? null,
              usuario_nombre: u?.nombre ?? null,
              detalle_json: JSON.stringify(enriched.map(e => ({ id: e.id, dni: e.dni, fecha_hasta: e.fecha_hasta }))),
            }),
          }).catch(() => {});
        }
      } catch { /* silencioso */ }
    })();
  }, [session]);

  if (!visible || dismissed || !alertas.length) return null;

  return (
    <div style={{
      margin: '0 0 16px 0',
      padding: '14px 16px',
      background: 'rgba(234,179,8,0.12)',
      border: '2px solid rgba(234,179,8,0.6)',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🏛️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 4 }}>
          Alerta: {alertas.length} jefatura{alertas.length > 1 ? 's' : ''} con vencimiento en ≤45 días
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {alertas.map(a => {
            const dias = diasHasta(a.fecha_hasta!);
            return (
              <div key={a.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>
                  {a.apellido ? `${a.apellido}, ${a.nombre}` : `DNI ${a.dni}`}
                </span>
                <span className="muted">·</span>
                <span>{a.sector ?? '—'}</span>
                <span className="muted">·</span>
                <span>Vence: {fmt(a.fecha_hasta)}</span>
                <span style={{
                  background: dias <= 0 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)',
                  color: dias <= 0 ? '#ef4444' : '#eab308',
                  borderRadius: 6,
                  padding: '1px 7px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}>
                  {dias <= 0 ? `venció hace ${Math.abs(dias)}d` : `en ${dias}d`}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
          Ir a <a href="/app/jefedeptos" style={{ color: '#eab308', textDecoration: 'underline' }}>Historial de Jefaturas</a> para marcar como avisadas.
        </div>
      </div>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)}
        title="Cerrar"
      >✕</button>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────────────────────

export function JefedeptosPage() {
  const { canCrud, session } = useAuth();
  const toast = useToast();
  const search = useAgenteSearch();

  const [rows, setRows] = useState<Jefedepto[]>([]);
  const [jefaturas, setJefaturas] = useState<Jefatura[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);

  // formulario
  const [jefaturaId, setJefaturaId] = useState('');
  const [tipoFuncion, setTipoFuncion] = useState<'INTERINO' | 'POR CONCURSO'>('INTERINO');
  const [nroActo, setNroActo] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const auditInfo = {
    id: (session?.user as any)?.id ?? null,
    email: session?.user?.email ?? null,
    nombre: (session?.user as any)?.nombre ?? null,
  };

  // ── Cargar datos ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rJef, rHist] = await Promise.all([
        apiFetch<any>('/jefaturas?limit=500'),
        apiFetch<any>('/jefedeptos?limit=1000&sort=-created_at'),
      ]);

      const jefs: Jefatura[] = rJef?.data || rJef || [];
      setJefaturas(jefs);
      const jefMap = new Map(jefs.map(j => [j.id, j.sector]));

      const hist: Jefedepto[] = rHist?.data || rHist || [];

      // enriquecer con nombres de personal
      const dnis = [...new Set(hist.filter(r => r.dni).map(r => String(r.dni)))];
      const nameMap = new Map<string, { apellido: string; nombre: string }>();
      await Promise.allSettled(
        dnis.map(async d => {
          try {
            const r = await apiFetch<any>(`/personal/${d}`);
            if (r?.ok && r?.data) nameMap.set(d, { apellido: r.data.apellido || '', nombre: r.data.nombre || '' });
          } catch { /* ok */ }
        })
      );

      setRows(hist.map(r => ({
        ...r,
        sector: r.jefatura_id ? jefMap.get(r.jefatura_id) : r.jefedepto ?? undefined,
        ...nameMap.get(String(r.dni ?? '')),
      })));
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-calcular fecha_hasta cuando cambia tipo o fecha_desde
  useEffect(() => {
    if (tipoFuncion === 'INTERINO') {
      setFechaHasta('');
    } else if (fechaDesde) {
      setFechaHasta(addYears(fechaDesde, 4));
    }
  }, [tipoFuncion, fechaDesde]);

  // ── Guardar ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.row) { toast.error('Sin agente', 'Buscá y seleccioná un agente.'); return; }
    if (!jefaturaId) { toast.error('Sin jefatura', 'Seleccioná una jefatura.'); return; }
    if (!fechaDesde) { toast.error('Sin fecha', 'Ingresá la fecha desde.'); return; }
    if (!nroActo.trim()) { toast.error('Sin acto', 'Ingresá el Nro. de Acto Administrativo.'); return; }

    setSaving(true);
    try {
      const body: any = {
        jefatura_id: Number(jefaturaId),
        dni: String(search.row.dni).replace(/\D/g, ''),
        tipo_funcion: tipoFuncion,
        nro_acto_admin: nroActo.trim(),
        fecha_desde: fechaDesde,
        fecha_hasta: tipoFuncion === 'POR CONCURSO' ? fechaHasta : null,
        created_by: auditInfo.id,
        updated_by: auditInfo.id,
      };
      await apiFetch('/jefedeptos', { method: 'POST', body: JSON.stringify(body) });
      toast.ok('Guardado', 'Registro de jefatura guardado.');
      search.clear();
      setJefaturaId(''); setNroActo(''); setFechaDesde(''); setFechaHasta('');
      await loadAll();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  // ── Marcar avisada ──
  const handleMarcarAvisada = async (row: Jefedepto) => {
    setMarkingId(row.id);
    try {
      await apiFetch(`/jefedeptos/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          alerta_45_avisada: 1,
          alerta_45_fecha: new Date().toISOString(),
          alerta_45_usuario_id: auditInfo.id,
          alerta_45_usuario_email: auditInfo.email,
          alerta_45_usuario_nombre: auditInfo.nombre,
          updated_by: auditInfo.id,
        }),
      });

      // registrar en alerta_vistas quién la marcó
      await apiFetch('/alerta_vistas', {
        method: 'POST',
        body: JSON.stringify({
          tipo: 'jefedeptos_45d_avisada',
          usuario_id: auditInfo.id,
          usuario_email: auditInfo.email,
          usuario_nombre: auditInfo.nombre,
          detalle_json: JSON.stringify({ id: row.id, dni: row.dni, fecha_hasta: row.fecha_hasta }),
        }),
      }).catch(() => {});

      toast.ok('Marcada', 'Alerta marcada como avisada.');
      await loadAll();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setMarkingId(null); }
  };

  // ── Stats ──
  const enAlertaRows = rows.filter(r => enAlerta(r));
  const vigentes = rows.filter(r => !r.fecha_hasta || diasHasta(r.fecha_hasta) > -30);
  const avisadas = rows.filter(r => r.alerta_45_avisada);

  const jefaturaSeleccionada = jefaturas.find(j => j.id === Number(jefaturaId));

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <Layout title="🏛️ Historial de Jefaturas" showBack>

      {/* Banner alerta inline */}
      {enAlertaRows.length > 0 && (
        <div style={{ margin: '0 0 16px 0', padding: '12px 16px', background: 'rgba(234,179,8,0.12)', border: '2px solid rgba(234,179,8,0.5)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 6 }}>
            ⚠️ {enAlertaRows.length} jefatura{enAlertaRows.length > 1 ? 's' : ''} con vencimiento en ≤45 días
          </div>
          {enAlertaRows.map(r => {
            const dias = diasHasta(r.fecha_hasta!);
            return (
              <div key={r.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{r.apellido ? `${r.apellido}, ${r.nombre}` : `DNI ${r.dni}`}</span>
                <span className="muted">·</span>
                <span>{r.sector ?? '—'}</span>
                <span style={{ background: 'rgba(234,179,8,0.25)', color: '#eab308', borderRadius: 6, padding: '1px 8px', fontSize: '0.77rem', fontWeight: 700 }}>
                  {dias <= 0 ? `venció hace ${Math.abs(dias)}d` : `en ${dias}d`}
                </span>
                <span className="muted">Nro. acto: {r.nro_acto_admin ?? '—'}</span>
                <button className="btn" type="button"
                  style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(234,179,8,0.2)', color: '#eab308' }}
                  onClick={() => handleMarcarAvisada(r)}
                  disabled={markingId === r.id}>
                  {markingId === r.id ? '...' : '✓ Marcar avisada'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Vigentes', val: vigentes.length, color: '#14b8a6' },
          { label: 'En alerta (≤45 días)', val: enAlertaRows.length, color: '#eab308' },
          { label: 'Avisadas', val: avisadas.length, color: '#10b981' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{val}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── BÚSQUEDA AGENTE ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 10 }}>Buscar agente</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>DNI</label>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" style={{ flex: 1 }} value={search.dni}
                onChange={e => search.setDni(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search.onSearch()}
                placeholder="Enter para buscar" disabled={search.loading} />
              <button className="btn" type="button" onClick={() => search.onSearch()} disabled={search.loading}>
                {search.loading ? '...' : 'Buscar'}
              </button>
            </div>
          </div>
          <div>
            <label style={lbl}>Apellido / Nombre</label>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" style={{ flex: 1 }} value={search.fullName}
                onChange={e => search.setFullName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search.onSearchByName()}
                placeholder="Apellido Nombre (Enter)" disabled={search.loading} />
              <button className="btn" type="button" onClick={search.onSearchByName} disabled={search.loading}>
                {search.loading ? '...' : 'Buscar'}
              </button>
            </div>
          </div>
        </div>

        {search.matches.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {search.matches.map((m: any) => (
              <button key={m.dni} className="btn" type="button"
                style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => search.loadByDni(String(m.dni))}>
                <strong>{m.apellido}, {m.nombre}</strong>
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>DNI {m.dni}</span>
              </button>
            ))}
          </div>
        )}

        {search.row && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{search.row.apellido}, {search.row.nombre}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>DNI {search.row.dni}</div>
            </div>
            <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={search.clear}>✕ Limpiar</button>
          </div>
        )}
      </div>

      {/* ── FORMULARIO ── */}
      {canCrud('jefedeptos', 'create') && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="h2" style={{ marginBottom: 10 }}>➕ Cargar jefatura</div>
          {!search.row && (
            <div style={alertStyle}>⚠️ Buscá y seleccioná un agente antes de cargar.</div>
          )}
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={fg}>
                <label style={lbl}>Jefatura *</label>
                <select className="input" value={jefaturaId} onChange={e => setJefaturaId(e.target.value)} required>
                  <option value="">— Seleccionar —</option>
                  {jefaturas.map(j => (
                    <option key={j.id} value={j.id}>{j.sector}</option>
                  ))}
                </select>
              </div>
              <div style={fg}>
                <label style={lbl}>Tipo de función *</label>
                <div className="row" style={{ gap: 16, marginTop: 4 }}>
                  {(['INTERINO', 'POR CONCURSO'] as const).map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input type="radio" checked={tipoFuncion === t} onChange={() => setTipoFuncion(t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div style={fg}>
                <label style={lbl}>Nro. Acto Administrativo *</label>
                <input className="input" type="text" placeholder="Ej: RESO-2025-1234-GDEBA-MSALGP"
                  value={nroActo} onChange={e => setNroActo(e.target.value)} />
              </div>
              <div style={fg}>
                <label style={lbl}>Fecha desde *</label>
                <input className="input" type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
              </div>
            </div>

            {/* Preview vencimiento */}
            <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: '0.83rem', marginBottom: 12, ...(tipoFuncion === 'INTERINO' ? { background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)', color: '#14b8a6' } : { background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)', color: '#eab308' }) }}>
              {tipoFuncion === 'INTERINO'
                ? '✓ INTERINO — Sin fecha de vencimiento'
                : fechaDesde
                  ? `⏳ POR CONCURSO — Vence el ${fmt(fechaHasta)} (4 años desde el ${fmt(fechaDesde)})`
                  : '⏳ POR CONCURSO — Ingresá la fecha desde para calcular el vencimiento'
              }
            </div>

            {jefaturaSeleccionada && (
              <div style={{ marginBottom: 12, padding: '6px 10px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, fontSize: '0.82rem', color: '#818cf8' }}>
                Jefatura seleccionada: <strong>{jefaturaSeleccionada.sector}</strong>
              </div>
            )}

            <button className="btn" type="submit" disabled={saving || !search.row}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </form>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      <div className="card">
        <div className="h2" style={{ marginBottom: 10 }}>
          Historial {loading && <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>Cargando...</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Agente</th>
                <th>DNI</th>
                <th>Jefatura</th>
                <th>Tipo</th>
                <th>Nro. Acto Admin.</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Alerta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const dias = r.fecha_hasta ? diasHasta(r.fecha_hasta) : null;
                return (
                  <tr key={r.id} style={getRowStyle(r)}>
                    <td>{r.apellido ? `${r.apellido}, ${r.nombre}` : '—'}</td>
                    <td>{r.dni ?? '—'}</td>
                    <td>{r.sector ?? r.jefedepto ?? '—'}</td>
                    <td>
                      <span style={{
                        background: r.tipo_funcion === 'INTERINO' ? 'rgba(20,184,166,0.15)' : 'rgba(99,102,241,0.15)',
                        color: r.tipo_funcion === 'INTERINO' ? '#14b8a6' : '#818cf8',
                        borderRadius: 6, padding: '1px 7px', fontSize: '0.78rem', fontWeight: 700,
                      }}>
                        {r.tipo_funcion ?? '—'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>{r.nro_acto_admin ?? '—'}</td>
                    <td>{fmt(r.fecha_desde)}</td>
                    <td>
                      {r.fecha_hasta ? (
                        <span style={{ color: dias !== null && dias <= 45 && dias > 0 ? '#eab308' : dias !== null && dias <= 0 ? '#ef4444' : undefined }}>
                          {fmt(r.fecha_hasta)}
                          {dias !== null && <span style={{ marginLeft: 4, fontSize: '0.75rem', opacity: 0.7 }}>
                            ({dias <= 0 ? `venció` : `en ${dias}d`})
                          </span>}
                        </span>
                      ) : <span className="muted" style={{ fontSize: '0.8rem' }}>Sin venc.</span>}
                    </td>
                    <td>
                      {r.alerta_45_avisada
                        ? <span style={{ color: '#10b981', fontSize: '0.78rem' }}>✓ Avisada<br /><span className="muted" style={{ fontSize: '0.72rem' }}>{r.alerta_45_usuario_nombre ?? ''}</span></span>
                        : enAlerta(r)
                          ? <span style={{ color: '#eab308', fontSize: '0.78rem', fontWeight: 700 }}>⚠️ Pendiente</span>
                          : <span className="muted" style={{ fontSize: '0.78rem' }}>—</span>
                      }
                    </td>
                    <td>
                      {!r.alerta_45_avisada && enAlerta(r) && (
                        <button className="btn" type="button"
                          style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(234,179,8,0.18)', color: '#eab308' }}
                          onClick={() => handleMarcarAvisada(r)}
                          disabled={markingId === r.id}>
                          {markingId === r.id ? '...' : '✓ Marcar avisada'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !loading && (
                <tr><td colSpan={9} className="muted" style={{ padding: 12 }}>Sin registros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </Layout>
  );
}

// ─── estilos ─────────────────────────────────────────────────────────────────

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' };
const alertStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10,
  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
  color: '#fecaca', marginBottom: 12, fontSize: '0.85rem',
};
