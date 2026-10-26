// src/pages/GestionPage/components/modals/ExpedientesModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../../../ui/toast';
import { apiFetch } from '../../../../api/http';
import { fetchRowsByDnis } from '../../hooks/useDnisRelacionados';
import { loadSession } from '../../../../auth/session';

interface Props {
  row: any;
  dnis?: string[];
  onClose: () => void;
  onCountChange: (n: number) => void;
  /** Dentro de otro modal (pestaña Expedientes de Documentos y Expedientes): sin overlay ni cabecera propia. */
  embedded?: boolean;
}

const ESTADOS = ['En trámite', 'Resuelto', 'Archivado', 'Pendiente'] as const;
const emptyForm = { numero: '', anio: '', caratula: '', fecha: '', estado: '' };

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(f);
}

// Año sugerido: el escrito dentro del número (EX-2026-..., EX-...-GDEBA-2026,
// 2910-1542/2016-0) o, si no hay, el de la fecha. Un número pelado no se toma.
export function anioDeExpediente(numero?: string | null, fecha?: string | null): string {
  const n = String(numero || '');
  if (/[^0-9\s]/.test(n)) {
    const m = n.match(/(?<!\d)(19|20)\d{2}(?!\d)/);
    if (m) return m[0];
  }
  const f = String(fecha || '').match(/^(\d{4})-/);
  return f ? f[1] : '';
}

// ─── Modal de expedientes (lista + alta/edición) ──────────────────────────────
export function ExpedientesModal({ row, dnis, onClose, onCountChange, embedded = false }: Props) {
  const toast = useToast();
  // DNIs a consultar: el del agente + los anteriores por cambio de DNI.
  const dnisConsulta = (dnis && dnis.length) ? dnis : (row?.dni ? [String(row.dni)] : []);

  const [expedientes, setExpedientes] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(false);

  const [modalForm, setModalForm] = useState(false);
  const [form,      setForm]      = useState(emptyForm);
  const [editExp,   setEditExp]   = useState<any | null>(null);
  const [saving,    setSaving]    = useState(false);

  const cargar = useCallback(async () => {
    if (!dnisConsulta.length) return;
    setLoading(true);
    try {
      const data = await fetchRowsByDnis('/expedientes', dnisConsulta, { extraQuery: 'sort=-fecha', limit: 200 });
      // Los importados no tienen fecha: ordenar por año y después por fecha.
      data.sort((a: any, b: any) =>
        (Number(b.anio) || 0) - (Number(a.anio) || 0)
        || String(b.fecha || '').localeCompare(String(a.fecha || '')));
      setExpedientes(data);
      onCountChange(data.length);
    } catch {
      setExpedientes([]);
    } finally {
      setLoading(false);
    }
  }, [dnisConsulta.join(',')]); // eslint-disable-line

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => { setEditExp(null); setForm(emptyForm); setModalForm(true); };
  const abrirEditar = (r: any) => {
    setEditExp(r);
    setForm({
      numero:   r.numero   || '',
      anio:     r.anio != null ? String(r.anio) : '',
      caratula: r.caratula || '',
      fecha:    r.fecha ? String(r.fecha).slice(0, 10) : '',
      estado:   r.estado   || '',
    });
    setModalForm(true);
  };

  const guardar = async () => {
    if (!form.numero.trim()) { toast.error('Requerido', 'El número de expediente es obligatorio'); return; }
    const anioTxt = form.anio.trim() || anioDeExpediente(form.numero, form.fecha);
    if (anioTxt && !/^(19|20)\d{2}$/.test(anioTxt)) { toast.error('Año inválido', 'Poné el año con 4 dígitos'); return; }
    const anio = anioTxt ? Number(anioTxt) : null;
    setSaving(true);
    try {
      if (editExp) {
        // En edición no tocamos created_by
        await apiFetch(`/expedientes/${editExp.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            numero:   form.numero.trim(),
            anio,
            caratula: form.caratula.trim() || null,
            fecha:    form.fecha || null,
            estado:   form.estado || null,
          }),
        });
        toast.ok('Actualizado', 'Expediente actualizado');
      } else {
        const s = loadSession();
        await apiFetch('/expedientes', {
          method: 'POST',
          body: JSON.stringify({
            dni:        row.dni,
            numero:     form.numero.trim(),
            anio,
            caratula:   form.caratula.trim() || null,
            fecha:      form.fecha || null,
            estado:     form.estado || null,
            created_by: (s?.user as any)?.id || null,
          }),
        });
        toast.ok('Guardado', 'Expediente cargado');
      }
      setModalForm(false);
      setEditExp(null);
      setForm(emptyForm);
      cargar();
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 };
  const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' };

  const lista = (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>🔄 Cargando…</div>
      ) : expedientes.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#475569', fontSize: '0.88rem' }}>
          Sin expedientes registrados para este agente
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expedientes.map((r: any) => (
            <div key={r.id} style={{
              padding: '11px 14px', borderRadius: 9,
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'monospace', color: '#e2e8f0' }}>
                  {r.numero || '—'}
                  {r.anio != null ? (
                    <span style={{
                      marginLeft: 8, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                      background: 'rgba(34,211,238,0.15)', color: '#67e8f9', border: '1px solid rgba(34,211,238,0.3)',
                      fontFamily: 'system-ui, sans-serif',
                    }}>Año {r.anio}</span>
                  ) : (
                    <span title="Sin año en el origen: cargalo con Editar" style={{
                      marginLeft: 8, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                      background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)',
                      fontFamily: 'system-ui, sans-serif',
                    }}>Sin año</span>
                  )}
                </span>
                {r.estado
                  ? <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                      background: 'rgba(124,58,237,0.2)', color: '#c4b5fd',
                      border: '1px solid rgba(124,58,237,0.3)',
                    }}>{r.estado}</span>
                  : <span style={{ fontSize: '0.68rem', color: '#475569' }}>Sin estado</span>}
              </div>
              {r.caratula && (
                <div style={{ fontSize: '0.84rem', color: '#cbd5e1', marginBottom: 6, lineHeight: 1.4 }}>
                  {r.caratula}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>📅 {fmtFecha(r.fecha)}</span>
                <button className="btn" type="button"
                  style={{ fontSize: '0.72rem', padding: '2px 10px' }}
                  onClick={() => abrirEditar(r)}
                >✏️ Editar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const formModal = (
    <>
      {/* ── Modal alta / edición ── */}
      {modalForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setModalForm(false)}>
          <div className="card gp-card-14 gp-modal-solido"
            style={{ maxWidth: 500, width: '100%', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}>
            <div className="row gp-row-between-center" style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: '0.95rem' }}>📁 {editExp ? 'Editar expediente' : 'Nuevo expediente'}</strong>
              <button className="btn" onClick={() => setModalForm(false)} type="button">✕</button>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 12 }}>
              {row.apellido}, {row.nombre} · DNI {row.dni}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="gp-exp-numero" style={labelStyle}>Número de expediente *</label>
                <input id="gp-exp-numero" name="numero" type="text" className="input"
                  style={{ ...fieldStyle, fontFamily: 'monospace' }}
                  value={form.numero}
                  onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                  placeholder="EX-23756257-GDEBA-2026"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="gp-exp-caratula" style={labelStyle}>Carátula</label>
                <input id="gp-exp-caratula" name="caratula" type="text" className="input" style={fieldStyle}
                  value={form.caratula}
                  onChange={e => setForm(f => ({ ...f, caratula: e.target.value }))}
                  placeholder="Descripción del expediente"
                />
              </div>
              <div>
                <label htmlFor="gp-exp-fecha" style={labelStyle}>Fecha</label>
                <input id="gp-exp-fecha" name="fecha" type="date" className="input" style={fieldStyle}
                  value={form.fecha}
                  onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="gp-exp-anio" style={labelStyle}>Año</label>
                <input id="gp-exp-anio" name="anio" type="text" inputMode="numeric" maxLength={4} className="input" style={fieldStyle}
                  value={form.anio}
                  onChange={e => setForm(f => ({ ...f, anio: e.target.value.replace(/\D/g, '') }))}
                  placeholder={anioDeExpediente(form.numero, form.fecha) || 'AAAA'}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="gp-exp-estado" style={labelStyle}>Estado</label>
                <select id="gp-exp-estado" name="estado" className="input" style={fieldStyle}
                  value={form.estado}
                  onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                  <option value="">— Sin estado —</option>
                  {ESTADOS.map(es => <option key={es} value={es}>{es}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => setModalForm(false)} disabled={saving}>Cancelar</button>
              <button className="btn" onClick={guardar} disabled={saving}
                style={{ background: 'rgba(124,58,237,0.28)', borderColor: 'rgba(124,58,237,0.5)', color: '#c4b5fd' }}>
                {saving ? '⏳ Guardando…' : editExp ? '💾 Actualizar' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="row gp-row-between-center" style={{ marginBottom: 10, flexShrink: 0 }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Expedientes cargados del agente</span>
          <button className="btn" type="button"
            style={{ padding: '3px 10px', fontSize: '0.78rem',
              background: 'rgba(124,58,237,0.18)', borderColor: 'rgba(124,58,237,0.35)', color: '#c4b5fd' }}
            onClick={abrirNuevo}
          >➕ Nuevo</button>
        </div>
        {lista}
        {formModal}
      </>
    );
  }

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
          className="card gp-card-14 gp-modal-solido"
          style={{ maxWidth: 680, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '1.25rem' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Cabecera */}
          <div className="row gp-row-between-center" style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ fontSize: '0.95rem' }}>📁 Expedientes</strong>
              {expedientes.length > 0 && (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700,
                  background: 'rgba(124,58,237,0.2)', color: '#c4b5fd',
                  border: '1px solid rgba(124,58,237,0.35)',
                  padding: '1px 8px', borderRadius: 99,
                }}>
                  {expedientes.length}
                </span>
              )}
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {row.apellido}, {row.nombre} · DNI {row.dni}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" type="button"
                style={{ padding: '3px 10px', fontSize: '0.78rem',
                  background: 'rgba(124,58,237,0.18)', borderColor: 'rgba(124,58,237,0.35)', color: '#c4b5fd' }}
                onClick={abrirNuevo}
              >➕ Nuevo</button>
              <button className="btn" type="button"
                style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                onClick={onClose}
              >✕ Cerrar</button>
            </div>
          </div>

          {lista}
        </div>
      </div>

      {formModal}
    </>
  );
}
