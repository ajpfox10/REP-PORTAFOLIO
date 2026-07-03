// src/pages/GestionPage/components/modals/ExpedientesModal.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../../../ui/toast';
import { apiFetch } from '../../../../api/http';
import { loadSession } from '../../../../auth/session';

interface Props {
  row: any;
  onClose: () => void;
  onCountChange: (n: number) => void;
}

const ESTADOS = ['En trámite', 'Resuelto', 'Archivado', 'Pendiente'] as const;
const emptyForm = { numero: '', caratula: '', fecha: '', estado: '' };

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(f);
}

// ─── Modal de expedientes (lista + alta/edición) ──────────────────────────────
export function ExpedientesModal({ row, onClose, onCountChange }: Props) {
  const toast = useToast();

  const [expedientes, setExpedientes] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(false);

  const [modalForm, setModalForm] = useState(false);
  const [form,      setForm]      = useState(emptyForm);
  const [editExp,   setEditExp]   = useState<any | null>(null);
  const [saving,    setSaving]    = useState(false);

  const cargar = useCallback(async () => {
    if (!row?.dni) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/expedientes?dni=${row.dni}&limit=200&sort=-fecha`);
      const data = Array.isArray(res?.data) ? res.data : [];
      setExpedientes(data);
      onCountChange(data.length);
    } catch {
      setExpedientes([]);
    } finally {
      setLoading(false);
    }
  }, [row?.dni]); // eslint-disable-line

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => { setEditExp(null); setForm(emptyForm); setModalForm(true); };
  const abrirEditar = (r: any) => {
    setEditExp(r);
    setForm({
      numero:   r.numero   || '',
      caratula: r.caratula || '',
      fecha:    r.fecha ? String(r.fecha).slice(0, 10) : '',
      estado:   r.estado   || '',
    });
    setModalForm(true);
  };

  const guardar = async () => {
    if (!form.numero.trim()) { toast.error('Requerido', 'El número de expediente es obligatorio'); return; }
    setSaving(true);
    try {
      if (editExp) {
        // En edición no tocamos created_by
        await apiFetch(`/expedientes/${editExp.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            numero:   form.numero.trim(),
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

          {/* Lista */}
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
        </div>
      </div>

      {/* ── Modal alta / edición ── */}
      {modalForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setModalForm(false)}>
          <div className="card gp-card-14"
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
}
