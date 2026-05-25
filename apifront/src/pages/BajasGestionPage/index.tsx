import React, { useCallback, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─── types ───────────────────────────────────────────────────────────────────
interface BajaRow {
  dni: number;
  apellido: string;
  nombre: string;
  fecha_nacimiento: string | null;
  cuil: string | null;
  sexo_id: number | null;
  sexo_nombre: string | null;
  fecha_ingreso: string | null;
  fecha_egreso: string | null;
  legajo: number | null;
  ley_id: number | null;
  ley_nombre: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
  sector_id: number | null;
  sector_nombre: string | null;
  planta_id: number | null;
  planta_nombre: string | null;
  categoria_id: number | null;
  categoria_nombre: string | null;
  funcion_id: number | null;
  funcion_nombre: string | null;
  edad: number | null;
  estado_empleo: string | null;
}

interface Stats {
  total: number;
  sin_sexo: number;
  sin_ley: number;
  sin_servicio: number;
  sin_fecha_egreso: number;
  sin_fecha_nacimiento: number;
  sin_cuil: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmt = (d: string | null) => d ? d.slice(0, 10) : '—';

function missingFields(r: BajaRow): string[] {
  const m: string[] = [];
  if (!r.sexo_id)           m.push('Sexo');
  if (!r.ley_id)            m.push('Ley');
  if (!r.servicio_id)       m.push('Servicio');
  if (!r.fecha_egreso)      m.push('F.Egreso');
  if (!r.fecha_nacimiento)  m.push('F.Nacimiento');
  if (!r.cuil)              m.push('CUIL');
  return m;
}

function ageGroup(edad: number | null): string {
  if (edad == null)  return 'Sin dato';
  if (edad < 30)     return '< 30';
  if (edad < 40)     return '30–39';
  if (edad < 50)     return '40–49';
  if (edad < 60)     return '50–59';
  return '60+';
}

// ─── Edit modal ──────────────────────────────────────────────────────────────
interface EditModalProps {
  row: BajaRow;
  leyes: { id: number; nombre: string }[];
  sexos: { id: number; nombre: string }[];
  servicios: { id: number; nombre: string }[];
  onClose: () => void;
  onSaved: (updated: Partial<BajaRow>) => void;
}

function EditModal({ row, leyes, sexos, servicios, onClose, onSaved }: EditModalProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sexo_id:          row.sexo_id ?? '',
    ley_id:           row.ley_id ?? '',
    servicio_id:      row.servicio_id ?? '',
    fecha_egreso:     row.fecha_egreso?.slice(0, 10) ?? '',
    fecha_nacimiento: row.fecha_nacimiento?.slice(0, 10) ?? '',
    cuil:             row.cuil ?? '',
    estado_empleo:    row.estado_empleo ?? '',
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      if (form.sexo_id !== '')          body.sexo_id          = Number(form.sexo_id)  || null;
      if (form.ley_id !== '')           body.ley_id           = Number(form.ley_id)   || null;
      if (form.servicio_id !== '')      body.servicio_id      = Number(form.servicio_id) || null;
      if (form.fecha_egreso)            body.fecha_egreso     = form.fecha_egreso;
      if (form.fecha_nacimiento)        body.fecha_nacimiento = form.fecha_nacimiento;
      if (form.cuil !== '')             body.cuil             = form.cuil || null;
      if (form.estado_empleo)           body.estado_empleo    = form.estado_empleo;

      await apiFetch(`/personal/${row.dni}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.ok('Guardado', `${row.apellido}, ${row.nombre}`);
      onSaved(body);
      onClose();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message);
    } finally {
      setSaving(false);
    }
  };

  const fld: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '0.88rem' };
  const lbl: React.CSSProperties = { fontSize: '0.72rem', color: '#94a3b8', marginBottom: 3 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: '100%', padding: '1.25rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <strong style={{ fontSize: '0.95rem' }}>✏️ Editar Baja — {row.apellido}, {row.nombre}</strong>
          <button className="btn" onClick={onClose} style={{ padding: '3px 10px', fontSize: '0.78rem' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="bg-sexo" style={lbl}>Sexo</label>
            <select id="bg-sexo" name="sexo_id" className="input" style={fld} value={form.sexo_id} onChange={e => set('sexo_id', e.target.value)}>
              <option value="">— sin dato —</option>
              {sexos.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="bg-ley" style={lbl}>Ley</label>
            <select id="bg-ley" name="ley_id" className="input" style={fld} value={form.ley_id} onChange={e => set('ley_id', e.target.value)}>
              <option value="">— sin dato —</option>
              {leyes.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="bg-servicio" style={lbl}>Servicio</label>
            <select id="bg-servicio" name="servicio_id" className="input" style={fld} value={form.servicio_id} onChange={e => set('servicio_id', e.target.value)}>
              <option value="">— sin dato —</option>
              {servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="bg-fecha-egreso" style={lbl}>Fecha de Egreso</label>
            <input id="bg-fecha-egreso" name="fecha_egreso" type="date" className="input" style={fld} value={form.fecha_egreso} onChange={e => set('fecha_egreso', e.target.value)} />
          </div>

          <div>
            <label htmlFor="bg-fecha-nac" style={lbl}>Fecha de Nacimiento</label>
            <input id="bg-fecha-nac" name="fecha_nacimiento" type="date" className="input" style={fld} value={form.fecha_nacimiento} onChange={e => set('fecha_nacimiento', e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="bg-cuil" style={lbl}>CUIL</label>
            <input id="bg-cuil" name="cuil" type="text" className="input" style={fld} value={form.cuil} placeholder="20-12345678-9" onChange={e => set('cuil', e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="bg-estado" style={lbl}>Estado de Empleo</label>
            <select id="bg-estado" name="estado_empleo" className="input" style={fld} value={form.estado_empleo} onChange={e => set('estado_empleo', e.target.value)}>
              <option value="">— sin cambiar —</option>
              <option value="BAJA">BAJA</option>
              <option value="TRAMITE">TRAMITE</option>
              <option value="INACTIVO">INACTIVO</option>
              <option value="COMISION">COMISION</option>
              <option value="ACTIVO">ACTIVO</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={onClose} type="button">Cancelar</button>
          <button className="btn success" onClick={save} disabled={saving} type="button">
            {saving ? 'Guardando…' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', minWidth: 130 }}>
      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: color ?? '#e2e8f0', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── Distribution bar ────────────────────────────────────────────────────────
function DistBar({ items, total }: { items: { label: string; count: number }[]; total: number }) {
  const sorted = [...items].sort((a, b) => b.count - a.count).slice(0, 12);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {sorted.map(it => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 160, fontSize: '0.75rem', color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{it.label}</div>
          <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round((it.count / total) * 100)}%`, background: '#6366f1', borderRadius: 5, transition: 'width 0.4s' }} />
          </div>
          <div style={{ width: 40, fontSize: '0.75rem', color: '#94a3b8', textAlign: 'right' }}>{it.count}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function BajasGestionPage() {
  const toast = useToast();

  const [loaded, setLoaded]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [rows, setRows]         = useState<BajaRow[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [leyes, setLeyes]         = useState<{ id: number; nombre: string }[]>([]);
  const [leyesCat, setLeyesCat]   = useState<{ id: number; nombre: string }[]>([]);
  const [sexos, setSexos]         = useState<{ id: number; nombre: string }[]>([]);
  const [servicios, setServicios] = useState<{ id: number; nombre: string }[]>([]);
  const [serviciosCat, setServiciosCat] = useState<{ id: number; nombre: string }[]>([]);
  const [editing, setEditing]   = useState<BajaRow | null>(null);
  const [q, setQ]               = useState('');
  const [filterSexo, setFilterSexo]     = useState('');
  const [filterLey, setFilterLey]       = useState('');
  const [filterServicio, setFilterServicio] = useState('');
  const [filterMissing, setFilterMissing]   = useState('');
  const [tab, setTab] = useState<'tabla' | 'estadisticas'>('estadisticas');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [bajasRes, sexosRes, leyRes, srvRes] = await Promise.all([
        apiFetch<any>('/personal/bajas'),
        apiFetch<any>('/sexos?limit=20'),
        apiFetch<any>('/ley?limit=200'),
        apiFetch<any>('/servicios?limit=300'),
      ]);
      setLeyesCat((leyRes?.data ?? []).sort((a: any, b: any) => a.nombre.localeCompare(b.nombre)));
      setServiciosCat((srvRes?.data ?? []).sort((a: any, b: any) => a.nombre.localeCompare(b.nombre)));
      const data: BajaRow[] = bajasRes?.data ?? [];
      setRows(data);
      setStats(bajasRes?.stats ?? null);
      setSexos(sexosRes?.data ?? []);
      // Opciones de ley y servicio desde los datos reales (evita duplicados del catálogo)
      const leyesSet = new Map<string, string>();
      const srvSet   = new Map<string, string>();
      data.forEach(r => {
        if (r.ley_nombre)      leyesSet.set(r.ley_nombre, r.ley_nombre);
        if (r.servicio_nombre) srvSet.set(r.servicio_nombre, r.servicio_nombre);
      });
      setLeyes([...leyesSet.values()].sort().map(n => ({ id: 0, nombre: n })));
      setServicios([...srvSet.values()].sort().map(n => ({ id: 0, nombre: n })));
      setLoaded(true);
    } catch (e: any) {
      toast.error('Error al cargar', e?.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // ─── Filtered rows ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const qLow = q.toLowerCase();
    return rows.filter(r => {
      if (q && !`${r.apellido} ${r.nombre} ${r.dni}`.toLowerCase().includes(qLow)) return false;
      if (filterSexo && (r.sexo_nombre ?? '') !== filterSexo) return false;
      if (filterLey && (r.ley_nombre ?? '') !== filterLey) return false;
      if (filterServicio && (r.servicio_nombre ?? '') !== filterServicio) return false;
      if (filterMissing) {
        const missing = missingFields(r);
        if (!missing.includes(filterMissing)) return false;
      }
      return true;
    });
  }, [rows, q, filterSexo, filterLey, filterServicio, filterMissing]);

  // ─── Stats ───────────────────────────────────────────────────────────────
  const byLey = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { const k = r.ley_nombre ?? '(sin ley)'; m[k] = (m[k] ?? 0) + 1; });
    return Object.entries(m).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const bySexo = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { const k = r.sexo_nombre ?? '(sin dato)'; m[k] = (m[k] ?? 0) + 1; });
    return Object.entries(m).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const byServicio = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { const k = r.servicio_nombre ?? '(sin servicio)'; m[k] = (m[k] ?? 0) + 1; });
    return Object.entries(m).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const byEdad = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { const k = ageGroup(r.edad); m[k] = (m[k] ?? 0) + 1; });
    return Object.entries(m).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const byAnioEgreso = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => {
      const k = r.fecha_egreso ? r.fecha_egreso.slice(0, 4) : '(sin fecha)';
      m[k] = (m[k] ?? 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0])).map(([label, count]) => ({ label, count }));
  }, [rows]);

  // ─── Update row in state after save ──────────────────────────────────────
  const handleSaved = useCallback((dni: number, updated: Partial<BajaRow>) => {
    setRows(prev => prev.map(r => {
      if (r.dni !== dni) return r;
      const next = { ...r, ...updated };
      if (updated.sexo_id !== undefined) {
        next.sexo_nombre = sexos.find(s => s.id === Number(updated.sexo_id))?.nombre ?? null;
      }
      if (updated.ley_id !== undefined) {
        next.ley_nombre = leyes.find(l => l.id === Number(updated.ley_id))?.nombre ?? null;
      }
      if (updated.servicio_id !== undefined) {
        next.servicio_nombre = servicios.find(s => s.id === Number(updated.servicio_id))?.nombre ?? null;
      }
      return next;
    }));
  }, [sexos, leyes, servicios]);

  const sel: React.CSSProperties = { fontSize: '0.82rem', padding: '6px 10px', borderRadius: 8, background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' };

  return (
    <Layout title="Personal de Baja" showBack>

      {/* ─── header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#e2e8f0' }}>📉 Gestión de Personal de Baja / Trámite</h2>
        {!loaded && (
          <button className="btn success" onClick={cargar} disabled={loading} type="button" style={{ fontSize: '0.85rem' }}>
            {loading ? '⏳ Cargando…' : '📂 Cargar Personal de Baja'}
          </button>
        )}
        {loaded && (
          <button className="btn" onClick={cargar} disabled={loading} type="button" style={{ fontSize: '0.82rem' }}>
            {loading ? '⏳' : '🔄 Actualizar'}
          </button>
        )}
        {loaded && stats && (
          <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{stats.total.toLocaleString()} agentes de baja</span>
        )}
      </div>

      {!loaded && !loading && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
          Presioná <strong>Cargar Personal de Baja</strong> para ver los registros y estadísticas.
        </div>
      )}

      {loaded && stats && (
        <>
          {/* ─── tabs ────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            <button
              className={`btn${tab === 'estadisticas' ? ' active' : ''}`}
              onClick={() => setTab('estadisticas')}
              type="button"
              style={{ fontSize: '0.82rem' }}
            >📊 Estadísticas</button>
            <button
              className={`btn${tab === 'tabla' ? ' active' : ''}`}
              onClick={() => setTab('tabla')}
              type="button"
              style={{ fontSize: '0.82rem' }}
            >📋 Tabla ({rows.length.toLocaleString()})</button>
          </div>

          {/* ─── ESTADÍSTICAS ────────────────────────────────────────── */}
          {tab === 'estadisticas' && (
            <>
              {/* completitud */}
              <div style={{ marginBottom: 8, fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Completitud de datos</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                <StatCard label="Total bajas"       value={stats.total.toLocaleString()} color="#e2e8f0" />
                <StatCard label="Sin fecha egreso"  value={Number(stats.sin_fecha_egreso).toLocaleString()}  sub={`${Math.round((Number(stats.sin_fecha_egreso)/stats.total)*100)}%`} color="#f87171" />
                <StatCard label="Sin sexo"          value={Number(stats.sin_sexo).toLocaleString()}          sub={`${Math.round((Number(stats.sin_sexo)/stats.total)*100)}%`} color="#fb923c" />
                <StatCard label="Sin ley"           value={Number(stats.sin_ley).toLocaleString()}           sub={`${Math.round((Number(stats.sin_ley)/stats.total)*100)}%`} color="#fbbf24" />
                <StatCard label="Sin servicio"      value={Number(stats.sin_servicio).toLocaleString()}      sub={`${Math.round((Number(stats.sin_servicio)/stats.total)*100)}%`} color="#a78bfa" />
                <StatCard label="Sin F.Nacimiento"  value={Number(stats.sin_fecha_nacimiento).toLocaleString()} sub={`${Math.round((Number(stats.sin_fecha_nacimiento)/stats.total)*100)}%`} color="#60a5fa" />
                <StatCard label="Sin CUIL"          value={Number(stats.sin_cuil).toLocaleString()}          sub={`${Math.round((Number(stats.sin_cuil)/stats.total)*100)}%`} color="#34d399" />
              </div>

              {/* distribuciones */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>

                <div className="card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12, color: '#e2e8f0' }}>Por Ley</div>
                  <DistBar items={byLey} total={rows.length} />
                </div>

                <div className="card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12, color: '#e2e8f0' }}>Por Sexo</div>
                  <DistBar items={bySexo} total={rows.length} />
                </div>

                <div className="card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12, color: '#e2e8f0' }}>Por Grupo de Edad</div>
                  <DistBar items={byEdad} total={rows.length} />
                </div>

                <div className="card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12, color: '#e2e8f0' }}>Por Año de Egreso (top 12)</div>
                  <DistBar items={byAnioEgreso.slice(0, 12)} total={rows.length} />
                </div>

                <div className="card" style={{ padding: '1rem', gridColumn: 'span 2' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12, color: '#e2e8f0' }}>Por Servicio (top 12)</div>
                  <DistBar items={byServicio} total={rows.length} />
                </div>

              </div>
            </>
          )}

          {/* ─── TABLA ────────────────────────────────────────────────── */}
          {tab === 'tabla' && (
            <>
              {/* filtros */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <input
                  aria-label="Buscar por apellido, nombre o DNI"
                  className="input"
                  style={{ fontSize: '0.82rem', padding: '6px 10px', minWidth: 200, flex: 1 }}
                  placeholder="Buscar por apellido / nombre / DNI…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
                <select aria-label="Filtrar por sexo" style={sel} value={filterSexo} onChange={e => setFilterSexo(e.target.value)}>
                  <option value="">Sexo: todos</option>
                  {sexos.map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                </select>
                <select aria-label="Filtrar por ley" style={sel} value={filterLey} onChange={e => setFilterLey(e.target.value)}>
                  <option value="">Ley: todas</option>
                  {leyes.map(l => <option key={l.nombre} value={l.nombre}>{l.nombre}</option>)}
                </select>
                <select aria-label="Filtrar por servicio" style={sel} value={filterServicio} onChange={e => setFilterServicio(e.target.value)}>
                  <option value="">Servicio: todos</option>
                  {servicios.map(s => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
                </select>
                <select aria-label="Filtrar por datos incompletos" style={sel} value={filterMissing} onChange={e => setFilterMissing(e.target.value)}>
                  <option value="">Datos incompletos: todos</option>
                  {['Sexo','Ley','Servicio','F.Egreso','F.Nacimiento','CUIL'].map(f => (
                    <option key={f} value={f}>Sin {f}</option>
                  ))}
                </select>
                {(q || filterSexo || filterLey || filterServicio || filterMissing) && (
                  <button className="btn" onClick={() => { setQ(''); setFilterSexo(''); setFilterLey(''); setFilterServicio(''); setFilterMissing(''); }} type="button" style={{ fontSize: '0.82rem' }}>✕ Limpiar</button>
                )}
              </div>

              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 8 }}>
                Mostrando {filtered.length.toLocaleString()} de {rows.length.toLocaleString()}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>DNI</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Apellido y Nombre</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Estado</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Sexo</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Edad</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Ley</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Servicio</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>F.Ingreso</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>F.Egreso</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Faltantes</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 500).map(r => {
                      const missing = missingFields(r);
                      const hasIssues = missing.length > 0;
                      return (
                        <tr
                          key={r.dni}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: hasIssues ? 'rgba(251,146,60,0.04)' : undefined,
                          }}
                        >
                          <td style={{ padding: '7px 10px', color: '#94a3b8' }}>{r.dni}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 500 }}>{r.apellido}, {r.nombre}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                              background: r.estado_empleo === 'TRAMITE' ? 'rgba(251,191,36,0.15)' : 'rgba(239,68,68,0.15)',
                              color:      r.estado_empleo === 'TRAMITE' ? '#fbbf24'               : '#f87171',
                              border:     `1px solid ${r.estado_empleo === 'TRAMITE' ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            }}>{r.estado_empleo ?? '—'}</span>
                          </td>
                          <td style={{ padding: '7px 10px', color: r.sexo_nombre ? '#e2e8f0' : '#ef4444' }}>
                            {r.sexo_nombre ?? '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: r.edad != null ? '#e2e8f0' : '#ef4444' }}>
                            {r.edad != null ? r.edad : '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: r.ley_nombre ? '#e2e8f0' : '#ef4444' }}>
                            {r.ley_nombre ?? '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: r.servicio_nombre ? '#e2e8f0' : '#ef4444', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.servicio_nombre ?? '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#94a3b8' }}>{fmt(r.fecha_ingreso)}</td>
                          <td style={{ padding: '7px 10px', color: r.fecha_egreso ? '#e2e8f0' : '#ef4444' }}>
                            {fmt(r.fecha_egreso)}
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            {missing.length === 0
                              ? <span style={{ color: '#4ade80', fontSize: '0.75rem' }}>✓ Completo</span>
                              : <span style={{ color: '#fb923c', fontSize: '0.72rem' }}>{missing.join(', ')}</span>
                            }
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <button
                              className="btn"
                              onClick={() => setEditing(r)}
                              type="button"
                              style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                            >✏️</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length > 500 && (
                  <div style={{ padding: 12, color: '#64748b', fontSize: '0.78rem', textAlign: 'center' }}>
                    Mostrando los primeros 500 resultados. Usá los filtros para acotar la búsqueda.
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {editing && (
        <EditModal
          row={editing}
          leyes={leyesCat}
          sexos={sexos}
          servicios={serviciosCat}
          onClose={() => setEditing(null)}
          onSaved={upd => handleSaved(editing.dni, upd)}
        />
      )}
    </Layout>
  );
}
