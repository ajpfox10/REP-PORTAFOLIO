// src/pages/GestionPage/components/modals/DocumentosExpedientesModal.tsx
// Documentos (tblarchivos) + Expedientes del agente en un solo modal.
// La carga de archivos sigue el mismo criterio que Resoluciones → Archivos.
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../../../ui/toast';
import { apiFetch, apiFetchBlobWithMeta } from '../../../../api/http';
import { fetchRowsByDnis } from '../../hooks/useDnisRelacionados';
import { ExpedientesModal } from './ExpedientesModal';

interface Props {
  row: any;
  dnis?: string[];
  onClose: () => void;
  onArchivosCountChange: (n: number) => void;
  onExpedientesCountChange: (n: number) => void;
  expedientesCount: number;
}

type Tab = 'archivos' | 'expedientes';

const TIPOS = ['resolución', 'expediente', 'nota', 'certificado', 'foto', 'documento', 'otro'] as const;
const emptyUpload = { nombre: '', numero: '', tipo: 'resolución', fecha: '', descripcion: '' };
const emptyEdit = { nombre: '', tipo: '', numero: '', anio: '', fecha: '', descripcion_archivo: '' };

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(f);
}

export function DocumentosExpedientesModal({
  row, dnis, onClose, onArchivosCountChange, onExpedientesCountChange, expedientesCount,
}: Props) {
  const toast = useToast();
  // DNIs a consultar: el del agente + los anteriores por cambio de DNI.
  const dnisConsulta = (dnis && dnis.length) ? dnis : (row?.dni ? [String(row.dni)] : []);

  const [tab, setTab] = useState<Tab>('archivos');

  const [archivos, setArchivos] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [upload,     setUpload]     = useState(emptyUpload);
  const [uploading,  setUploading]  = useState(false);

  const [editId,   setEditId]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [savingEdit, setSavingEdit] = useState(false);

  const cargar = useCallback(async () => {
    if (!dnisConsulta.length) return;
    setLoading(true);
    try {
      const data = await fetchRowsByDnis('/tblarchivos', dnisConsulta, { limit: 200 });
      setArchivos(data);
      onArchivosCountChange(data.length);
    } catch {
      setArchivos([]);
    } finally {
      setLoading(false);
    }
  }, [dnisConsulta.join(',')]); // eslint-disable-line

  useEffect(() => { cargar(); }, [cargar]);

  const archivosOrdenados = [...archivos].sort((a, b) => {
    const fa = a?.fecha ? String(a.fecha).slice(0, 10) : '';
    const fb = b?.fecha ? String(b.fecha).slice(0, 10) : '';
    if (fa !== fb) return fb.localeCompare(fa);
    return (b?.id || 0) - (a?.id || 0);
  });

  const cargarArchivo = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    try {
      await apiFetch('/tblarchivos', {
        method: 'POST',
        body: JSON.stringify({
          dni: row.dni, nombre: upload.nombre || null,
          numero: upload.numero || null, tipo: upload.tipo || 'documento',
          fecha: upload.fecha || null, descripcion_archivo: upload.descripcion || null,
          anio: new Date().getFullYear(),
        }),
      });
      toast.ok('Archivo cargado');
      setShowUpload(false); setUpload(emptyUpload);
      cargar();
    } catch (e: any) { toast.error('Error al cargar', e?.message); }
    finally { setUploading(false); }
  };

  const iniciarEdicion = (a: any) => {
    setEditId(a.id);
    setEditForm({
      nombre: a.nombre || a.nombre_archivo_original || '',
      tipo: a.tipo || '',
      numero: a.numero || '',
      anio: a.anio != null ? String(a.anio) : '',
      fecha: a.fecha ? String(a.fecha).slice(0, 10) : '',
      descripcion_archivo: a.descripcion_archivo || '',
    });
  };
  const cancelarEdicion = () => { setEditId(null); setEditForm(emptyEdit); };

  const guardarEdicion = async () => {
    if (editId == null) return;
    setSavingEdit(true);
    try {
      const f = editForm;
      await apiFetch(`/tblarchivos/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: f.nombre.trim() || null,
          tipo: f.tipo.trim() || null,
          numero: f.numero.trim() || null,
          anio: f.anio.trim() ? Number(f.anio) : null,
          fecha: f.fecha || null,
          descripcion_archivo: f.descripcion_archivo.trim() || null,
        }),
      });
      toast.ok('Archivo actualizado');
      cancelarEdicion();
      cargar();
    } catch (e: any) { toast.error('No se pudo actualizar', e?.message); }
    finally { setSavingEdit(false); }
  };

  // Abre el archivo con autenticación (evita el error "Falta credencial")
  const abrirArchivo = async (id: number) => {
    try {
      const { blob } = await apiFetchBlobWithMeta(`/documents/${id}/file`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast.error('No se pudo abrir el archivo', e?.message); }
  };

  const lbl = { fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2, display: 'block' } as const;
  const field = { width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem', marginTop: 3 };
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 };
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: '0.78rem', verticalAlign: 'middle' };
  const editInput = { fontSize: '0.75rem', boxSizing: 'border-box' as const };

  const tabBtn = (k: Tab, label: string) => (
    <button key={k} className="btn" type="button" onClick={() => setTab(k)}
      style={{
        padding: '4px 12px', fontSize: '0.8rem',
        ...(tab === k ? { background: 'rgba(124,58,237,0.28)', borderColor: 'rgba(124,58,237,0.5)', color: '#c4b5fd', fontWeight: 700 } : {}),
      }}
    >{label}</button>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 8000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={onClose}>
      <div
        className="card gp-card-14 gp-modal-solido"
        style={{ maxWidth: 960, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '1.25rem' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="row gp-row-between-center" style={{ marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.95rem' }}>🗂️ Documentos y Expedientes</strong>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              {row.apellido}, {row.nombre} · DNI {row.dni}
            </span>
          </div>
          <button className="btn" type="button" style={{ padding: '3px 10px', fontSize: '0.78rem' }} onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>

        {/* Pestañas */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexShrink: 0 }}>
          {tabBtn('archivos', `📂 Archivos (${archivos.length})`)}
          {tabBtn('expedientes', `📁 Expedientes (${expedientesCount})`)}
        </div>

        {tab === 'expedientes' ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ExpedientesModal row={row} dnis={dnis} embedded onClose={onClose} onCountChange={onExpedientesCountChange} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {/* Alta */}
            <div style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
              <div className="row gp-row-between-center">
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>🗂️ Archivos del agente</span>
                <button className="btn" type="button" style={{ fontSize: '0.75rem' }}
                  onClick={() => { setShowUpload(s => !s); if (showUpload) setUpload(emptyUpload); }}>
                  {showUpload ? 'Cancelar' : '+ Nuevo registro'}
                </button>
              </div>
              {showUpload && (
                <form onSubmit={cargarArchivo} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: 160 }}>
                      <label htmlFor="gp-doc-nombre" style={lbl}>NOMBRE DEL ARCHIVO</label>
                      <input id="gp-doc-nombre" name="nombre" className="input" placeholder="Ej: Resolución ascenso 2026"
                        value={upload.nombre} onChange={e => setUpload(f => ({ ...f, nombre: e.target.value }))} style={field} />
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <label htmlFor="gp-doc-numero" style={lbl}>NÚMERO</label>
                      <input id="gp-doc-numero" name="numero" className="input" placeholder="Ej: 1234/2026"
                        value={upload.numero} onChange={e => setUpload(f => ({ ...f, numero: e.target.value }))} style={field} />
                    </div>
                    <div style={{ minWidth: 140 }}>
                      <label htmlFor="gp-doc-tipo" style={lbl}>TIPO</label>
                      <select id="gp-doc-tipo" name="tipo" className="input" value={upload.tipo}
                        onChange={e => setUpload(f => ({ ...f, tipo: e.target.value }))} style={field}>
                        {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ minWidth: 130 }}>
                      <label htmlFor="gp-doc-fecha" style={lbl}>FECHA</label>
                      <input id="gp-doc-fecha" name="fecha" type="date" className="input" value={upload.fecha}
                        onChange={e => setUpload(f => ({ ...f, fecha: e.target.value }))} style={field} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="gp-doc-desc" style={lbl}>DESCRIPCIÓN</label>
                    <input id="gp-doc-desc" name="descripcion" className="input" placeholder="Descripción del archivo"
                      value={upload.descripcion} onChange={e => setUpload(f => ({ ...f, descripcion: e.target.value }))} style={field} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" type="submit" disabled={uploading}>
                      {uploading ? '⏳ Guardando…' : '💾 Guardar'}
                    </button>
                    <button className="btn" type="button" onClick={() => { setShowUpload(false); setUpload(emptyUpload); }}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>

            {/* Lista */}
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>🔄 Cargando…</div>
            ) : archivos.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: '0.88rem' }}>Sin archivos registrados.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Archivo</th><th style={th}>Tipo</th><th style={th}>Número</th>
                      <th style={th}>Año</th><th style={th}>Fecha</th><th style={th}>Descripción</th><th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivosOrdenados.map(a => (
                      editId === a.id ? (
                        <tr key={a.id} style={{ borderTop: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.06)' }}>
                          <td style={{ ...td, maxWidth: 200 }}>
                            <input className="input" style={{ ...editInput, width: '100%' }} placeholder="Nombre"
                              value={editForm.nombre} onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))} />
                          </td>
                          <td style={td}>
                            <input className="input" style={{ ...editInput, width: 110 }} placeholder="Tipo"
                              value={editForm.tipo} onChange={e => setEditForm(f => ({ ...f, tipo: e.target.value }))} />
                          </td>
                          <td style={td}>
                            <input className="input" style={{ ...editInput, width: 110 }} placeholder="Número"
                              value={editForm.numero} onChange={e => setEditForm(f => ({ ...f, numero: e.target.value }))} />
                          </td>
                          <td style={td}>
                            <input className="input" type="number" style={{ ...editInput, width: 72 }} placeholder="Año"
                              value={editForm.anio} onChange={e => setEditForm(f => ({ ...f, anio: e.target.value }))} />
                          </td>
                          <td style={td}>
                            <input className="input" type="date" style={editInput}
                              value={editForm.fecha} onChange={e => setEditForm(f => ({ ...f, fecha: e.target.value }))} />
                          </td>
                          <td style={{ ...td, maxWidth: 180 }}>
                            <input className="input" style={{ ...editInput, width: '100%' }} placeholder="Descripción"
                              value={editForm.descripcion_archivo} onChange={e => setEditForm(f => ({ ...f, descripcion_archivo: e.target.value }))} />
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button type="button" className="btn primary" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                onClick={guardarEdicion} disabled={savingEdit}>{savingEdit ? '…' : '💾'}</button>
                              <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                onClick={cancelarEdicion} disabled={savingEdit}>✕</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={a.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#c4b5fd' }}>
                              {a.nombre || a.nombre_archivo_original || '—'}
                            </span>
                          </td>
                          <td style={td}>{a.tipo || '—'}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>{a.numero || '—'}</td>
                          <td style={td}>{a.anio || '—'}</td>
                          <td style={td}>{fmtFecha(a.fecha)}</td>
                          <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.descripcion_archivo || '—'}</td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                onClick={() => abrirArchivo(a.id)}>Abrir</button>
                              <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                onClick={() => iniciarEdicion(a)} title="Editar datos">✏️</button>
                            </div>
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
