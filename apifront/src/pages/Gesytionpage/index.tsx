// src/pages/GestionPage/index.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../../utils/export';
import { loadSession } from '../../auth/session';

import { useAgenteSearch } from './hooks/useAgenteSearch';
import { useModules, type ModuleKey } from './hooks/useModules';
import { usePedidos } from './hooks/usePedidos';
import { useDocumentos } from './hooks/useDocumentos';
import { useCellModal } from './hooks/useCellModal';
import { useDebounce } from './hooks/useDebounce';

import { AgenteSearchForm } from './components/components/AgenteSearchForm';
import { AgenteInfoCard } from './components/components/AgenteInfoCard';
import { ModuleGrid } from './components/components/ModuleGrid';
import ModuleDetailView from './components/components/ModuleDetailView';
import { MatchesList } from './components/components/MatchesList';
import { FotoCredencialCard } from './components/components/FotoCredencialCard';
import { PedidoModal } from './components/modals/PedidoModal';
import { CellModal } from './components/modals/CellModal';
import { DocViewerModal } from './components/modals/DocViewerModal';
import { GestionDocumentPreview } from './components/components/GestionDocumentPreview';

import './styles/GestionPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDateTime(dt?: string | null) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dt; }
}

// ─── Modal de citaciones ──────────────────────────────────────────────────────
interface CitacionesModalProps {
  row: any;
  onClose: () => void;
  onCountChange: (n: number) => void;
}
function CitacionesModal({ row, onClose, onCountChange }: CitacionesModalProps) {
  const toast = useToast();

  const [citaciones,   setCitaciones]   = useState<any[]>([]);
  const [loadingCit,   setLoadingCit]   = useState(false);
  const [filtro,       setFiltro]       = useState<'todas'|'activas'|'cerradas'>('todas');

  const [modalNueva,   setModalNueva]   = useState(false);
  const [formNueva,    setFormNueva]    = useState({ motivo: '', fecha_citacion: '', citado_por: '' });
  const [savingNueva,  setSavingNueva]  = useState(false);

  const [citCerrar,    setCitCerrar]    = useState<any>(null);
  const [savingCerrar, setSavingCerrar] = useState(false);

  const cargar = useCallback(async () => {
    if (!row?.dni) return;
    setLoadingCit(true);
    try {
      const res = await apiFetch<any>(`/citaciones?dni=${row.dni}&limit=100&sort=-created_at`);
      const data = Array.isArray(res?.data) ? res.data : [];
      setCitaciones(data);
      onCountChange(data.filter((c: any) => c.citacion_activa).length);
    } catch {
      setCitaciones([]);
    } finally {
      setLoadingCit(false);
    }
  }, [row?.dni]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!modalNueva) return;
    const s = loadSession();
    const u: any = s?.user || {};
    setFormNueva({ motivo: '', fecha_citacion: '', citado_por: u?.email || u?.nombre || '' });
  }, [modalNueva]);

  const guardarNueva = async () => {
    if (!formNueva.motivo.trim()) { toast.error('Ingresá el motivo'); return; }
    if (!formNueva.fecha_citacion) { toast.error('Ingresá la fecha'); return; }
    setSavingNueva(true);
    try {
      await apiFetch<any>('/citaciones', {
        method: 'POST',
        body: JSON.stringify({
          dni: row.dni,
          motivo: formNueva.motivo.trim(),
          fecha_citacion: formNueva.fecha_citacion,
          citado_por: formNueva.citado_por.trim() || null,
          citacion_activa: 1,
        }),
      });
      toast.ok('Citación registrada');
      setModalNueva(false);
      cargar();
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    } finally {
      setSavingNueva(false);
    }
  };

  const cerrarCitacion = async () => {
    if (!citCerrar) return;
    setSavingCerrar(true);
    try {
      await apiFetch<any>(`/citaciones/${citCerrar.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ citacion_activa: 0, cierre_citacion: new Date().toISOString() }),
      });
      toast.ok('Citación cerrada');
      setCitCerrar(null);
      cargar();
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    } finally {
      setSavingCerrar(false);
    }
  };

  const imprimir = () => {
    const w = window.open('', '_blank', 'width=700,height=600');
    if (!w) return;
    const lista = filtradas.map((c: any) => `
      <div style="border:1px solid #ccc;border-radius:6px;padding:12px;margin-bottom:10px;${c.citacion_activa ? 'border-left:4px solid #ef4444' : ''}">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <strong style="color:${c.citacion_activa ? '#dc2626' : '#555'}">${c.citacion_activa ? '🟢 ACTIVA' : '⬜ CERRADA'}</strong>
          <span style="font-size:0.75rem;color:#888">#${c.id}</span>
        </div>
        <div style="font-size:0.95rem;font-weight:600;margin-bottom:6px">${c.motivo || '—'}</div>
        <div style="font-size:0.78rem;color:#555">
          📅 ${fmtDateTime(c.fecha_citacion)}
          ${c.citado_por ? ` &nbsp;·&nbsp; 👤 ${c.citado_por}` : ''}
          ${c.cierre_citacion ? ` &nbsp;·&nbsp; 🔒 Cerrada: ${fmtDateTime(c.cierre_citacion)}` : ''}
        </div>
      </div>
    `).join('');
    w.document.write(`
      <html><head><title>Citaciones — DNI ${row.dni}</title>
      <style>body{font-family:sans-serif;padding:20px;color:#111}h2{margin-bottom:4px}p{margin-top:0;color:#555;font-size:0.85rem}</style>
      </head><body>
      <h2>⚠️ Citaciones</h2>
      <p>${row.apellido}, ${row.nombre} &nbsp;·&nbsp; DNI ${row.dni}</p>
      <hr style="margin-bottom:14px">
      ${lista || '<p>Sin citaciones.</p>'}
      </body></html>
    `);
    w.document.close();
    w.print();
  };

  const totalActivas = citaciones.filter((c: any) => c.citacion_activa).length;
  const filtradas    = citaciones.filter((c: any) => {
    if (filtro === 'activas')  return c.citacion_activa;
    if (filtro === 'cerradas') return !c.citacion_activa;
    return true;
  });

  const labelStyle = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  return (
    <>
      {/* ── Overlay principal ── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }} onClick={onClose}>
        <div
          className="card gp-card-14"
          style={{ maxWidth: 680, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '1.25rem' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Cabecera */}
          <div className="row gp-row-between-center" style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ fontSize: '0.95rem' }}>⚠️ Citaciones</strong>
              {totalActivas > 0 && (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700,
                  background: 'rgba(239,68,68,0.18)', color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.3)',
                  padding: '1px 8px', borderRadius: 99,
                }}>
                  {totalActivas} activa{totalActivas > 1 ? 's' : ''}
                </span>
              )}
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {row.apellido}, {row.nombre} · DNI {row.dni}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" type="button"
                style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                onClick={imprimir}
              >🖨 Imprimir</button>
              <button className="btn" type="button"
                style={{ padding: '3px 10px', fontSize: '0.78rem',
                  background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}
                onClick={() => setModalNueva(true)}
              >➕ Nueva</button>
              <button className="btn" type="button"
                style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                onClick={onClose}
              >✕ Cerrar</button>
            </div>
          </div>

          {/* Filtros */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexShrink: 0 }}>
            {(['todas', 'activas', 'cerradas'] as const).map(f => (
              <button key={f} type="button"
                style={{
                  fontSize: '0.72rem', padding: '3px 10px', borderRadius: 7, cursor: 'pointer',
                  border: `1px solid ${filtro === f ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                  background: filtro === f ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                  color: filtro === f ? '#c7d2fe' : '#94a3b8',
                  fontWeight: filtro === f ? 600 : 400,
                }}
                onClick={() => setFiltro(f)}
              >
                {f === 'todas' ? `Todas (${citaciones.length})` : f === 'activas' ? `🟢 Activas (${totalActivas})` : `⬜ Cerradas (${citaciones.length - totalActivas})`}
              </button>
            ))}
          </div>

          {/* Lista */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loadingCit ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>🔄 Cargando…</div>
            ) : filtradas.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#475569', fontSize: '0.88rem' }}>
                {citaciones.length === 0 ? 'Sin citaciones registradas para este agente' : 'Sin resultados en este filtro'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtradas.map((c: any) => (
                  <div key={c.id} style={{
                    padding: '11px 14px', borderRadius: 9,
                    border: `1px solid ${c.citacion_activa ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    background: c.citacion_activa ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                        background: c.citacion_activa ? 'rgba(239,68,68,0.18)' : 'rgba(100,116,139,0.15)',
                        color: c.citacion_activa ? '#fca5a5' : '#94a3b8',
                        border: `1px solid ${c.citacion_activa ? 'rgba(239,68,68,0.3)' : 'rgba(100,116,139,0.2)'}`,
                      }}>
                        {c.citacion_activa ? '🟢 ACTIVA' : '⬜ CERRADA'}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: '#475569', fontFamily: 'monospace' }}>#{c.id}</span>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#e2e8f0', marginBottom: 6, lineHeight: 1.4 }}>
                      {c.motivo || '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', flexWrap: 'wrap' as const, gap: 10, marginBottom: c.citacion_activa ? 8 : 0 }}>
                      <span>📅 {fmtDateTime(c.fecha_citacion)}</span>
                      {c.citado_por && <span>👤 {c.citado_por}</span>}
                      {c.cierre_citacion && <span>🔒 Cerrada: {fmtDateTime(c.cierre_citacion)}</span>}
                    </div>
                    {c.citacion_activa && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn" type="button"
                          style={{
                            fontSize: '0.72rem', padding: '2px 10px',
                            background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.25)', color: '#fca5a5',
                          }}
                          onClick={() => setCitCerrar(c)}
                        >🔒 Cerrar citación</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal nueva citación ── */}
      {modalNueva && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setModalNueva(false)}>
          <div className="card gp-card-14"
            style={{ maxWidth: 500, width: '100%', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}>
            <div className="row gp-row-between-center" style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: '0.95rem' }}>⚠️ Nueva Citación</strong>
              <button className="btn" onClick={() => setModalNueva(false)} type="button">✕</button>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 12 }}>
              {row.apellido}, {row.nombre} · DNI {row.dni}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={labelStyle}>Motivo *</div>
                <textarea className="input" rows={3} style={fieldStyle}
                  value={formNueva.motivo}
                  onChange={e => setFormNueva(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Describí el motivo de la citación…"
                />
              </div>
              <div>
                <div style={labelStyle}>Fecha de citación *</div>
                <input type="datetime-local" className="input" style={fieldStyle}
                  value={formNueva.fecha_citacion}
                  onChange={e => setFormNueva(f => ({ ...f, fecha_citacion: e.target.value }))}
                />
              </div>
              <div>
                <div style={labelStyle}>Citado por</div>
                <input type="text" className="input" style={fieldStyle}
                  value={formNueva.citado_por}
                  onChange={e => setFormNueva(f => ({ ...f, citado_por: e.target.value }))}
                  placeholder="Nombre / área"
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => setModalNueva(false)} disabled={savingNueva}>Cancelar</button>
              <button className="btn" onClick={guardarNueva} disabled={savingNueva}
                style={{ background: 'rgba(99,102,241,0.28)', borderColor: 'rgba(99,102,241,0.5)', color: '#c7d2fe' }}>
                {savingNueva ? '⏳ Guardando…' : '💾 Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal cerrar citación ── */}
      {citCerrar && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setCitCerrar(null)}>
          <div className="card gp-card-14"
            style={{ maxWidth: 420, width: '100%', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}>
            <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: 12 }}>🔒 Cerrar Citación</strong>
            <div style={{ fontSize: '0.84rem', marginBottom: 6 }}><b>Motivo:</b> {citCerrar.motivo}</div>
            <div style={{ fontSize: '0.84rem', marginBottom: 6 }}><b>Fecha:</b> {fmtDateTime(citCerrar.fecha_citacion)}</div>
            <div style={{ fontSize: '0.84rem', marginBottom: 14 }}><b>Citado por:</b> {citCerrar.citado_por || '—'}</div>
            <div style={{
              padding: '10px 12px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8, fontSize: '0.82rem', color: '#fca5a5', marginBottom: 14,
            }}>
              ¿Confirmás que esta citación fue atendida y querés cerrarla?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setCitCerrar(null)} disabled={savingCerrar}>Cancelar</button>
              <button className="btn" onClick={cerrarCitacion} disabled={savingCerrar}
                style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                {savingCerrar ? '⏳…' : '🔒 Cerrar Citación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Panel edición inline ──────────────────────────────────────────────────────
const CATALOG_DEFS = [
  { key: 'sexo_id',            label: 'SEXO',            endpoint: '/sexos',              nombreField: 'nombre' },
  { key: 'localidad_id',       label: 'LOCALIDAD',       endpoint: '/localidades',         nombreField: 'localidad_nombre' },
  { key: 'ley_id',             label: 'LEY',             endpoint: '/ley',                nombreField: 'nombre' },
  { key: 'planta_id',          label: 'PLANTA',          endpoint: '/plantas',            nombreField: 'nombre' },
  { key: 'categoria_id',       label: 'CATEGORÍA',       endpoint: '/categorias',         nombreField: 'nombre' },
  { key: 'funcion_id',         label: 'FUNCIÓN',         endpoint: '/funciones',          nombreField: 'nombre' },
  { key: 'ocupacion_id',       label: 'OCUPACIÓN',       endpoint: '/ocupaciones',        nombreField: 'nombre' },
  { key: 'regimen_horario_id', label: 'RÉGIMEN HORARIO', endpoint: '/regimenes_horarios', nombreField: 'nombre' },
  { key: 'dependencia_id',     label: 'DEPENDENCIA',     endpoint: '/dependencias',       nombreField: 'nombre' },
  { key: 'sector_id',          label: 'SECTOR/REPART.',  endpoint: '/reparticiones',      nombreField: 'reparticion_nombre' },
] as const;

const PATCH_PERSONAL_COLS = [
  'apellido','nombre','cuil','fecha_nacimiento','sexo_id',
  'email','telefono','domicilio','numerodomicilio','depto','piso',
  'observacionesdireccion','cp','localidad_id','nacionalidad','observaciones',
];
const PATCH_AGENTE_COLS = [
  'ley_id','planta_id','categoria_id','funcion_id','ocupacion_id',
  'regimen_horario_id','sector_id','dependencia_id','fecha_ingreso','fecha_egreso',
  'legajo','salario_mensual','estado_empleo',
];
const ALL_PATCH_COLS = [...PATCH_PERSONAL_COLS, ...PATCH_AGENTE_COLS];

function AgenteEditPanel({ row, onSaved }: { row: any; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, { id: number | string; label: string }[]>>({});
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  useEffect(() => {
    if (!expanded || Object.keys(catalogs).length > 0) return;
    setLoadingCatalogs(true);
    Promise.all(
      CATALOG_DEFS.map(cf =>
        apiFetch<any>(`${cf.endpoint}?limit=2000`)
          .then(res => {
            let raw: any[] = [];
            if (Array.isArray(res)) raw = res;
            else if (Array.isArray(res?.data)) raw = res.data;
            else if (Array.isArray(res?.rows)) raw = res.rows;
            const nombreField = (cf as any).nombreField;
            const items = raw
              .map((o: any) => {
                const id = o.id ?? o.ID;
                const labelVal = o[nombreField] ?? o.nombre ?? o.ID ?? id;
                const label = labelVal != null ? String(labelVal) : '';
                return { id, label };
              })
              .filter(o => o.id != null && o.label !== '');
            return { key: cf.key, items };
          })
          .catch(() => ({ key: cf.key, items: [] }))
      )
    ).then(results => {
      const map: Record<string, { id: number | string; label: string }[]> = {};
      results.forEach(r => { map[r.key] = r.items; });
      setCatalogs(map);
    }).finally(() => setLoadingCatalogs(false));
  }, [expanded]);

  useEffect(() => {
    if (!row) return;
    const f: any = { ...row };
    for (const k of ['fecha_nacimiento','fecha_ingreso','fecha_egreso']) {
      if (f[k] && String(f[k]).length > 10) f[k] = String(f[k]).slice(0, 10);
    }
    setForm(f);
  }, [row?.dni]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {};
      const INT_FIELDS    = new Set(['numerodomicilio','piso','legajo']);
      const FLOAT_FIELDS  = new Set(['salario_mensual']);
      const SKIP_IF_EMPTY = new Set(['cuil','apellido','nombre']);
      ALL_PATCH_COLS.forEach(k => {
        if (form[k] === undefined) return;
        const v = form[k];
        if (SKIP_IF_EMPTY.has(k)) { if (v === '' || v === null) return; payload[k] = v; return; }
        if (k.endsWith('_id') || INT_FIELDS.has(k)) {
          payload[k] = (v === '' || v === null) ? null : Number(v) || null;
        } else if (FLOAT_FIELDS.has(k)) {
          payload[k] = (v === '' || v === null) ? null : parseFloat(v) || null;
        } else {
          payload[k] = v === '' ? null : v;
        }
      });
      await apiFetch<any>(`/personal/${row.dni}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.ok('Agente actualizado correctamente');
      onSaved();
    } catch (e: any) {
      const details = e?.details;
      let msg = e?.message || 'Error desconocido';
      const fieldErrors = details?.details?.fieldErrors || details?.fieldErrors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const parts: string[] = [];
        for (const [campo, errores] of Object.entries(fieldErrors)) {
          const errs = Array.isArray(errores) ? (errores as string[]).join(', ') : String(errores);
          parts.push(`${campo}: ${errs}`);
        }
        if (parts.length) msg = parts.join('\n');
      }
      toast.error('Error al guardar', msg);
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  const fieldStyle  = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };
  const labelStyle  = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const sectionStyle = { fontSize: '0.72rem', color: '#64748b', fontWeight: 600 as const, margin: '10px 0 4px' };

  const renderCatalogSelect = (key: string, label: string) => {
    const options = catalogs[key] || [];
    const currentVal = form[key] ?? '';
    return (
      <div key={key}>
        <div style={labelStyle}>{label}</div>
        <select className="input" value={String(currentVal)} style={fieldStyle}
          onChange={e => set(key, e.target.value)}>
          <option value="">— sin asignar —</option>
          {options.map(o => (
            <option key={o.id} value={String(o.id)}>{o.label}</option>
          ))}
          {currentVal !== '' && !options.find(o => String(o.id) === String(currentVal)) && (
            <option value={String(currentVal)}>ID: {currentVal} (no encontrado)</option>
          )}
        </select>
      </div>
    );
  };

  const renderText = (key: string, label: string, type = 'text') => (
    <div key={key}>
      <div style={labelStyle}>{label}</div>
      <input className="input" type={type} value={form[key] ?? ''} style={fieldStyle}
        onChange={e => set(key, e.target.value)} />
    </div>
  );

  return (
    <div className="card gp-card-14" style={{ marginTop: 8 }}>
      <div className="row gp-row-between-center" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: '0.88rem' }}>✏️ Editar datos del agente</strong>
        <button className="btn" type="button"
          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
          onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲ Cerrar' : '▼ Ver todos los campos'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <div>
          <div style={labelStyle}>APELLIDO</div>
          <input className="input" value={form.apellido || ''} style={fieldStyle}
            onChange={e => set('apellido', e.target.value.toUpperCase())} />
        </div>
        <div>
          <div style={labelStyle}>NOMBRE</div>
          <input className="input" value={form.nombre || ''} style={fieldStyle}
            onChange={e => set('nombre', e.target.value.toUpperCase())} />
        </div>
        <div>
          <div style={labelStyle}>CUIL</div>
          <input className="input" value={form.cuil || ''} style={fieldStyle}
            onChange={e => set('cuil', e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>EMAIL</div>
          <input className="input" type="email" value={form.email || ''} style={fieldStyle}
            onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loadingCatalogs && (
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 6 }}>⏳ Cargando catálogos…</div>
          )}
          <div style={sectionStyle}>— DATOS PERSONALES —</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {renderText('telefono', 'TELÉFONO')}
            {renderText('fecha_nacimiento', 'F. NACIMIENTO', 'date')}
            {renderCatalogSelect('sexo_id', 'SEXO')}
            {renderText('nacionalidad', 'NACIONALIDAD')}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>CALLE (DOMICILIO)</div>
              <input className="input" value={form.domicilio || ''} style={fieldStyle}
                onChange={e => set('domicilio', e.target.value)} />
            </div>
            {renderText('numerodomicilio', 'NRO. DOMICILIO')}
            {renderText('piso', 'PISO')}
            {renderText('depto', 'DEPTO')}
            {renderText('cp', 'CÓDIGO POSTAL')}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>OBS. DIRECCIÓN</div>
              <input className="input" value={form.observacionesdireccion || ''} style={fieldStyle}
                onChange={e => set('observacionesdireccion', e.target.value)} />
            </div>
            {renderCatalogSelect('localidad_id', 'LOCALIDAD')}
            <div>
              <div style={labelStyle}>ESTADO EMPLEO</div>
              <select className="input" value={form.estado_empleo || ''} style={fieldStyle}
                onChange={e => set('estado_empleo', e.target.value)}>
                <option value="">— sin asignar —</option>
                <option value="ACTIVO">ACTIVO</option>
                <option value="INACTIVO">INACTIVO</option>
                <option value="BAJA">BAJA</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelStyle}>OBSERVACIONES</div>
              <textarea className="input" value={form.observaciones || ''} rows={2}
                style={{ ...fieldStyle, resize: 'vertical' }}
                onChange={e => set('observaciones', e.target.value)} />
            </div>
          </div>
          <div style={sectionStyle}>— DATOS LABORALES —</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {renderCatalogSelect('ley_id', 'LEY')}
            {renderCatalogSelect('planta_id', 'PLANTA')}
            {renderCatalogSelect('categoria_id', 'CATEGORÍA')}
            {renderCatalogSelect('funcion_id', 'FUNCIÓN')}
            {renderCatalogSelect('ocupacion_id', 'OCUPACIÓN')}
            {renderCatalogSelect('regimen_horario_id', 'RÉGIMEN HORARIO')}
            {renderCatalogSelect('dependencia_id', 'DEPENDENCIA')}
            {renderCatalogSelect('sector_id', 'SECTOR / REPARTICIÓN')}
            {renderText('fecha_ingreso', 'F. INGRESO', 'date')}
            {renderText('fecha_egreso', 'F. EGRESO', 'date')}
            {renderText('legajo', 'LEGAJO')}
            {renderText('salario_mensual', 'SALARIO MENSUAL')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
        {expanded && (
          <button className="btn" type="button" onClick={() => setForm({ ...row })}
            style={{ fontSize: '0.8rem' }}>↩ Revertir</button>
        )}
        <button className="btn" type="button" disabled={saving} onClick={save}
          style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>
          {saving ? '⏳ Guardando…' : '💾 Guardar'}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export function GestionPage() {
  const toast = useToast();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('personal:write') || hasPerm('crud:*:*') || hasPerm('crud:personal:update');

  const agenteSearch = useAgenteSearch();
  const debouncedDni = useDebounce(agenteSearch.dni, 500);

  const { modules, loadModule, closeModule, setSelectedIndex, setTablePage, setTablePageSize, getSelectedRow } =
    useModules(agenteSearch.cleanDni);

  const pedidos    = usePedidos(agenteSearch.cleanDni, modules.pedidos);
  const documentos = useDocumentos(agenteSearch.cleanDni);
  const cellModal  = useCellModal(toast);

  const [matches, setMatches] = useState<any[]>([]);
  const [row,     setRow]     = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Citaciones
  const [modalCitaciones,   setModalCitaciones]   = useState(false);
  const [citacionesActivas, setCitacionesActivas] = useState(0);

  useEffect(() => { setRow(agenteSearch.row); }, [agenteSearch.row]);
  useEffect(() => { setLoading(agenteSearch.loading); }, [agenteSearch.loading]);

  // Reset citaciones al cambiar agente
  useEffect(() => {
    setCitacionesActivas(0);
    setModalCitaciones(false);
    if (!agenteSearch.cleanDni) return;
    apiFetch<any>(`/citaciones?dni=${agenteSearch.cleanDni}&citacion_activa=1&limit=100`)
      .then(r => setCitacionesActivas(Array.isArray(r?.data) ? r.data.length : 0))
      .catch(() => setCitacionesActivas(0));
  }, [agenteSearch.cleanDni]);

  useEffect(() => {
    const dni = agenteSearch.cleanDni;
    if (!dni) { documentos.revokeLastObjectUrl?.(); return; }
    documentos.fetchFotoPrivada?.(dni).catch(() => {});
  }, [agenteSearch.cleanDni]);

  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d && d.replace(/\D/g, '').length >= 7) agenteSearch.onSearch();
  }, [debouncedDni]);

  const onSearch = () => agenteSearch.onSearch();

  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
      documentos.revokeLastObjectUrl?.();
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=30&page=1`);
      const lista = res?.data || [];
      setMatches(lista);
      if (!lista.length) toast.error('Sin resultados', `No hay agentes que coincidan con "${q}"`);
      else toast.ok(`${lista.length} resultado(s)`, 'Clic para cargar agente');
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const loadByDni = useCallback((dni: string) => {
    const clean = String(dni).replace(/\D/g, '');
    agenteSearch.setDni(clean);
    setMatches([]);
    Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
    setTimeout(() => agenteSearch.onSearch(), 20);
  }, [agenteSearch, modules, closeModule]);

  const onAgenteEdited = useCallback(() => {
    agenteSearch.onSearch();
    const openModules = (Object.keys(modules) as ModuleKey[]).filter(k => modules[k].open);
    openModules.forEach(k => loadModule(k, { forceReload: true }));
  }, [agenteSearch, modules, loadModule]);

  const getModuleTitle = (k: ModuleKey) =>
    k === 'pedidos' ? 'Pedidos' : k === 'documentos' ? 'Documentos' : 'Consultas';

  const getModuleCols = (key: ModuleKey, rows: any[]) => {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const preferred: Record<ModuleKey, string[]> = {
      consultas:  ['id','dni','motivo_consulta','explicacion','created_at'],
      pedidos:    ['id','dni','pedido','estado','lugar','fecha','observacion','created_at'],
      documentos: ['id','nombre','tipo','numero','fecha','descripcion_archivo','nombre_archivo_original'],
    };
    const pref = preferred[key] || [];
    const out: string[] = [];
    for (const p of pref) if (cols.includes(p)) out.push(p);
    for (const c of cols) if (!out.includes(c) && !['ruta','deleted_at'].includes(c)) out.push(c);
    return out;
  };

  const renderExportActions = (key: ModuleKey) => {
    const st   = modules[key];
    const title = `${getModuleTitle(key)} (DNI ${agenteSearch.cleanDni})`;
    const file  = `${key}_dni_${agenteSearch.cleanDni}`;
    return (
      <div className="row gp-export-actions">
        <button className="btn" onClick={() => printTable(title, st.rows)} disabled={!st.rows.length}>🖨 Imprimir</button>
        {key === 'pedidos' && (
          <button className="btn" onClick={() => documentos.openCertificadoIoma?.()} disabled={!agenteSearch.cleanDni}>
            Cert. IOMA
          </button>
        )}
        <button className="btn" onClick={() => exportToExcel(`${file}.xlsx`, st.rows)} disabled={!st.rows.length}>Excel</button>
        <button className="btn" onClick={() => exportToPdf(`${file}.pdf`, st.rows)} disabled={!st.rows.length}>PDF</button>
        <button className="btn" onClick={() => exportToWord(`${file}.docx`, st.rows)} disabled={!st.rows.length}>Word</button>
      </div>
    );
  };

  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">

        <div className="gp-topgrid">

          {/* IZQUIERDA */}
          <div className="gp-col gp-left">
            <AgenteSearchForm
              dni={agenteSearch.dni}
              fullName={agenteSearch.fullName}
              loading={loading}
              onDniChange={e => agenteSearch.setDni(String(e.target.value))}
              onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
              onSearch={onSearch}
              onSearchByName={onSearchByName}
            />

            {loading && <div className="card gp-card-14">🔄 Cargando…</div>}

            {matches.length > 0 && (
              <MatchesList matches={matches} onSelect={loadByDni} />
            )}

            <AgenteInfoCard row={row} />

            {row?.dni && (
              <ModuleGrid
                modules={modules}
                cleanDni={agenteSearch.cleanDni}
                onToggleModule={loadModule}
                onOpenPedidoModal={pedidos.openPedidoModal}
                onCloseModule={closeModule}
                onOpenCitaciones={() => setModalCitaciones(true)}
                citacionesActivas={citacionesActivas}
              />
            )}
          </div>

          {/* DERECHA: foto + edición — sticky */}
          <div className="gp-col gp-right-panel">
            <FotoCredencialCard
              hasAgente={!!row?.dni}
              fotoUrl={documentos.fotoUrl}
            />
            {canEdit && row?.dni && (
              <AgenteEditPanel row={row} onSaved={onAgenteEdited} />
            )}
          </div>
        </div>

        {/* ── MÓDULOS ABIERTOS ── */}
        <div className="gp-bottomstack">
          {(['consultas', 'pedidos', 'documentos'] as ModuleKey[])
            .filter(k => modules[k].open)
            .map(k => {
              const st        = modules[k];
              const moduleCols = getModuleCols(k, st.rows);
              const pageSize   = st.tablePageSize || 50;
              const totalPages = Math.max(1, Math.ceil(st.rows.length / pageSize));
              const curPage    = Math.min(Math.max(st.tablePage || 1, 1), totalPages);
              const start      = (curPage - 1) * pageSize;
              const pageRows   = st.rows.slice(start, start + pageSize);
              return (
                <ModuleDetailView
                  key={k}
                  moduleKey={k}
                  moduleState={st}
                  moduleTitle={getModuleTitle(k)}
                  moduleCols={moduleCols}
                  selectedRow={getSelectedRow(k)}
                  selectedRowIdx={st.selectedIndex}
                  pageRows={pageRows}
                  start={start}
                  curPage={curPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  cleanDni={agenteSearch.cleanDni}
                  onClose={() => closeModule(k)}
                  onSetSelectedIndex={idx => setSelectedIndex(k, idx)}
                  onSetTablePage={page => setTablePage(k, page)}
                  onSetTablePageSize={size => setTablePageSize(k, size)}
                  onCellClick={(col, value, rowIndex) => cellModal.openCellModal(k, col, value, rowIndex)}
                  onOpenDoc={(route, row) => documentos.openDocViewer(route, row)}
                  onExport={() => renderExportActions(k)}
                  onRowSelect={idx => setSelectedIndex(k, idx)}
                  onPedidoAction={k === 'pedidos' ? {
                    onOpenPedidoModal: pedidos.openPedidoModal,
                    onIoma: pedidos.generarIomaSelected,
                    onCertificadoIoma: () => documentos.openCertificadoIoma?.(),
                    onMarcarPendiente: () => pedidos.marcarPedidoEstado('pendiente'),
                    onMarcarHecho: () => pedidos.marcarPedidoEstado('hecho'),
                    onBaja: pedidos.bajaPedidoSelected,
                    hasRows: !!st.rows.length
                  } : undefined}
                />
              );
            })}
        </div>
      </div>

      <PedidoModal
        open={pedidos.pedidoModal.open}
        data={pedidos.pedidoModal}
        cleanDni={agenteSearch.cleanDni}
        onChange={pedidos.setPedidoModal}
        onClose={pedidos.closePedidoModal}
        onSubmit={pedidos.createPedidosFromModal}
        getActor={() => {
          const s = loadSession();
          const u: any = s?.user || {};
          return u?.email || u?.id || 'anon';
        }}
      />
      <CellModal open={!!cellModal.cellModal} data={cellModal.cellModal}
        onClose={cellModal.closeCellModal} onCopy={cellModal.copyToClipboard} />
      <DocViewerModal open={documentos.docViewer.open} data={documentos.docViewer}
        onClose={documentos.closeDocViewer} previewComponent={GestionDocumentPreview} />

      {/* ── Modal citaciones ── */}
      {modalCitaciones && row && (
        <CitacionesModal
          row={row}
          onClose={() => setModalCitaciones(false)}
          onCountChange={n => setCitacionesActivas(n)}
        />
      )}
    </Layout>
  );
}
