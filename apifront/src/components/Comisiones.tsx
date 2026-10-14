// src/components/Comisiones.tsx
// Pase a comisión / regreso (backend: /comisiones, tabla agentes_comisiones).
// Lo usan Gestión, Carga de Agente y la página Herramientas → Comisiones.
//   - PaseComisionModal:   pide acto, destino, fecha desde (y vencimiento opcional).
//                          El backend cierra el tramo ACTIVO y el servicio/sector con esa fecha.
//   - RegresoComisionModal: fecha de regreso + servicio (catálogo de la base, propone el
//                          de origen) + sector opcional. Abre un tramo ACTIVO nuevo.
//   - ComisionAgenteBanner: aviso en la ficha del agente con la comisión vigente.
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/http';
import { useToast } from '../ui/toast';
import { SearchableSelect } from '../pages/CargaAgentePage/components/SearchableSelect';

export const TIPOS_ACTO = ['RESOLUCION', 'DISPOSICION', 'DECRETO', 'NOTA', 'OTRO'] as const;

export type Comision = {
  id: number; dni: number; apellido: string; nombre: string; agente_id: number | null;
  tipo_acto: string | null; numero_acto: string; destino: string;
  fecha_desde: string; fecha_hasta: string | null; fecha_regreso: string | null;
  servicio_origen_id: number | null; servicio_origen: string | null;
  sector_origen_id: number | null; sector_origen: string | null;
  servicio_regreso_id: number | null; servicio_regreso: string | null;
  sector_regreso: string | null;
  observaciones: string | null; dias: number;
  estado: 'VIGENTE' | 'POR_VENCER' | 'VENCIDA' | 'FINALIZADA';
};

export const fmtFecha = (f?: string | null) => {
  const m = String(f ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const errMsg = (e: any) => e?.details?.error || e?.message || 'Error';

const labelStyle: React.CSSProperties = { fontSize: '0.7rem', color: '#94a3b8', marginBottom: 2, display: 'block' };
const fieldStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '0.86rem' };

function ModalShell({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 540, width: '100%', padding: '1.25rem', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.98rem' }}>{title}</strong>
          <button className="btn" type="button" onClick={onClose}>✕</button>
        </div>
        {subtitle && <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12 }}>{subtitle}</div>}
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>{footer}</div>
      </div>
    </div>
  );
}

// ─── Pase a comisión ──────────────────────────────────────────────────────────
export function PaseComisionModal({ dni, nombre, fechaInicial, agenteId, beforeSave, onClose, onDone }: {
  dni: number | string;
  nombre?: string;
  fechaInicial?: string;
  /** Solo para completar un tramo COMISION viejo sin datos. */
  agenteId?: number;
  /** Corre antes del pase (p.ej. guardar el resto del formulario mientras el tramo sigue ACTIVO). */
  beforeSave?: () => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    tipo_acto: 'RESOLUCION', numero_acto: '', destino: '',
    fecha_desde: fechaInicial || hoyIso(), fecha_hasta: '', observaciones: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const guardar = async () => {
    if (!f.numero_acto.trim()) return toast.error('Falta el número de acto');
    if (!f.destino.trim())     return toast.error('Falta el destino de la comisión');
    if (!f.fecha_desde)        return toast.error('Falta la fecha de inicio de la comisión');
    if (f.fecha_hasta && f.fecha_hasta < f.fecha_desde) return toast.error('El vencimiento es anterior al inicio');
    setSaving(true);
    try {
      if (beforeSave) await beforeSave();
      const res = await apiFetch<any>('/comisiones', {
        method: 'POST',
        body: JSON.stringify({
          dni: Number(dni),
          ...(agenteId ? { agente_id: agenteId } : {}),
          tipo_acto: f.tipo_acto || null,
          numero_acto: f.numero_acto.trim(),
          destino: f.destino.trim().toUpperCase(),
          fecha_desde: f.fecha_desde,
          fecha_hasta: f.fecha_hasta || null,
          observaciones: f.observaciones.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo registrar la comisión');
      toast.ok(agenteId ? '✅ Datos de la comisión cargados' : '✅ Agente pasado a comisión',
        agenteId ? `DNI ${dni}` : `Servicio y sector cerrados al ${fmtFecha(f.fecha_desde)}`);
      onDone();
    } catch (e: any) {
      toast.error('Error al registrar la comisión', errMsg(e));
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={agenteId ? '🧳 Completar datos de la comisión' : '🧳 Pase a comisión'}
      subtitle={`${nombre ? `${nombre} · ` : ''}DNI ${dni}`}
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn" type="button" disabled={saving} onClick={guardar}
          style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>
          {saving ? '⏳ Guardando…' : agenteId ? '💾 Guardar' : '🧳 Pasar a comisión'}
        </button>
      </>}
    >
      {!agenteId && (
        <div style={{ fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>
          Se cierra el cargo actual y su servicio/sector con la fecha de inicio. Al volver, se registra
          el regreso con su fecha y el servicio.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label htmlFor="com-tipo" style={labelStyle}>Tipo de acto</label>
          <select id="com-tipo" className="input" style={fieldStyle} value={f.tipo_acto}
            onChange={e => set('tipo_acto', e.target.value)}>
            {TIPOS_ACTO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="com-num" style={labelStyle}>Número de acto *</label>
          <input id="com-num" className="input" style={{ ...fieldStyle, fontFamily: 'monospace' }} value={f.numero_acto}
            placeholder="RESOL-2026-1234-GDEBA" onChange={e => set('numero_acto', e.target.value)} autoFocus />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="com-destino" style={labelStyle}>Destino *</label>
          <input id="com-destino" className="input" style={fieldStyle} value={f.destino}
            placeholder="Organismo / hospital / dependencia de destino" onChange={e => set('destino', e.target.value)} />
        </div>
        <div>
          <label htmlFor="com-desde" style={labelStyle}>En comisión desde *</label>
          <input id="com-desde" type="date" className="input" style={fieldStyle} value={f.fecha_desde}
            onChange={e => set('fecha_desde', e.target.value)} />
        </div>
        <div>
          <label htmlFor="com-hasta" style={labelStyle}>Vence (límite)</label>
          <input id="com-hasta" type="date" className="input" style={fieldStyle} value={f.fecha_hasta}
            onChange={e => set('fecha_hasta', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="com-obs" style={labelStyle}>Observaciones</label>
          <textarea id="com-obs" className="input" rows={2} style={{ ...fieldStyle, resize: 'vertical' }}
            value={f.observaciones} onChange={e => set('observaciones', e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Regreso de comisión ──────────────────────────────────────────────────────
type Opt = { id: string; nombre: string };

export function RegresoComisionModal({ comision, servicioSugerido, onClose, onDone }: {
  comision: Comision;
  /** Servicio a proponer si la comisión no tiene servicio de origen. */
  servicioSugerido?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [servicios, setServicios] = useState<Opt[]>([]);
  const [sectores, setSectores] = useState<Opt[]>([]);
  const [f, setF] = useState({
    fecha_regreso: hoyIso(),
    servicio_id: String(comision.servicio_origen_id ?? servicioSugerido ?? ''),
    sector_id: '',
    observaciones: '',
  });
  const [saving, setSaving] = useState(false);

  // Catálogo de servicios de la base (sin los ocultos).
  useEffect(() => {
    apiFetch<any>('/servicios?limit=2000')
      .then(res => {
        const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setServicios(raw.filter(s => !Number(s.oculto)).map(s => ({ id: String(s.id), nombre: String(s.nombre) })));
      })
      .catch(() => toast.error('No se pudieron cargar los servicios'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sectores del servicio elegido (propone el de origen si es el mismo servicio).
  useEffect(() => {
    setSectores([]);
    if (!f.servicio_id) return;
    apiFetch<any>(`/sectores?servicio_id=${f.servicio_id}&limit=500`)
      .then(res => {
        const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setSectores(raw.map(s => ({ id: String(s.id), nombre: String(s.nombre) })));
        if (String(comision.servicio_origen_id ?? '') === f.servicio_id && comision.sector_origen_id) {
          setF(p => ({ ...p, sector_id: p.sector_id || String(comision.sector_origen_id) }));
        }
      })
      .catch(() => {});
  }, [f.servicio_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    if (!f.fecha_regreso) return toast.error('Falta la fecha de regreso');
    if (f.fecha_regreso <= comision.fecha_desde) return toast.error('El regreso tiene que ser posterior al inicio de la comisión');
    if (!f.servicio_id) return toast.error('Elegí el servicio al que vuelve');
    setSaving(true);
    try {
      const res = await apiFetch<any>(`/comisiones/${comision.id}/regreso`, {
        method: 'POST',
        body: JSON.stringify({
          fecha_regreso: f.fecha_regreso,
          servicio_id: Number(f.servicio_id),
          sector_id: f.sector_id ? Number(f.sector_id) : null,
          observaciones: f.observaciones.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error(res?.error || 'No se pudo registrar el regreso');
      toast.ok('✅ Regreso registrado', res.message || `DNI ${comision.dni}`);
      onDone();
    } catch (e: any) {
      toast.error('Error al registrar el regreso', errMsg(e));
    } finally { setSaving(false); }
  };

  const origen = useMemo(() => comision.servicio_origen
    ? `${comision.servicio_origen}${comision.sector_origen ? ` / ${comision.sector_origen}` : ''}` : null, [comision]);

  return (
    <ModalShell
      title="↩ Regreso de comisión"
      subtitle={`${comision.apellido}, ${comision.nombre} · DNI ${comision.dni} · en ${comision.destino} desde ${fmtFecha(comision.fecha_desde)}`}
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn" type="button" disabled={saving} onClick={guardar}
          style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d' }}>
          {saving ? '⏳ Guardando…' : '↩ Registrar regreso'}
        </button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label htmlFor="com-regreso" style={labelStyle}>Fecha de regreso *</label>
          <input id="com-regreso" type="date" className="input" style={fieldStyle} value={f.fecha_regreso}
            onChange={e => setF(p => ({ ...p, fecha_regreso: e.target.value }))} />
        </div>
        <div style={{ fontSize: '0.74rem', color: '#64748b', alignSelf: 'end', paddingBottom: 6 }}>
          {origen ? <>Servicio anterior: <b style={{ color: '#cbd5e1' }}>{origen}</b></> : 'Sin servicio anterior registrado'}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Servicio al que vuelve *</label>
          <SearchableSelect value={f.servicio_id} options={servicios} placeholder="— elegí el servicio —"
            onChange={v => setF(p => ({ ...p, servicio_id: v, sector_id: '' }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Sector</label>
          <SearchableSelect value={f.sector_id} options={sectores} disabled={!f.servicio_id || !sectores.length}
            placeholder={f.servicio_id && !sectores.length ? '— el servicio no tiene sectores —' : '— sin sector —'}
            onChange={v => setF(p => ({ ...p, sector_id: v }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="com-reg-obs" style={labelStyle}>Observaciones</label>
          <textarea id="com-reg-obs" className="input" rows={2} style={{ ...fieldStyle, resize: 'vertical' }}
            value={f.observaciones} onChange={e => setF(p => ({ ...p, observaciones: e.target.value }))} />
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Aviso en la ficha del agente ─────────────────────────────────────────────
export function ComisionAgenteBanner({ dni, estadoEmpleo, onChanged }: {
  dni: number | string; estadoEmpleo?: string | null; onChanged: () => void;
}) {
  const [info, setInfo] = useState<{ vigente: Comision | null; ultimo_servicio: any } | null>(null);
  const [regreso, setRegreso] = useState(false);

  const cargar = () => {
    apiFetch<any>(`/comisiones/agente/${dni}`)
      .then(res => setInfo(res?.ok ? { vigente: res.vigente, ultimo_servicio: res.ultimo_servicio } : null))
      .catch(() => setInfo(null));
  };
  useEffect(() => { setInfo(null); if (dni) cargar(); }, [dni]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = info?.vigente;
  if (!c && estadoEmpleo !== 'COMISION') return null;

  const color = c?.estado === 'VENCIDA' ? '#f87171' : c?.estado === 'POR_VENCER' ? '#fbbf24' : '#60a5fa';
  return (
    <div className="card" style={{ marginTop: 8, padding: '10px 14px', border: `1px solid ${color}55`, background: `${color}14` }}>
      {c ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.84rem', lineHeight: 1.5 }}>
            <b style={{ color }}>🧳 En comisión</b> en <b>{c.destino}</b> desde {fmtFecha(c.fecha_desde)}
            {c.fecha_hasta && <> · vence {fmtFecha(c.fecha_hasta)}{c.estado === 'VENCIDA' ? ' (VENCIDA)' : ''}</>}
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {c.tipo_acto ? `${c.tipo_acto} ` : 'Acto '}{c.numero_acto}
              {c.servicio_origen && <> · venía de {c.servicio_origen}</>} · {c.dias} días
            </div>
          </div>
          <button className="btn" type="button" onClick={() => setRegreso(true)}
            style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d' }}>↩ Regreso de comisión</button>
        </div>
      ) : (
        <div style={{ fontSize: '0.82rem', color: '#fbbf24' }}>
          🧳 Figura en COMISION sin número de acto ni destino cargados. Completalos en Herramientas → Comisiones.
        </div>
      )}
      {regreso && c && (
        <RegresoComisionModal comision={c} servicioSugerido={info?.ultimo_servicio?.servicio_id ?? null}
          onClose={() => setRegreso(false)}
          onDone={() => { setRegreso(false); cargar(); onChanged(); }} />
      )}
    </div>
  );
}
