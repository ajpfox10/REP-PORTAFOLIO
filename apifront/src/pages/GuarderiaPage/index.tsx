// src/pages/GuarderiaPage/index.tsx
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface EmbarazadaPendiente {
  id: number;
  dni: string;
  fecha_probable_parto: string;
  observaciones: string | null;
  apellido?: string;
  nombre?: string;
  ley_nombre?: string;
}

interface GuarderiaRow {
  id: number;
  dni: string;
  fecha_nacimiento: string;
  alerta_45_avisada: boolean;
  alerta_45_fecha: string | null;
  alerta_45_usuario_id: number | null;
  alerta_45_usuario_nombre: string | null;
  alerta_45_usuario_email: string | null;
  tramite_realizado: boolean;
  tramite_fecha: string | null;
  tramite_usuario_id: number | null;
  tramite_usuario_nombre: string | null;
  tramite_usuario_email: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  deleted_by: number | null;
  // enriquecido en frontend
  apellido?: string;
  nombre?: string;
  ley_nombre?: string;
  planta_nombre?: string;
  servicio_nombre?: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function diasDesde(fecha: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
  const f = new Date(y, m - 1, d);
  return Math.round((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  } catch { return String(d); }
}

// nombrada = ley_nombre no contiene "BECA" (case-insensitive)
function esNombrada(ley?: string | null): boolean {
  if (!ley) return true; // sin dato: mostrar igual
  return !ley.toUpperCase().includes('BECA');
}

// alerta: a los 45 días del nacimiento, no avisada, nombrada
function enAlerta(row: GuarderiaRow): boolean {
  if (row.alerta_45_avisada) return false;
  if (!esNombrada(row.ley_nombre)) return false;
  const dias = diasDesde(row.fecha_nacimiento);
  return dias >= 45;
}

function getRowStyle(row: GuarderiaRow): React.CSSProperties {
  if (enAlerta(row)) return { background: 'rgba(234,179,8,0.13)', borderLeft: '3px solid #eab308' };
  if (row.tramite_realizado) return { opacity: 0.6 };
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

// ─── BANNER ALERTA (para Dashboard) ──────────────────────────────────────────

export function GuarderiaAlertaBanner() {
  const { session } = useAuth();
  const [alertas, setAlertas] = useState<GuarderiaRow[]>([]);
  const [embarazadasSinGuarderia, setEmbarazadasSinGuarderia] = useState<EmbarazadaPendiente[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const logged = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [guarderiaRes, embRes] = await Promise.all([
          apiFetch<any>('/guarderia?limit=500'),
          apiFetch<any>('/embarazadas?limit=500&embarazada=1'),
        ]);
        const rows: GuarderiaRow[] = guarderiaRes?.data || [];
        const embarazadas: any[] = embRes?.data || [];

        const dnis = [...new Set([
          ...rows.map(r => String(r.dni).replace(/\D/g, '')),
          ...embarazadas.map(r => String(r.dni).replace(/\D/g, '')),
        ])];
        const nameMap = new Map<string, any>();
        await Promise.allSettled(
          dnis.map(async d => {
            const r = await apiFetch<any>(`/personal/${d}`).catch(() => null);
            if (r?.ok && r?.data) nameMap.set(d, r.data);
          })
        );

        const enriched = rows.map(r => ({ ...r, ...nameMap.get(String(r.dni).replace(/\D/g, '')) }));
        const enAl = enriched.filter(r => enAlerta(r));
        const dniConGuarderia = new Set(rows.map(r => String(r.dni).replace(/\D/g, '')));
        const pendientes = embarazadas
          .filter(r => {
            const dni = String(r.dni).replace(/\D/g, '');
            if (!dni || dniConGuarderia.has(dni)) return false;
            const p = nameMap.get(dni);
            return esNombrada(p?.ley_nombre);
          })
          .map(r => {
            const dni = String(r.dni).replace(/\D/g, '');
            const p = nameMap.get(dni);
            return {
              id: r.id,
              dni,
              fecha_probable_parto: r.fecha_probable_parto,
              observaciones: r.observaciones,
              apellido: p?.apellido,
              nombre: p?.nombre,
              ley_nombre: p?.ley_nombre,
            };
          });
        if (!enAl.length && !pendientes.length) return;

        setAlertas(enAl);
        setEmbarazadasSinGuarderia(pendientes);
        setVisible(true);

        if (!logged.current && session) {
          logged.current = true;
          const u = session.user as any;
          await apiFetch('/alerta_vistas', {
            method: 'POST',
            body: JSON.stringify({
              tipo: 'guarderia_45d',
              usuario_id: u?.id ?? null,
              usuario_email: u?.email ?? null,
              usuario_nombre: u?.nombre ?? null,
              detalle_json: JSON.stringify({
                guarderia45d: enAl.map(e => ({ id: e.id, dni: e.dni, fecha_nacimiento: e.fecha_nacimiento })),
                embarazadasSinGuarderia: pendientes.map(e => ({ id: e.id, dni: e.dni, fpp: e.fecha_probable_parto })),
              }),
            }),
          }).catch(() => {});
        }
      } catch { /* silencioso */ }
    })();
  }, [session]);

  if (!visible || dismissed || (!alertas.length && !embarazadasSinGuarderia.length)) return null;

  return (
    <div style={{ margin: '0 0 16px 0', padding: '14px 16px', background: 'rgba(234,179,8,0.12)', border: '2px solid rgba(234,179,8,0.6)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>👶</span>
      <div style={{ flex: 1 }}>
        {embarazadasSinGuarderia.length > 0 && (
          <>
            <div style={{ fontWeight: 700, color: '#c4b5fd', fontSize: '0.86rem', margin: '4px 0' }}>
              {embarazadasSinGuarderia.length} embarazada{embarazadasSinGuarderia.length > 1 ? 's' : ''} nombrada{embarazadasSinGuarderia.length > 1 ? 's' : ''} sin registro de guardería
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: alertas.length ? 8 : 0 }}>
              {embarazadasSinGuarderia.slice(0, 8).map(a => (
                <div key={`emb-${a.id}`} style={{ fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{a.apellido ? `${a.apellido}, ${a.nombre}` : `DNI ${a.dni}`}</span>
                  <span className="muted">·</span>
                  <span>DNI {a.dni}</span>
                  <span className="muted">FPP: {fmt(a.fecha_probable_parto)}</span>
                </div>
              ))}
              {embarazadasSinGuarderia.length > 8 && (
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  y {embarazadasSinGuarderia.length - 8} más...
                </div>
              )}
            </div>
          </>
        )}
        <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 4, display: alertas.length ? 'block' : 'none' }}>
          Alerta: {alertas.length} agente{alertas.length > 1 ? 's' : ''} con trámite de guardería pendiente (a los 45 días del nacimiento)
        </div>
        <div style={{ display: alertas.length ? 'flex' : 'none', flexDirection: 'column', gap: 3 }}>
          {alertas.map(a => {
            const dias = diasDesde(a.fecha_nacimiento);
            return (
              <div key={a.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{a.apellido ? `${a.apellido}, ${a.nombre}` : `DNI ${a.dni}`}</span>
                <span className="muted">·</span>
                <span>Nacimiento: {fmt(a.fecha_nacimiento)}</span>
                <span style={{ background: dias > 60 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)', color: dias > 60 ? '#ef4444' : '#eab308', borderRadius: 6, padding: '1px 7px', fontSize: '0.78rem', fontWeight: 700 }}>
                  {dias}d desde nacimiento
                </span>
                {a.ley_nombre && <span className="muted" style={{ fontSize: '0.78rem' }}>{a.ley_nombre}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
          Ir a <a href="/app/guarderia" style={{ color: '#eab308', textDecoration: 'underline' }}>Guardería y Salario</a> para marcar como avisadas.
        </div>
      </div>
      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '1.1rem', padding: 0 }} onClick={() => setDismissed(true)} title="Cerrar">✕</button>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────────────────────

type Tab = 'cargar' | 'historial';

export function GuarderiaPage() {
  const { canCrud, session } = useAuth();
  const toast = useToast();
  const search = useAgenteSearch();

  const [tab, setTab] = useState<Tab>('cargar');
  const [rows, setRows] = useState<GuarderiaRow[]>([]);
  const [embarazadasPendientes, setEmbarazadasPendientes] = useState<EmbarazadaPendiente[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [tramiteId, setTramiteId] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<GuarderiaRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // form cargar
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  // edit modal
  const [editFechaNac, setEditFechaNac] = useState('');
  const [editObs, setEditObs] = useState('');

  const auditInfo = {
    id: (session?.user as any)?.id ?? null,
    email: session?.user?.email ?? null,
    nombre: (session?.user as any)?.nombre ?? null,
  };

  // ── Cargar datos ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [guarderiaRes, embRes] = await Promise.all([
        apiFetch<any>('/guarderia?limit=1000&sort=-created_at'),
        apiFetch<any>('/embarazadas?limit=500&embarazada=1'),
      ]);
      const guarderiaData: GuarderiaRow[] = guarderiaRes?.data || [];
      const embData: any[] = embRes?.data || [];

      // DNIs únicos de ambos sets (normalizados)
      const allDnis = [...new Set([
        ...guarderiaData.map(r => String(r.dni).replace(/\D/g, '')),
        ...embData.map(r => String(r.dni).replace(/\D/g, '')),
      ])];
      const nameMap = new Map<string, any>();
      await Promise.allSettled(
        allDnis.map(async d => {
          try {
            const r = await apiFetch<any>(`/personal/${d}`);
            if (r?.ok && r?.data) nameMap.set(d, r.data);
          } catch { /* ok */ }
        })
      );

      const enrichedGuarderia = guarderiaData.map(r => {
        const p = nameMap.get(String(r.dni).replace(/\D/g, ''));
        return {
          ...r,
          apellido: p?.apellido,
          nombre: p?.nombre,
          ley_nombre: p?.ley_nombre,
          planta_nombre: p?.planta_nombre,
          servicio_nombre: p?.servicio_nombre,
        };
      });
      setRows(enrichedGuarderia);

      // Embarazadas no becarias sin registro de guardería
      const dniConGuarderia = new Set(guarderiaData.map(r => String(r.dni).replace(/\D/g, '')));
      const pendientes: EmbarazadaPendiente[] = embData
        .filter(r => {
          const dni = String(r.dni).replace(/\D/g, '');
          if (dniConGuarderia.has(dni)) return false;
          const p = nameMap.get(dni);
          return esNombrada(p?.ley_nombre);
        })
        .map(r => {
          const dni = String(r.dni).replace(/\D/g, '');
          const p = nameMap.get(dni);
          return {
            id: r.id,
            dni,
            fecha_probable_parto: r.fecha_probable_parto,
            observaciones: r.observaciones,
            apellido: p?.apellido,
            nombre: p?.nombre,
            ley_nombre: p?.ley_nombre,
          };
        });
      setEmbarazadasPendientes(pendientes);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Pre-cargar form si el agente ya tiene registro
  useEffect(() => {
    if (!search.row) { setFechaNacimiento(''); setObservaciones(''); setEditingId(null); return; }
    const existing = rows.find(r => String(r.dni).replace(/\D/g, '') === String(search.row.dni).replace(/\D/g, ''));
    if (existing) {
      setFechaNacimiento(existing.fecha_nacimiento?.slice(0, 10) ?? '');
      setObservaciones(existing.observaciones ?? '');
      setEditingId(existing.id);
    } else {
      setFechaNacimiento(''); setObservaciones(''); setEditingId(null);
    }
  }, [search.row, rows]);

  // ── Guardar / Editar inline ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.row) { toast.error('Sin agente', 'Buscá y seleccioná un agente.'); return; }
    if (!fechaNacimiento) { toast.error('Sin fecha', 'Ingresá la fecha de nacimiento.'); return; }
    setSaving(true);
    const dni = String(search.row.dni).replace(/\D/g, '');
    try {
      const body: any = {
        dni,
        fecha_nacimiento: fechaNacimiento,
        observaciones: observaciones.trim() || null,
        updated_by: auditInfo.id,
      };
      if (editingId) {
        await apiFetch(`/guarderia/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Registro actualizado.');
      } else {
        await apiFetch('/guarderia', { method: 'POST', body: JSON.stringify({ ...body, created_by: auditInfo.id }) });
        toast.ok('Guardado', 'Registro guardado.');
      }
      search.clear();
      await loadAll();
      setTab('historial');
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  // ── Marcar avisada + crear citación automática ──
  const handleMarcarAvisada = async (row: GuarderiaRow) => {
    setMarkingId(row.id);
    try {
      const ahora = new Date().toISOString();
      const dias = diasDesde(row.fecha_nacimiento);

      await apiFetch(`/guarderia/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          alerta_45_avisada: 1,
          alerta_45_fecha: ahora,
          alerta_45_usuario_id: auditInfo.id,
          alerta_45_usuario_nombre: auditInfo.nombre,
          alerta_45_usuario_email: auditInfo.email,
          updated_by: auditInfo.id,
        }),
      });

      await apiFetch('/alerta_vistas', {
        method: 'POST',
        body: JSON.stringify({
          tipo: 'guarderia_45d_avisada',
          usuario_id: auditInfo.id,
          usuario_email: auditInfo.email,
          usuario_nombre: auditInfo.nombre,
          detalle_json: JSON.stringify({ id: row.id, dni: row.dni, fecha_nacimiento: row.fecha_nacimiento }),
        }),
      }).catch(() => {});

      // Crear citación automática
      const agente = row.apellido ? `${row.apellido}, ${row.nombre}` : `DNI ${row.dni}`;
      await apiFetch('/citaciones', {
        method: 'POST',
        body: JSON.stringify({
          dni: String(row.dni).replace(/\D/g, ''),
          motivo: `Trámite de Guardería y Salario Familiar: se notificó a la agente (${dias} días desde nacimiento del/la hijo/a${row.observaciones ? ` — ${row.observaciones}` : ''})`,
          fecha_citacion: ahora,
          citado_por: auditInfo.nombre ?? auditInfo.email ?? '',
          citacion_activa: 1,
        }),
      });

      toast.ok('Avisada', `${agente} — aviso registrado y citación creada automáticamente.`);
      await loadAll();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setMarkingId(null); }
  };

  // ── Marcar trámite realizado ──
  const handleMarcarTramite = async (row: GuarderiaRow) => {
    setTramiteId(row.id);
    try {
      await apiFetch(`/guarderia/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tramite_realizado: 1,
          tramite_fecha: new Date().toISOString(),
          tramite_usuario_id: auditInfo.id,
          tramite_usuario_nombre: auditInfo.nombre,
          tramite_usuario_email: auditInfo.email,
          updated_by: auditInfo.id,
        }),
      });
      toast.ok('Trámite registrado', 'Trámite marcado como realizado.');
      await loadAll();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setTramiteId(null); }
  };

  // ── Abrir modal edición ──
  const openEdit = (row: GuarderiaRow) => {
    setEditingRow(row);
    setEditFechaNac(row.fecha_nacimiento?.slice(0, 10) ?? '');
    setEditObs(row.observaciones ?? '');
  };

  // ── Guardar edición modal ──
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow) return;
    if (!editFechaNac) { toast.error('Sin fecha', 'Ingresá la fecha de nacimiento.'); return; }
    setEditSaving(true);
    try {
      await apiFetch(`/guarderia/${editingRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fecha_nacimiento: editFechaNac,
          observaciones: editObs.trim() || null,
          updated_by: auditInfo.id,
        }),
      });
      toast.ok('Actualizado', 'Registro actualizado.');
      setEditingRow(null);
      await loadAll();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setEditSaving(false); }
  };

  // ── Stats ──
  const enAlertaRows = rows.filter(r => enAlerta(r));
  const pendientesTramite = rows.filter(r => !r.tramite_realizado && !r.deleted_at);
  const tramitesRealizados = rows.filter(r => r.tramite_realizado);

  // ── Filtro historial ──
  const [filtroNombre, setFiltroNombre] = useState('');
  const [filtroAlerta, setFiltroAlerta] = useState('');

  const rowsFiltrados = useMemo(() => {
    return rows.filter(r => {
      const nombre = r.apellido ? `${r.apellido} ${r.nombre}`.toLowerCase() : '';
      if (filtroNombre && !nombre.includes(filtroNombre.toLowerCase()) && !String(r.dni).includes(filtroNombre)) return false;
      if (filtroAlerta === 'alerta' && !enAlerta(r)) return false;
      if (filtroAlerta === 'avisada' && !r.alerta_45_avisada) return false;
      if (filtroAlerta === 'tramite' && !r.tramite_realizado) return false;
      if (filtroAlerta === 'pendiente' && r.tramite_realizado) return false;
      return true;
    });
  }, [rows, filtroNombre, filtroAlerta]);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <Layout title="👶 Guardería y Salario" showBack>

      {/* Banner alerta inline */}
      {enAlertaRows.length > 0 && (
        <div style={{ margin: '0 0 16px 0', padding: '12px 16px', background: 'rgba(234,179,8,0.12)', border: '2px solid rgba(234,179,8,0.5)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: '#eab308', marginBottom: 6 }}>
            ⚠️ {enAlertaRows.length} agente{enAlertaRows.length > 1 ? 's' : ''} con trámite de guardería pendiente de aviso
          </div>
          {enAlertaRows.map(r => {
            const dias = diasDesde(r.fecha_nacimiento);
            return (
              <div key={r.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{r.apellido ? `${r.apellido}, ${r.nombre}` : `DNI ${r.dni}`}</span>
                <span className="muted">·</span>
                <span>Nacimiento: {fmt(r.fecha_nacimiento)}</span>
                <span style={{ background: dias > 60 ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.25)', color: dias > 60 ? '#ef4444' : '#eab308', borderRadius: 6, padding: '1px 8px', fontSize: '0.77rem', fontWeight: 700 }}>
                  {dias}d desde nacimiento{dias > 60 ? ' — trámite demorado' : ''}
                </span>
                {r.ley_nombre && <span className="muted" style={{ fontSize: '0.78rem' }}>{r.ley_nombre}</span>}
                <button className="btn" type="button"
                  style={{ fontSize: '0.72rem', padding: '2px 8px', background: 'rgba(234,179,8,0.2)', color: '#eab308' }}
                  onClick={() => handleMarcarAvisada(r)} disabled={markingId === r.id}>
                  {markingId === r.id ? '...' : '✓ Marcar avisada'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Embarazadas no becarias sin guardería registrada */}
      {embarazadasPendientes.length > 0 && (
        <div style={{ margin: '0 0 16px 0', padding: '12px 16px', background: 'rgba(139,92,246,0.1)', border: '2px solid rgba(139,92,246,0.4)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 6 }}>
            🤰 {embarazadasPendientes.length} embarazada{embarazadasPendientes.length > 1 ? 's' : ''} nombrada{embarazadasPendientes.length > 1 ? 's' : ''} sin registro de guardería
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {embarazadasPendientes.map(e => {
              const hoy = new Date(); hoy.setHours(0,0,0,0);
              const [y, m, d] = e.fecha_probable_parto?.slice(0,10).split('-').map(Number) ?? [0,0,0];
              const diasFpp = e.fecha_probable_parto
                ? Math.round((new Date(y,m-1,d).getTime() - hoy.getTime()) / (1000*60*60*24))
                : null;
              return (
                <div key={e.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{e.apellido ? `${e.apellido}, ${e.nombre}` : `DNI ${e.dni}`}</span>
                  <span className="muted">·</span>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>DNI {e.dni}</span>
                  {e.ley_nombre && <span className="muted" style={{ fontSize: '0.78rem' }}>{e.ley_nombre}</span>}
                  {diasFpp !== null && (
                    <span style={{
                      background: diasFpp < 0 ? 'rgba(239,68,68,0.2)' : 'rgba(139,92,246,0.2)',
                      color: diasFpp < 0 ? '#f87171' : '#a78bfa',
                      borderRadius: 6, padding: '1px 8px', fontSize: '0.77rem', fontWeight: 700,
                    }}>
                      FPP: {fmt(e.fecha_probable_parto)} {diasFpp < 0 ? `(hace ${Math.abs(diasFpp)}d)` : `(en ${diasFpp}d)`}
                    </span>
                  )}
                  <button className="btn" type="button"
                    style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(139,92,246,0.2)', color: '#a78bfa' }}
                    onClick={() => { search.loadByDni(e.dni); setTab('cargar'); }}>
                    ➕ Cargar guardería
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: '0.75rem' }} className="muted">
            Estas agentes tienen embarazo registrado pero aún no tienen trámite de guardería cargado.
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pendientes de trámite', val: pendientesTramite.length, color: '#14b8a6' },
          { label: 'Con aviso pendiente', val: enAlertaRows.length, color: '#eab308' },
          { label: 'Trámite realizado', val: tramitesRealizados.length, color: '#10b981' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{val}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
        {([
          { key: 'cargar', label: '➕ Cargar registro' },
          { key: 'historial', label: `📋 Historial${loading ? '' : ` (${rowsFiltrados.length})`}` },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: '0.9rem', fontWeight: tab === t.key ? 700 : 400, color: tab === t.key ? '#818cf8' : 'rgba(255,255,255,0.5)', borderBottom: tab === t.key ? '2px solid #818cf8' : '2px solid transparent', marginBottom: -2, transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: CARGAR ── */}
      {tab === 'cargar' && (
        <>
          {/* Búsqueda agente */}
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
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.82rem' }}>DNI {m.dni}{m.ley_nombre ? ` · ${m.ley_nombre}` : ''}</span>
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
                    {search.row.ley_nombre && <> · <span style={{ color: esNombrada(search.row.ley_nombre) ? '#10b981' : '#f87171' }}>{search.row.ley_nombre}</span></>}
                    {editingId && <span style={{ marginLeft: 8, color: '#f59e0b' }}>● Ya tiene registro — editando</span>}
                  </div>
                  {!esNombrada(search.row.ley_nombre) && (
                    <div style={{ marginTop: 4, fontSize: '0.8rem', color: '#f87171' }}>
                      ⚠️ Agente becaria — no requiere trámite de guardería/salario
                    </div>
                  )}
                </div>
                <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={search.clear}>✕ Limpiar</button>
              </div>
            )}
          </div>

          {/* Formulario */}
          {canCrud('guarderia', 'create') && (
            <div className="card">
              <div className="h2" style={{ marginBottom: 10 }}>
                {editingId ? '✏️ Editar registro' : '➕ Nuevo registro'}
                {search.row && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {search.row.apellido}, {search.row.nombre}</span>}
              </div>
              {!search.row && (
                <div style={alertStyle}>⚠️ Buscá y seleccioná un agente antes de cargar.</div>
              )}
              <form onSubmit={handleSave}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={fg}>
                    <label style={lbl}>Fecha de nacimiento *</label>
                    <input className="input" type="date" value={fechaNacimiento} onChange={e => setFechaNacimiento(e.target.value)} />
                  </div>
                  <div style={fg}>
                    <label style={lbl}>Observaciones</label>
                    <input className="input" type="text" placeholder="Observaciones opcionales" value={observaciones} onChange={e => setObservaciones(e.target.value)} />
                  </div>
                </div>

                {fechaNacimiento && (() => {
                  const dias = diasDesde(fechaNacimiento);
                  const diasParaTramite = 45 - dias;
                  const color = dias >= 45 ? '#ef4444' : dias >= 30 ? '#eab308' : '#10b981';
                  return (
                    <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: '0.83rem', marginBottom: 12, background: `rgba(${dias >= 45 ? '239,68,68' : dias >= 30 ? '234,179,8' : '16,185,129'},0.1)`, border: `1px solid rgba(${dias >= 45 ? '239,68,68' : dias >= 30 ? '234,179,8' : '16,185,129'},0.25)`, color }}>
                      {dias >= 45
                        ? `⚠️ Han pasado ${dias} días — el trámite debió iniciarse el día 45`
                        : `✓ Nacimiento hace ${dias} días — trámite a los 45 días (en ${diasParaTramite} días)`
                      }
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" type="submit" disabled={saving || !search.row}>
                    {saving ? 'Guardando...' : (editingId ? 'Guardar cambios' : 'Guardar')}
                  </button>
                  {editingId && (
                    <button className="btn" type="button" onClick={() => { search.clear(); setEditingId(null); }} style={{ background: 'rgba(255,255,255,0.06)' }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </>
      )}

      {/* ── TAB: HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="card">
          {/* Filtros */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={fg}>
              <label style={lbl}>Buscar agente</label>
              <input className="input" placeholder="Apellido, nombre o DNI..." value={filtroNombre} onChange={e => setFiltroNombre(e.target.value)} />
            </div>
            <div style={fg}>
              <label style={lbl}>Estado</label>
              <select className="input" value={filtroAlerta} onChange={e => setFiltroAlerta(e.target.value)}>
                <option value="">— Todos —</option>
                <option value="alerta">⚠️ Con aviso pendiente</option>
                <option value="avisada">✓ Avisadas</option>
                <option value="tramite">✅ Trámite realizado</option>
                <option value="pendiente">🕐 Trámite pendiente</option>
              </select>
            </div>
          </div>
          {(filtroNombre || filtroAlerta) && (
            <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: '#818cf8' }}>{rowsFiltrados.length} de {rows.length} registros</span>
              <button className="btn" type="button"
                style={{ fontSize: '0.75rem', padding: '3px 10px', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                onClick={() => { setFiltroNombre(''); setFiltroAlerta(''); }}>
                ✕ Limpiar
              </button>
            </div>
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 14 }} />

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>DNI</th>
                  <th>Ley</th>
                  <th>Servicio</th>
                  <th>Nacimiento</th>
                  <th>Días</th>
                  <th>Aviso</th>
                  <th>Trámite</th>
                  <th>Obs.</th>
                  <th>Cargado por</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rowsFiltrados.map(r => {
                  const dias = diasDesde(r.fecha_nacimiento);
                  const colorDias = dias >= 45 ? '#ef4444' : dias >= 30 ? '#eab308' : undefined;
                  return (
                    <tr key={r.id} style={getRowStyle(r)}>
                      <td>{r.apellido ? `${r.apellido}, ${r.nombre}` : '—'}</td>
                      <td>{r.dni}</td>
                      <td style={{ fontSize: '0.78rem' }}>{r.ley_nombre ?? '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{r.servicio_nombre ?? '—'}</td>
                      <td>{fmt(r.fecha_nacimiento)}</td>
                      <td>
                        <span style={{ color: colorDias, fontWeight: colorDias ? 700 : undefined }}>{dias}d</span>
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {r.alerta_45_avisada
                          ? <span style={{ color: '#10b981' }}>✓ {fmt(r.alerta_45_fecha)}<br /><span className="muted" style={{ fontSize: '0.72rem' }}>{r.alerta_45_usuario_nombre ?? ''}</span></span>
                          : enAlerta(r)
                          ? <span style={{ color: '#eab308', fontWeight: 700 }}>⚠️ Pendiente</span>
                          : <span className="muted">—</span>
                        }
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {r.tramite_realizado
                          ? <span style={{ color: '#10b981' }}>✅ {fmt(r.tramite_fecha)}<br /><span className="muted" style={{ fontSize: '0.72rem' }}>{r.tramite_usuario_nombre ?? ''}</span></span>
                          : <span className="muted">Pendiente</span>
                        }
                      </td>
                      <td style={{ fontSize: '0.78rem', maxWidth: 120 }}>{r.observaciones ?? '—'}</td>
                      <td style={{ fontSize: '0.72rem' }} className="muted">
                        {r.created_by ? `ID ${r.created_by}` : '—'}
                        <br />{r.updated_by && r.updated_by !== r.created_by ? `Mod: ID ${r.updated_by}` : ''}
                        {r.deleted_by ? <span style={{ color: '#ef4444' }}><br />Elim: ID {r.deleted_by}</span> : ''}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {!r.alerta_45_avisada && enAlerta(r) && (
                            <button className="btn" type="button"
                              style={{ fontSize: '0.7rem', padding: '2px 7px', background: 'rgba(234,179,8,0.18)', color: '#eab308' }}
                              onClick={() => handleMarcarAvisada(r)} disabled={markingId === r.id}>
                              {markingId === r.id ? '...' : '✓ Avisar'}
                            </button>
                          )}
                          {!r.tramite_realizado && (
                            <button className="btn" type="button"
                              style={{ fontSize: '0.7rem', padding: '2px 7px', background: 'rgba(16,185,129,0.18)', color: '#10b981' }}
                              onClick={() => handleMarcarTramite(r)} disabled={tramiteId === r.id}>
                              {tramiteId === r.id ? '...' : '✅ Trámite OK'}
                            </button>
                          )}
                          <button className="btn" type="button"
                            style={{ fontSize: '0.7rem', padding: '2px 7px', background: 'rgba(99,102,241,0.18)', color: '#818cf8' }}
                            onClick={() => openEdit(r)}>
                            ✏️ Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rowsFiltrados.length && !loading && (
                  <tr><td colSpan={11} className="muted" style={{ padding: 12 }}>Sin registros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL EDICIÓN ── */}
      {editingRow && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#1e1e2e', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontWeight: 700 }}>
                Editar — {editingRow.apellido ? `${editingRow.apellido}, ${editingRow.nombre}` : `DNI ${editingRow.dni}`}
              </span>
              <button onClick={() => setEditingRow(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>✕</button>
            </div>
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={fg}>
                <label style={lbl}>Fecha de nacimiento</label>
                <input className="input" type="date" value={editFechaNac} onChange={e => setEditFechaNac(e.target.value)} required />
              </div>
              <div style={fg}>
                <label style={lbl}>Observaciones</label>
                <input className="input" type="text" value={editObs} onChange={e => setEditObs(e.target.value)} placeholder="Observaciones opcionales" />
              </div>
              <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: '0.77rem' }} className="muted">
                <div>Cargado por: {editingRow.created_by ? `ID ${editingRow.created_by}` : '—'}</div>
                <div>Última modificación: {editingRow.updated_by ? `ID ${editingRow.updated_by}` : '—'} · {fmt(editingRow.updated_at)}</div>
                {editingRow.alerta_45_avisada && <div>Avisado: {editingRow.alerta_45_usuario_nombre ?? '—'} · {fmt(editingRow.alerta_45_fecha)}</div>}
                {editingRow.tramite_realizado && <div>Trámite: {editingRow.tramite_usuario_nombre ?? '—'} · {fmt(editingRow.tramite_fecha)}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setEditingRow(null)} style={{ opacity: 0.7 }}>Cancelar</button>
                <button type="submit" className="btn" disabled={editSaving}>{editSaving ? 'Guardando...' : 'Guardar cambios'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </Layout>
  );
}

// ─── estilos ─────────────────────────────────────────────────────────────────

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' };
const alertStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fecaca', marginBottom: 12, fontSize: '0.85rem' };
