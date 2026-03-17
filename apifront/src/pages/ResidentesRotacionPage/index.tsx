// src/pages/ResidentesRotacionPage/index.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel, exportToPdf } from '../../utils/export';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface Rotacion {
  id: number;
  dni: string;
  fecha_desde: string;
  fecha_hasta: string | null;
  servicio: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  created_by_nombre: string | null;
  created_by_email: string | null;
  updated_by_nombre: string | null;
  updated_by_email: string | null;
  deleted_at: string | null;
  deleted_by_nombre: string | null;
  deleted_by_email: string | null;
  // enriquecido en frontend
  apellido?: string;
  nombre?: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}

function duracion(desde: string, hasta: string | null): string {
  const d1 = new Date(desde).getTime();
  const d2 = hasta ? new Date(hasta).getTime() : Date.now();
  const dias = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  if (dias < 0) return '—';
  if (dias < 30) return `${dias}d`;
  const meses = Math.floor(dias / 30);
  const resto = dias % 30;
  return resto > 0 ? `${meses}m ${resto}d` : `${meses}m`;
}

// ─── HOOK BÚSQUEDA ────────────────────────────────────────────────────────────

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

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────────────────────

export function ResidentesRotacionPage() {
  const { canCrud, hasPerm, session } = useAuth();
  const toast = useToast();
  const search = useAgenteSearch();
  const isAdmin = hasPerm('crud:*:*');

  const [rows, setRows] = useState<Rotacion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // formulario
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [servicio, setServicio] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const auditInfo = {
    id: (session?.user as any)?.id ?? null,
    email: session?.user?.email ?? null,
    nombre: (session?.user as any)?.nombre ?? null,
  };

  // ── Cargar todos ──
  const loadRows = useCallback(async () => {
    if (!canCrud('residentes_rotacion', 'read')) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>('/residentes_rotacion?limit=500&sort=-created_at');
      const data: Rotacion[] = res?.data || [];

      const dnis = [...new Set(data.map(r => String(r.dni)))];
      const nameMap = new Map<string, { apellido: string; nombre: string }>();
      await Promise.allSettled(
        dnis.map(async d => {
          try {
            const r = await apiFetch<any>(`/personal/${d}`);
            if (r?.ok && r?.data) nameMap.set(d, { apellido: r.data.apellido || '', nombre: r.data.nombre || '' });
          } catch { /* ignorar */ }
        })
      );
      setRows(data.map(r => ({ ...r, ...nameMap.get(String(r.dni)) })));
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [canCrud]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Reset form cuando cambia agente
  useEffect(() => {
    setFechaDesde(''); setFechaHasta(''); setServicio(''); setObservaciones(''); setEditingId(null);
  }, [search.row]);

  // ── Guardar ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.row) { toast.error('Sin agente', 'Seleccioná un residente primero.'); return; }
    if (!fechaDesde) { toast.error('Requerido', 'La fecha desde es obligatoria.'); return; }
    setSaving(true);
    const dni = String(search.row.dni).replace(/\D/g, '');
    try {
      const body: any = {
        dni,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta || null,
        servicio: servicio || null,
        observaciones: observaciones || null,
        updated_by: auditInfo.id,
        updated_by_email: auditInfo.email,
        updated_by_nombre: auditInfo.nombre,
      };
      if (editingId) {
        if (!isAdmin) { toast.error('Sin permiso', 'Solo el administrador puede editar rotaciones.'); return; }
        await apiFetch(`/residentes_rotacion/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Rotación actualizada correctamente.');
      } else {
        await apiFetch('/residentes_rotacion', {
          method: 'POST',
          body: JSON.stringify({ ...body, created_by: auditInfo.id, created_by_email: auditInfo.email, created_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Guardado', 'Rotación cargada correctamente.');
      }
      search.clear();
      setEditingId(null);
      await loadRows();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  // ── Editar (solo admin) ──
  const startEdit = (r: Rotacion) => {
    if (!isAdmin) { toast.error('Sin permiso', 'Solo el administrador puede editar.'); return; }
    search.loadByDni(r.dni);
    setFechaDesde(r.fecha_desde?.slice(0, 10) || '');
    setFechaHasta(r.fecha_hasta?.slice(0, 10) || '');
    setServicio(r.servicio || '');
    setObservaciones(r.observaciones || '');
    setEditingId(r.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Eliminar (solo admin, soft delete) ──
  const handleDelete = async (r: Rotacion) => {
    if (!isAdmin) { toast.error('Sin permiso', 'Solo el administrador puede eliminar.'); return; }
    if (!confirm(`¿Eliminar rotación de ${r.apellido || r.dni}?`)) return;
    setDeletingId(r.id);
    try {
      await apiFetch(`/residentes_rotacion/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          deleted_at: new Date().toISOString(),
          deleted_by: auditInfo.id,
          deleted_by_email: auditInfo.email,
          deleted_by_nombre: auditInfo.nombre,
        }),
      });
      toast.ok('Eliminado', 'Rotación eliminada.');
      await loadRows();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setDeletingId(null); }
  };

  // filtrar eliminados
  const rowsActivos = rows.filter(r => !r.deleted_at);
  const rowsEliminados = rows.filter(r => r.deleted_at);
  const [verEliminados, setVerEliminados] = useState(false);

  const rowsVisibles = verEliminados ? rows : rowsActivos;

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <Layout title="🔄 Residentes — Rotación" showBack>

      {/* Estadísticas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Rotaciones activas', val: rowsActivos.length, color: '#14b8a6' },
          { label: 'En curso', val: rowsActivos.filter(r => !r.fecha_hasta).length, color: '#6366f1' },
          { label: 'Finalizadas', val: rowsActivos.filter(r => !!r.fecha_hasta).length, color: '#10b981' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{val}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── BÚSQUEDA ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 10 }}>Buscar residente</div>
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
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>
                  DNI {m.dni}{m.estado_empleo ? ` · ${m.estado_empleo}` : ''}{m.dependencia_nombre ? ` · ${m.dependencia_nombre}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {search.row && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{search.row.apellido}, {search.row.nombre}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>
                DNI {search.row.dni}
                {search.row.cuil ? ` · CUIL ${search.row.cuil}` : ''}
                {search.row.estado_empleo ? ` · ${search.row.estado_empleo}` : ''}
                {editingId && <span style={{ marginLeft: 8, color: '#f59e0b' }}>● Editando rotación existente</span>}
              </div>
            </div>
            <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={() => { search.clear(); setEditingId(null); }}>✕ Limpiar</button>
          </div>
        )}
      </div>

      {/* ── FORMULARIO ── */}
      {canCrud('residentes_rotacion', 'create') && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="h2" style={{ marginBottom: 10 }}>
            {editingId ? '✏️ Editar rotación' : '➕ Nueva rotación'}
            {search.row && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {search.row.apellido}, {search.row.nombre}</span>}
          </div>
          {!search.row && (
            <div style={alertStyle}>⚠️ Buscá y seleccioná un residente antes de cargar.</div>
          )}
          {editingId && !isAdmin && (
            <div style={{ ...alertStyle, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca' }}>
              🔒 Solo el administrador puede editar rotaciones existentes.
            </div>
          )}
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={fg}>
                <label style={lbl}>Fecha desde *</label>
                <input className="input" type="date" value={fechaDesde}
                  onChange={e => setFechaDesde(e.target.value)}
                  disabled={!!editingId && !isAdmin} required />
              </div>
              <div style={fg}>
                <label style={lbl}>Fecha hasta <span className="muted">(opcional)</span></label>
                <input className="input" type="date" value={fechaHasta}
                  min={fechaDesde || undefined}
                  onChange={e => setFechaHasta(e.target.value)}
                  disabled={!!editingId && !isAdmin} />
              </div>
              <div style={fg}>
                <label style={lbl}>Servicio / Área</label>
                <input className="input" type="text" placeholder="Ej: Guardia, UTI, Cirugía..."
                  value={servicio} onChange={e => setServicio(e.target.value)}
                  disabled={!!editingId && !isAdmin} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Observaciones</label>
              <input className="input" type="text" placeholder="Observaciones opcionales" style={{ width: '100%', boxSizing: 'border-box' }}
                value={observaciones} onChange={e => setObservaciones(e.target.value)}
                disabled={!!editingId && !isAdmin} />
            </div>

            {fechaDesde && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 6, fontSize: '0.82rem' }}>
                📅 Desde <strong>{fmt(fechaDesde)}</strong>
                {fechaHasta && <> hasta <strong>{fmt(fechaHasta)}</strong> — <strong style={{ color: '#10b981' }}>{duracion(fechaDesde, fechaHasta)}</strong></>}
                {!fechaHasta && <span className="muted"> · En curso</span>}
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="btn ok" type="submit"
                disabled={saving || !search.row || (!!editingId && !isAdmin)}>
                {saving ? 'Guardando...' : (editingId ? 'Guardar cambios' : 'Guardar')}
              </button>
              {editingId && (
                <button className="btn" type="button"
                  onClick={() => { search.clear(); setEditingId(null); }}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ── TABLA ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="h2">
            Rotaciones {verEliminados ? '(todas)' : `(${rowsActivos.length})`}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {isAdmin && rowsEliminados.length > 0 && (
              <button className="btn" type="button"
                style={{ fontSize: '0.78rem', opacity: 0.7 }}
                onClick={() => setVerEliminados(v => !v)}>
                {verEliminados ? '🙈 Ocultar eliminados' : `🗑️ Ver eliminados (${rowsEliminados.length})`}
              </button>
            )}
            <button className="btn" type="button" onClick={() => exportToExcel(rowsVisibles, 'rotacion.xlsx')} disabled={!rowsVisibles.length}>📊 Excel</button>
            <button className="btn" type="button" onClick={() => exportToPdf(rowsVisibles, 'rotacion.pdf')} disabled={!rowsVisibles.length}>📄 PDF</button>
          </div>
        </div>

        {loading ? <div className="muted">Cargando...</div> : rowsVisibles.length === 0 ? (
          <div className="muted">No hay rotaciones cargadas.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  {['DNI', 'Apellido y Nombre', 'Servicio', 'Desde', 'Hasta', 'Duración', 'Obs.', 'Cargado por', 'Modificado por', isAdmin ? 'Acciones' : ''].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsVisibles.map(r => (
                  <tr key={r.id} style={r.deleted_at ? { opacity: 0.45 } : {}}>
                    <td style={td}><strong>{r.dni}</strong></td>
                    <td style={td}>{r.apellido ? `${r.apellido}, ${r.nombre}` : '—'}</td>
                    <td style={td}>{r.servicio || <span className="muted">—</span>}</td>
                    <td style={td}>{fmt(r.fecha_desde)}</td>
                    <td style={td}>
                      {r.fecha_hasta
                        ? fmt(r.fecha_hasta)
                        : <span style={{ color: '#6366f1', fontWeight: 600, fontSize: '0.78rem' }}>En curso</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontWeight: 600, color: '#10b981' }}>
                        {duracion(r.fecha_desde, r.fecha_hasta)}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.observaciones || <span className="muted">—</span>}
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
                    {isAdmin && (
                      <td style={td}>
                        {!r.deleted_at && (
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn" type="button"
                              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                              onClick={() => startEdit(r)}>✏️</button>
                            <button className="btn" type="button"
                              style={{ fontSize: '0.75rem', padding: '4px 10px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}
                              onClick={() => handleDelete(r)}
                              disabled={deletingId === r.id}>
                              {deletingId === r.id ? '...' : '🗑️'}
                            </button>
                          </div>
                        )}
                        {r.deleted_at && (
                          <div style={{ fontSize: '0.72rem' }}>
                            <div className="muted">Eliminado</div>
                            <div className="muted">{fmt(r.deleted_at)}</div>
                            {r.deleted_by_nombre && <div className="muted">{r.deleted_by_nombre}</div>}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 12 }}>
        🔄 Rotación de residentes · Solo administradores pueden editar o eliminar registros
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
const alertStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgba(245,158,11,0.9)', marginBottom: 12, fontSize: '0.85rem' };
