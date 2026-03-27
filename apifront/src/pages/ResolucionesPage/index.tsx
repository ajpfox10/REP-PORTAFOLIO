// src/pages/ResolucionesPage/index.tsx
// Gestión de Resoluciones, Expedientes y Archivos por agente.
// Solo visible para admin y user.

import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { searchPersonal } from '../../api/searchPersonal';
import { useAuth } from '../../auth/AuthProvider';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y || !m || !day) return String(d);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}

async function fetchAll<T = any>(endpoint: string): Promise<T[]> {
  const PAGE = 200;
  let page = 1;
  let all: T[] = [];
  let total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#94a3b8',
  fontSize: '0.68rem', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.05)',
};
const td: React.CSSProperties = { padding: '6px 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' };
const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.72rem', color: '#94a3b8' };

type TabId = 'resoluciones' | 'expedientes' | 'archivos';

// ─── Página ───────────────────────────────────────────────────────────────────
export function ResolucionesPage() {
  const toast  = useToast();
  const { session } = useAuth();

  // ── Búsqueda agente ────────────────────────────────────────────────────────
  const [dniInput,    setDniInput]    = useState('');
  const [nameInput,   setNameInput]   = useState('');
  const [matches,     setMatches]     = useState<any[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [agente,      setAgente]      = useState<any | null>(null);

  // ── Datos del agente ───────────────────────────────────────────────────────
  const [resoluciones,   setResoluciones]   = useState<any[]>([]);
  const [expedientes,    setExpedientes]    = useState<any[]>([]);
  const [archivos,       setArchivos]       = useState<any[]>([]);
  const [tiposRes,       setTiposRes]       = useState<any[]>([]);
  const [loadingData,    setLoadingData]    = useState(false);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>('resoluciones');

  // ── Forms ──────────────────────────────────────────────────────────────────
  const emptyRes = { motivo: '', numero: '', observaciones: '', fecha: '' };
  const emptyExp = { numero: '', caratula: '', fecha: '', estado: '' };

  const [formRes,    setFormRes]    = useState(emptyRes);
  const [formExp,    setFormExp]    = useState(emptyExp);
  const [savingRes,  setSavingRes]  = useState(false);
  const [savingExp,  setSavingExp]  = useState(false);
  const [editRes,    setEditRes]    = useState<any | null>(null);
  const [editExp,    setEditExp]    = useState<any | null>(null);

  // ── Cargar tipos de resolución ─────────────────────────────────────────────
  useEffect(() => {
    fetchAll('/tipoderesolucion').then(setTiposRes).catch(() => {});
  }, []);

  // ── Buscar por DNI ─────────────────────────────────────────────────────────
  const buscarPorDni = useCallback(async () => {
    const clean = dniInput.replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido', 'Ingresá un DNI'); return; }
    setSearching(true);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado', `DNI ${clean} no existe`); return; }
      seleccionarAgente(res.data);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSearching(false); }
  }, [dniInput]);

  // ── Buscar por nombre ──────────────────────────────────────────────────────
  const buscarPorNombre = useCallback(async () => {
    const q = nameInput.trim();
    if (!q) { toast.error('Ingresá un apellido o nombre', ''); return; }
    setSearching(true);
    try {
      const results = await searchPersonal(q);
      setMatches(results.slice(0, 30));
      if (!results.length) toast.error('Sin resultados', `No se encontró "${q}"`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSearching(false); }
  }, [nameInput]);

  // ── Seleccionar agente y cargar sus datos ──────────────────────────────────
  const seleccionarAgente = useCallback(async (a: any) => {
    const dni = String(a.dni).replace(/\D/g, '');
    // Si viene del personal/:dni ya tiene los datos completos
    const perfilCompleto = a.personal || a;
    setAgente({ ...perfilCompleto, dni: Number(dni) });
    setMatches([]);
    setTab('resoluciones');
    setEditRes(null); setFormRes(emptyRes);
    setEditExp(null); setFormExp(emptyExp);
    setLoadingData(true);
    try {
      const [rRes, rExp, rArch] = await Promise.allSettled([
        fetchAll<any>(`/resoluciones?dni=${dni}`),
        fetchAll<any>(`/expedientes?dni=${dni}`),
        fetchAll<any>(`/tblarchivos?dni=${dni}`),
      ]);
      if (rRes.status  === 'fulfilled') setResoluciones(rRes.value);
      if (rExp.status  === 'fulfilled') setExpedientes(rExp.value);
      if (rArch.status === 'fulfilled') setArchivos(rArch.value);
    } catch (e: any) { toast.error('Error cargando datos', e?.message); }
    finally { setLoadingData(false); }
  }, []);

  // ── Guardar resolución ─────────────────────────────────────────────────────
  const guardarRes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    if (!formRes.motivo) { toast.error('Requerido', 'Seleccioná un tipo de resolución'); return; }
    setSavingRes(true);
    try {
      const body = {
        dni: agente.dni,
        motivo: formRes.motivo,
        numero: formRes.numero || null,
        observaciones: formRes.observaciones || null,
        fecha: formRes.fecha || null,
        created_by: session?.id || null,
      };
      if (editRes) {
        await apiFetch(`/resoluciones/${editRes.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Resolución actualizada');
      } else {
        await apiFetch('/resoluciones', { method: 'POST', body: JSON.stringify(body) });
        toast.ok('Guardado', 'Resolución cargada');
      }
      setEditRes(null); setFormRes(emptyRes);
      const rows = await fetchAll<any>(`/resoluciones?dni=${agente.dni}`);
      setResoluciones(rows);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingRes(false); }
  };

  // ── Guardar expediente ─────────────────────────────────────────────────────
  const guardarExp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    if (!formExp.numero) { toast.error('Requerido', 'El número de expediente es obligatorio'); return; }
    setSavingExp(true);
    try {
      const body = {
        dni: agente.dni,
        numero: formExp.numero,
        caratula: formExp.caratula || null,
        fecha: formExp.fecha || null,
        estado: formExp.estado || null,
        created_by: session?.id || null,
      };
      if (editExp) {
        await apiFetch(`/expedientes/${editExp.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Expediente actualizado');
      } else {
        await apiFetch('/expedientes', { method: 'POST', body: JSON.stringify(body) });
        toast.ok('Guardado', 'Expediente cargado');
      }
      setEditExp(null); setFormExp(emptyExp);
      const rows = await fetchAll<any>(`/expedientes?dni=${agente.dni}`);
      setExpedientes(rows);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingExp(false); }
  };

  const startEditRes = (r: any) => {
    setEditRes(r);
    setFormRes({ motivo: r.motivo || '', numero: r.numero || '', observaciones: r.observaciones || '', fecha: r.fecha ? String(r.fecha).slice(0, 10) : '' });
    setTab('resoluciones');
  };

  const startEditExp = (r: any) => {
    setEditExp(r);
    setFormExp({ numero: r.numero || '', caratula: r.caratula || '', fecha: r.fecha ? String(r.fecha).slice(0, 10) : '', estado: r.estado || '' });
    setTab('expedientes');
  };

  const dni = agente?.dni ? String(agente.dni) : '';
  const nombreCompleto = agente ? `${agente.apellido || ''}, ${agente.nombre || ''}`.trim().replace(/^,\s*/, '') : '';

  return (
    <Layout title="Resoluciones y Expedientes" showBack>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* ── Título ── */}
        <div style={{ marginBottom: 18 }}>
          <strong style={{ fontSize: '1.05rem' }}>📋 Resoluciones y Expedientes</strong>
          <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>
            Gestioná resoluciones, expedientes y archivos por agente
          </div>
        </div>

        {/* ── Buscador de agente ── */}
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Por DNI */}
            <div>
              <div style={lbl}>Buscar por DNI</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input
                  className="input"
                  style={{ fontSize: '0.85rem' }}
                  placeholder="Ej: 28305607"
                  value={dniInput}
                  onChange={e => setDniInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                />
                <button className="btn primary" onClick={buscarPorDni} disabled={searching} style={{ whiteSpace: 'nowrap' }}>
                  {searching ? '…' : 'Buscar'}
                </button>
              </div>
            </div>

            {/* Por nombre */}
            <div>
              <div style={lbl}>Buscar por apellido / nombre</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input
                  className="input"
                  style={{ fontSize: '0.85rem' }}
                  placeholder="Ej: García"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                />
                <button className="btn" onClick={buscarPorNombre} disabled={searching} style={{ whiteSpace: 'nowrap' }}>
                  {searching ? '…' : 'Buscar'}
                </button>
              </div>
            </div>
          </div>

          {/* Lista de coincidencias */}
          {matches.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
              {matches.map((m, i) => (
                <div
                  key={i}
                  onClick={() => seleccionarAgente(m)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: '0.83rem',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: 12, alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8', minWidth: 80 }}>{m.dni}</span>
                  <span style={{ fontWeight: 600 }}>{m.apellido}, {m.nombre}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Panel del agente ── */}
        {agente && (
          <>
            {/* Header agente */}
            <div className="card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{nombreCompleto}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>DNI {dni}</div>
              </div>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => { setAgente(null); setMatches([]); setDniInput(''); setNameInput(''); }}>
                ✕ Cerrar
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {(['resoluciones', 'expedientes', 'archivos'] as TabId[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    fontSize: '0.82rem', padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${tab === t ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                    background: tab === t ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.04)',
                    color: tab === t ? '#c4b5fd' : '#94a3b8', fontWeight: tab === t ? 700 : 400,
                  }}
                >
                  {t === 'resoluciones' && `📜 Resoluciones (${resoluciones.length})`}
                  {t === 'expedientes'  && `📁 Expedientes (${expedientes.length})`}
                  {t === 'archivos'     && `🗂️ Archivos (${archivos.length})`}
                </button>
              ))}
            </div>

            {loadingData ? (
              <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>🔄 Cargando…</div>
            ) : (
              <>
                {/* ── Tab Resoluciones ── */}
                {tab === 'resoluciones' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, alignItems: 'start' }}>

                    {/* Tabla */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Resoluciones del agente
                      </div>
                      {resoluciones.length === 0 ? (
                        <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin resoluciones registradas.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={th}>Tipo / Motivo</th>
                                <th style={th}>Número</th>
                                <th style={th}>Fecha</th>
                                <th style={th}>Observaciones</th>
                                <th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {resoluciones.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={td}>{r.motivo || '—'}</td>
                                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.numero || '—'}</td>
                                  <td style={td}>{fmt(r.fecha)}</td>
                                  <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.observaciones || '—'}</td>
                                  <td style={td}>
                                    <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => startEditRes(r)}>✏️</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Formulario */}
                    <div className="card" style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12 }}>
                        {editRes ? '✏️ Editar resolución' : '+ Nueva resolución'}
                      </div>
                      <form onSubmit={guardarRes} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={fg}>
                          <label style={lbl}>Tipo de resolución *</label>
                          <select
                            className="input"
                            style={{ fontSize: '0.83rem' }}
                            value={formRes.motivo}
                            onChange={e => setFormRes(f => ({ ...f, motivo: e.target.value }))}
                            required
                          >
                            <option value="">— Seleccioná —</option>
                            {tiposRes.map(t => (
                              <option key={t.id} value={t.resolucion_nombre}>{t.resolucion_nombre}</option>
                            ))}
                          </select>
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Número</label>
                          <input
                            className="input" style={{ fontSize: '0.83rem' }}
                            placeholder="Ej: 1234/2026"
                            value={formRes.numero}
                            onChange={e => setFormRes(f => ({ ...f, numero: e.target.value }))}
                          />
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Fecha</label>
                          <input
                            className="input" type="date" style={{ fontSize: '0.83rem' }}
                            value={formRes.fecha}
                            onChange={e => setFormRes(f => ({ ...f, fecha: e.target.value }))}
                          />
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Observaciones</label>
                          <input
                            className="input" style={{ fontSize: '0.83rem' }}
                            placeholder="Texto corto…"
                            maxLength={50}
                            value={formRes.observaciones}
                            onChange={e => setFormRes(f => ({ ...f, observaciones: e.target.value }))}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn primary" type="submit" disabled={savingRes} style={{ flex: 1 }}>
                            {savingRes ? '…' : editRes ? 'Actualizar' : 'Guardar'}
                          </button>
                          {editRes && (
                            <button className="btn" type="button" onClick={() => { setEditRes(null); setFormRes(emptyRes); }}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* ── Tab Expedientes ── */}
                {tab === 'expedientes' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, alignItems: 'start' }}>

                    {/* Tabla */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Expedientes del agente
                      </div>
                      {expedientes.length === 0 ? (
                        <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin expedientes registrados.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={th}>Número</th>
                                <th style={th}>Carátula</th>
                                <th style={th}>Fecha</th>
                                <th style={th}>Estado</th>
                                <th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {expedientes.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.numero || '—'}</td>
                                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.caratula || '—'}</td>
                                  <td style={td}>{fmt(r.fecha)}</td>
                                  <td style={td}>
                                    {r.estado
                                      ? <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', fontWeight: 600 }}>{r.estado}</span>
                                      : '—'}
                                  </td>
                                  <td style={td}>
                                    <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => startEditExp(r)}>✏️</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Formulario */}
                    <div className="card" style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12 }}>
                        {editExp ? '✏️ Editar expediente' : '+ Nuevo expediente'}
                      </div>
                      <form onSubmit={guardarExp} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={fg}>
                          <label style={lbl}>Número de expediente *</label>
                          <input
                            className="input" style={{ fontSize: '0.83rem', fontFamily: 'monospace' }}
                            placeholder="EX-23756257-GDEBA-2026"
                            value={formExp.numero}
                            onChange={e => setFormExp(f => ({ ...f, numero: e.target.value }))}
                            required
                          />
                          <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Formato: EX-NNNNN-GDEBA-AAAA</span>
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Carátula</label>
                          <input
                            className="input" style={{ fontSize: '0.83rem' }}
                            placeholder="Descripción del expediente"
                            value={formExp.caratula}
                            onChange={e => setFormExp(f => ({ ...f, caratula: e.target.value }))}
                          />
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Fecha</label>
                          <input
                            className="input" type="date" style={{ fontSize: '0.83rem' }}
                            value={formExp.fecha}
                            onChange={e => setFormExp(f => ({ ...f, fecha: e.target.value }))}
                          />
                        </div>
                        <div style={fg}>
                          <label style={lbl}>Estado</label>
                          <select
                            className="input" style={{ fontSize: '0.83rem' }}
                            value={formExp.estado}
                            onChange={e => setFormExp(f => ({ ...f, estado: e.target.value }))}
                          >
                            <option value="">— Sin estado —</option>
                            <option value="En trámite">En trámite</option>
                            <option value="Resuelto">Resuelto</option>
                            <option value="Archivado">Archivado</option>
                            <option value="Pendiente">Pendiente</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn primary" type="submit" disabled={savingExp} style={{ flex: 1 }}>
                            {savingExp ? '…' : editExp ? 'Actualizar' : 'Guardar'}
                          </button>
                          {editExp && (
                            <button className="btn" type="button" onClick={() => { setEditExp(null); setFormExp(emptyExp); }}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* ── Tab Archivos ── */}
                {tab === 'archivos' && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      Archivos escaneados del agente
                    </div>
                    {archivos.length === 0 ? (
                      <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin archivos registrados para este agente.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={th}>Archivo</th>
                              <th style={th}>Tipo</th>
                              <th style={th}>Número</th>
                              <th style={th}>Año</th>
                              <th style={th}>Fecha</th>
                              <th style={th}>Descripción</th>
                              <th style={th}>Ruta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {archivos.map(a => (
                              <tr key={a.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#c4b5fd' }}>
                                    {a.nombre_archivo_original || a.nombre || '—'}
                                  </span>
                                </td>
                                <td style={td}>{a.tipo || '—'}</td>
                                <td style={{ ...td, fontFamily: 'monospace' }}>{a.numero || '—'}</td>
                                <td style={td}>{a.anio || '—'}</td>
                                <td style={td}>{fmt(a.fecha)}</td>
                                <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.descripcion_archivo || '—'}</td>
                                <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }} title={a.ruta || ''}>
                                    {a.ruta || '—'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
