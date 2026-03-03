// src/pages/EmbarazadasPage/index.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel, exportToPdf } from '../../utils/export';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface Embarazada {
  id: number;
  dni: string;
  embarazada: boolean;
  fecha_probable_parto: string;
  observaciones: string | null;
  alerta_45_avisada: boolean;
  alerta_45_fecha: string | null;
  alerta_45_usuario_nombre: string | null;
  alerta_45_usuario_email: string | null;
  created_at: string;
  updated_at: string;
  created_by_nombre: string | null;
  created_by_email: string | null;
  updated_by_nombre: string | null;
  updated_by_email: string | null;
  // enriquecido en frontend
  apellido?: string;
  nombre?: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function diasHastaFPP(fpp: string): number {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const f = new Date(fpp); f.setHours(0,0,0,0);
  return Math.round((f.getTime() - hoy.getTime()) / (1000*60*60*24));
}

function fmt(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); }
}

// amarillo si quedan ≤50 días y no fue avisada
function getRowStyle(row: Embarazada): React.CSSProperties {
  if (!row.embarazada) return {};
  if (row.alerta_45_avisada) return {};
  const dias = diasHastaFPP(row.fecha_probable_parto);
  if (dias <= 50 && dias > -60) {
    return { background: 'rgba(234,179,8,0.15)', borderLeft: '3px solid #eab308' };
  }
  return {};
}

// ─── HOOK BÚSQUEDA (igual a GestionPage) ─────────────────────────────────────

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
      toast.ok('Agente cargado', `${r.apellido ?? ''}, ${r.nombre ?? ''}`);
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
      else toast.ok(`${results.length} resultado(s)`);
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

export function EmbarazadasAlertaBanner() {
  const { session } = useAuth();
  const toast = useToast();
  const [alertas, setAlertas] = useState<Embarazada[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const logged = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>('/embarazadas?limit=200&embarazada=1');
        const rows: Embarazada[] = res?.data || [];
        const enAlerta = rows.filter(r => {
          if (!r.embarazada || r.alerta_45_avisada) return false;
          const dias = diasHastaFPP(r.fecha_probable_parto);
          return dias <= 50 && dias > -60;
        });
        if (enAlerta.length) {
          setAlertas(enAlerta);
          setVisible(true);

          // registrar quién vio la alerta (solo una vez por sesión)
          if (!logged.current && session) {
            logged.current = true;
            const u = session.user as any;
            await apiFetch('/alerta_vistas', {
              method: 'POST',
              body: JSON.stringify({
                tipo: 'embarazadas_45d',
                usuario_id: u?.id ?? null,
                usuario_email: u?.email ?? null,
                usuario_nombre: u?.nombre ?? null,
                detalle_json: JSON.stringify(enAlerta.map(e => ({ id: e.id, dni: e.dni, fpp: e.fecha_probable_parto }))),
              }),
            }).catch(() => {/* silencioso */});
          }
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
      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🤰</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 4 }}>
          Alerta: {alertas.length} agente{alertas.length > 1 ? 's' : ''} con FPP en ≤50 días
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {alertas.map(a => {
            const dias = diasHastaFPP(a.fecha_probable_parto);
            return (
              <div key={a.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>DNI {a.dni}</span>
                <span className="muted">·</span>
                <span>FPP: {fmt(a.fecha_probable_parto)}</span>
                <span style={{
                  background: dias <= 0 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)',
                  color: dias <= 0 ? '#ef4444' : '#eab308',
                  borderRadius: 6,
                  padding: '1px 7px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}>
                  {dias <= 0 ? `hace ${Math.abs(dias)}d` : `en ${dias}d`}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
          Ir a <a href="/app/embarazadas" style={{ color: '#eab308', textDecoration: 'underline' }}>Módulo Embarazadas</a> para marcar como avisadas.
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

export function EmbarazadasPage() {
  const { canCrud, hasPerm, session } = useAuth();
  const toast = useToast();
  const search = useAgenteSearch();
  const isAdmin = hasPerm('crud:*:*');

  const [rows, setRows] = useState<Embarazada[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);

  // formulario
  const [fpp, setFpp] = useState('');
  const [esEmbarazada, setEsEmbarazada] = useState(true);
  const [observaciones, setObservaciones] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const auditInfo = {
    id: (session?.user as any)?.id ?? null,
    email: session?.user?.email ?? null,
    nombre: (session?.user as any)?.nombre ?? null,
  };

  // ── Cargar todos ──
  const loadRows = useCallback(async () => {
    if (!canCrud('embarazadas', 'read')) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>('/embarazadas?limit=500&sort=-created_at');
      const data: Embarazada[] = res?.data || [];

      // Enriquecer con nombre desde personaldetalle (cache ya cargado por searchPersonal)
      // Hacemos un fetch de personal para los DNIs que necesitamos
      const dnis = [...new Set(data.map(r => String(r.dni)))];
      const nameMap = new Map<string, { apellido: string; nombre: string }>();
      // intentar con el cache ya disponible
      await Promise.allSettled(
        dnis.map(async d => {
          try {
            const r = await apiFetch<any>(`/personal/${d}`);
            if (r?.ok && r?.data) nameMap.set(d, { apellido: r.data.apellido || '', nombre: r.data.nombre || '' });
          } catch { /* no problem */ }
        })
      );

      setRows(data.map(r => ({ ...r, ...nameMap.get(String(r.dni)) })));
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [canCrud]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Reset form cuando cambia el agente seleccionado
  useEffect(() => {
    if (!search.row) {
      setFpp(''); setEsEmbarazada(true); setObservaciones(''); setEditingId(null);
      return;
    }
    // Ver si ya tiene registro
    const existing = rows.find(r => String(r.dni).replace(/\D/g,'') === String(search.row.dni).replace(/\D/g,''));
    if (existing) {
      setFpp(existing.fecha_probable_parto?.slice(0,10) || '');
      setEsEmbarazada(!!existing.embarazada);
      setObservaciones(existing.observaciones || '');
      setEditingId(existing.id);
    } else {
      setFpp(''); setEsEmbarazada(true); setObservaciones(''); setEditingId(null);
    }
  }, [search.row, rows]);

  // ── Guardar ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.row) { toast.error('Sin agente', 'Seleccioná un agente primero.'); return; }
    if (!fpp) { toast.error('Requerido', 'La fecha probable de parto es obligatoria.'); return; }
    setSaving(true);
    const dni = String(search.row.dni).replace(/\D/g, '');
    try {
      const body: any = {
        dni,
        embarazada: esEmbarazada ? 1 : 0,
        fecha_probable_parto: fpp,
        observaciones: observaciones || null,
        updated_by: auditInfo.id,
        updated_by_email: auditInfo.email,
        updated_by_nombre: auditInfo.nombre,
      };
      if (editingId) {
        await apiFetch(`/embarazadas/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Registro actualizado correctamente.');
      } else {
        await apiFetch('/embarazadas', {
          method: 'POST',
          body: JSON.stringify({ ...body, created_by: auditInfo.id, created_by_email: auditInfo.email, created_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Guardado', 'Registro guardado correctamente.');
      }
      search.clear();
      await loadRows();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  // ── Marcar avisada ──
  const handleMarcarAvisada = async (row: Embarazada) => {
    setMarkingId(row.id);
    try {
      await apiFetch(`/embarazadas/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          alerta_45_avisada: 1,
          alerta_45_fecha: new Date().toISOString(),
          alerta_45_usuario_id: auditInfo.id,
          alerta_45_usuario_email: auditInfo.email,
          alerta_45_usuario_nombre: auditInfo.nombre,
          updated_by: auditInfo.id,
          updated_by_email: auditInfo.email,
          updated_by_nombre: auditInfo.nombre,
        }),
      });
      toast.ok('Marcada', `${row.apellido || row.dni} marcada como avisada.`);
      await loadRows();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setMarkingId(null); }
  };

  // ── Estadísticas rápidas ──
  const activas = rows.filter(r => r.embarazada);
  const enAlerta = activas.filter(r => { const d = diasHastaFPP(r.fecha_probable_parto); return d <= 50 && d > -60 && !r.alerta_45_avisada; });
  const avisadas = activas.filter(r => r.alerta_45_avisada);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <Layout title="🤰 Embarazadas" showBack>

      {/* Banner alerta inline */}
      {enAlerta.length > 0 && (
        <div style={{ margin: '0 0 16px 0', padding: '12px 16px', background: 'rgba(234,179,8,0.12)', border: '2px solid rgba(234,179,8,0.5)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 6 }}>
            ⚠️ {enAlerta.length} agente{enAlerta.length > 1 ? 's' : ''} con FPP en ≤50 días sin avisar
          </div>
          {enAlerta.map(a => {
            const dias = diasHastaFPP(a.fecha_probable_parto);
            return (
              <div key={a.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{a.apellido ? `${a.apellido}, ${a.nombre}` : `DNI ${a.dni}`}</span>
                <span className="muted">FPP: {fmt(a.fecha_probable_parto)}</span>
                <span style={{ background: 'rgba(234,179,8,0.25)', color: '#eab308', borderRadius: 6, padding: '1px 8px', fontSize: '0.77rem', fontWeight: 700 }}>
                  {dias <= 0 ? `hace ${Math.abs(dias)}d` : `en ${dias}d`}
                </span>
                <button className="btn" type="button"
                  style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(234,179,8,0.2)', color: '#eab308' }}
                  onClick={() => handleMarcarAvisada(a)}
                  disabled={markingId === a.id}>
                  {markingId === a.id ? '...' : '✓ Marcar avisada'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Embarazadas activas', val: activas.length, color: '#14b8a6' },
          { label: 'En alerta (≤50 días)', val: enAlerta.length, color: '#eab308' },
          { label: 'Avisadas', val: avisadas.length, color: '#10b981' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{val}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── BÚSQUEDA ── */}
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

        {/* Coincidencias */}
        {search.matches.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 6 }}>{search.matches.length} resultado(s):</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {search.matches.map((m: any) => (
                <button key={m.dni} className="btn" type="button"
                  style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  onClick={() => search.loadByDni(String(m.dni))}>
                  <strong>{m.apellido}, {m.nombre}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>
                    DNI {m.dni}{m.estado_empleo ? ` · ${m.estado_empleo}` : ''}{m.dependencia_nombre ? ` · ${m.dependencia_nombre}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agente seleccionado */}
        {search.row && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{search.row.apellido}, {search.row.nombre}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>
                DNI {search.row.dni}
                {search.row.cuil ? ` · CUIL ${search.row.cuil}` : ''}
                {search.row.estado_empleo ? ` · ${search.row.estado_empleo}` : ''}
                {editingId && <span style={{ marginLeft: 8, color: '#f59e0b' }}>● Ya tiene registro — editando</span>}
              </div>
            </div>
            <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={search.clear}>✕ Limpiar</button>
          </div>
        )}
      </div>

      {/* ── FORMULARIO ── */}
      {canCrud('embarazadas', 'create') && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="h2" style={{ marginBottom: 10 }}>
            {editingId ? '✏️ Editar registro' : '➕ Nuevo registro'}
            {search.row && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {search.row.apellido}, {search.row.nombre}</span>}
          </div>
          {!search.row && (
            <div style={alertStyle}>⚠️ Buscá y seleccioná un agente antes de cargar.</div>
          )}
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={fg}>
                <label style={lbl}>Fecha probable de parto *</label>
                <input className="input" type="date" value={fpp}
                  onChange={e => setFpp(e.target.value)} required />
              </div>
              <div style={fg}>
                <label style={lbl}>Estado</label>
                <div className="row" style={{ gap: 10, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.88rem' }}>
                    <input type="radio" checked={esEmbarazada} onChange={() => setEsEmbarazada(true)} />
                    🤰 Embarazada
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.88rem' }}>
                    <input type="radio" checked={!esEmbarazada} onChange={() => setEsEmbarazada(false)} />
                    No embarazada
                  </label>
                </div>
              </div>
              <div style={fg}>
                <label style={lbl}>Observaciones</label>
                <input className="input" type="text" placeholder="Observaciones opcionales"
                  value={observaciones} onChange={e => setObservaciones(e.target.value)} />
              </div>
            </div>

            {/* Preview FPP */}
            {fpp && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 6, fontSize: '0.82rem' }}>
                📅 FPP: <strong>{fmt(fpp)}</strong>
                {(() => {
                  const d = diasHastaFPP(fpp);
                  const color = d <= 50 ? '#eab308' : '#10b981';
                  return <span style={{ marginLeft: 8, color, fontWeight: 700 }}>
                    {d <= 0 ? `hace ${Math.abs(d)} días` : `faltan ${d} días`}
                    {d <= 50 && d > -60 && ' ⚠️ Alerta activa'}
                  </span>;
                })()}
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn ok" type="submit" disabled={saving || !search.row}>
                {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
              </button>
              {editingId && (
                <button className="btn" type="button" onClick={() => {
                  setEditingId(null); setFpp(''); setEsEmbarazada(true); setObservaciones(''); search.clear();
                }}>Cancelar</button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ── TABLA ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="h2">Registro de embarazadas ({rows.length})</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" type="button" disabled={!rows.length}
              onClick={() => exportToExcel('embarazadas', rows)}>📊 Excel</button>
            <button className="btn" type="button" disabled={!rows.length}
              onClick={() => exportToPdf('embarazadas', rows)}>📄 PDF</button>
          </div>
        </div>

        {loading ? (
          <div className="muted">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="muted">No hay registros cargados.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  {['DNI','Apellido y Nombre','Estado','FPP','Días','Alerta','Avisada por','Cargado por','Modificado por',''].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const dias = diasHastaFPP(r.fecha_probable_parto);
                  const enAlerta45 = r.embarazada && !r.alerta_45_avisada && dias <= 50 && dias > -60;
                  const rowSt = getRowStyle(r);
                  return (
                    <tr key={r.id} style={rowSt}>
                      <td style={td}><strong>{r.dni}</strong></td>
                      <td style={td}>{r.apellido ? `${r.apellido}, ${r.nombre}` : <span className="muted">—</span>}</td>
                      <td style={td}>
                        <span style={{
                          background: r.embarazada ? 'rgba(20,184,166,0.15)' : 'rgba(100,116,139,0.2)',
                          color: r.embarazada ? '#14b8a6' : 'rgba(255,255,255,0.5)',
                          borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem', fontWeight: 600,
                        }}>
                          {r.embarazada ? '🤰 Embarazada' : 'No'}
                        </span>
                      </td>
                      <td style={td}>{fmt(r.fecha_probable_parto)}</td>
                      <td style={td}>
                        {r.embarazada && (
                          <span style={{
                            fontWeight: 700,
                            color: dias <= 0 ? '#ef4444' : dias <= 50 ? '#eab308' : '#10b981',
                          }}>
                            {dias <= 0 ? `hace ${Math.abs(dias)}d` : `${dias}d`}
                          </span>
                        )}
                      </td>
                      <td style={td}>
                        {enAlerta45 ? (
                          <span style={{ background: 'rgba(234,179,8,0.2)', color: '#eab308', borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem', fontWeight: 700 }}>
                            ⚠️ Pendiente
                          </span>
                        ) : r.alerta_45_avisada ? (
                          <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', borderRadius: 6, padding: '2px 8px', fontSize: '0.78rem' }}>
                            ✓ Avisada
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: '0.78rem' }}>—</span>
                        )}
                      </td>
                      <td style={td}>
                        {r.alerta_45_avisada ? (
                          <div style={{ fontSize: '0.75rem' }}>
                            <div>{r.alerta_45_usuario_nombre || r.alerta_45_usuario_email || '—'}</div>
                            <div className="muted">{fmt(r.alerta_45_fecha)}</div>
                          </div>
                        ) : enAlerta45 ? (
                          <button className="btn" type="button"
                            style={{ fontSize: '0.72rem', padding: '3px 10px', background: 'rgba(234,179,8,0.2)', color: '#eab308' }}
                            onClick={() => handleMarcarAvisada(r)}
                            disabled={markingId === r.id}>
                            {markingId === r.id ? '...' : '✓ Marcar avisada'}
                          </button>
                        ) : <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>}
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: '0.75rem' }}>
                          <div>{r.created_by_nombre || r.created_by_email || '—'}</div>
                          <div className="muted">{fmt(r.created_at)}</div>
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: '0.75rem' }}>
                          {r.updated_by_nombre || r.updated_by_email
                            ? <><div>{r.updated_by_nombre || r.updated_by_email}</div><div className="muted">{fmt(r.updated_at)}</div></>
                            : <span className="muted">—</span>}
                        </div>
                      </td>
                      <td style={td}>
                        {canCrud('embarazadas', 'update') && (
                          <button className="btn" type="button"
                            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                            onClick={() => {
                              search.loadByDni(String(r.dni));
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}>
                            ✏️
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Leyenda */}
        <div className="muted" style={{ fontSize: '0.72rem', marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#eab308' }}>■</span> En alerta (FPP ≤50 días, sin avisar)</span>
          <span><span style={{ color: '#10b981' }}>✓</span> Marcada como avisada</span>
          <span>Días = días hasta la FPP (negativo = ya pasó)</span>
        </div>
      </div>
    </Layout>
  );
}

// ─── ESTILOS ─────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', fontWeight: 500, marginBottom: 4, display: 'block' };
const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' };
const alertStyle: React.CSSProperties = { padding: '10px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, marginBottom: 12, fontSize: '0.82rem', color: 'rgba(245,158,11,0.9)' };
