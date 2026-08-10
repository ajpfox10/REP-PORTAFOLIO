// src/pages/EstructuraPage/index.tsx
// GestiÃ³n de estructura organizacional: Dependencias â†’ Reparticiones â†’ Servicios â†’ Sectores
// CRUD completo con inline-edit, filtros y exportaciÃ³n a Excel.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';

// â”€â”€â”€ Tipos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface Dependencia  { id: number; nombre: string; }
interface Reparticion  { id: number; reparticion_nombre: string; dependencia_id: number | null; }
interface Servicio     { id: number; nombre: string; reparticion_id: number | null; }
interface Sector       { id: number; nombre: string; servicio_id: number | null; }

type Tab = 'dependencias' | 'reparticiones' | 'servicios' | 'sectores';

// â”€â”€â”€ Estilos base â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 14, padding: '18px 20px', marginBottom: 14,
};
const inputSt: React.CSSProperties = {
  fontSize: '0.82rem', padding: '5px 10px', minWidth: 200,
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 7, color: 'inherit', outline: 'none',
};
const selectSt: React.CSSProperties = { ...inputSt, minWidth: 180 };
const thSt: React.CSSProperties = {
  padding: '7px 10px', textAlign: 'left', color: '#94a3b8',
  fontSize: '0.7rem', whiteSpace: 'nowrap', fontWeight: 600,
  background: 'rgba(255,255,255,0.05)',
};
const tdSt: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle', fontSize: '0.82rem' };
const btnSm = (bg = '#3b4252'): React.CSSProperties => ({
  fontSize: '0.72rem', padding: '3px 10px', borderRadius: 6,
  border: 'none', cursor: 'pointer', background: bg, color: '#fff',
  fontWeight: 600,
});

// â”€â”€â”€ ConfirmaciÃ³n de borrado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ConfirmDelete({ nombre, onConfirm, onCancel }: {
  nombre: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>Â¿Eliminar Â«{nombre}Â»?</span>
      <button style={btnSm('#dc2626')} onClick={onConfirm}>SÃ­</button>
      <button style={btnSm()} onClick={onCancel}>No</button>
    </span>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TAB: DEPENDENCIAS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DepTab({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Dependencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [editId, setEditId] = useState<number | 'new' | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/dependencias?limit=500');
      setRows(r?.data || []);
    } catch (e: any) { toast.error('Error al cargar dependencias', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() =>
    rows.filter(r => !filtro || r.nombre.toLowerCase().includes(filtro.toLowerCase()))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [rows, filtro]);

  const guardar = async () => {
    if (!editNombre.trim()) return toast.error('El nombre no puede estar vacÃ­o');
    setSaving(true);
    try {
      if (editId === 'new') {
        const r = await apiFetch<any>('/dependencias', { method: 'POST', body: JSON.stringify({ nombre: editNombre.trim() }) });
        setRows(prev => [...prev, r?.data ?? r]);
        toast.ok('Dependencia creada');
      } else {
        await apiFetch(`/dependencias/${editId}`, { method: 'PATCH', body: JSON.stringify({ nombre: editNombre.trim() }) });
        setRows(prev => prev.map(d => d.id === editId ? { ...d, nombre: editNombre.trim() } : d));
        toast.ok('Guardado');
      }
      setEditId(null); setEditNombre('');
      onChanged();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  const eliminar = async (id: number) => {
    try {
      await apiFetch(`/dependencias/${id}`, { method: 'DELETE' });
      setRows(prev => prev.filter(d => d.id !== id));
      setConfirmDel(null);
      onChanged();
      toast.ok('Eliminada');
    } catch (e: any) { toast.error('Error al eliminar', e?.message); }
  };

  const exportRows = filtradas.map(d => ({ ID: d.id, Nombre: d.nombre }));

  return (
    <div>
      {/* Barra superior */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputSt} placeholder="Buscar dependenciaâ€¦" value={filtro} onChange={e => setFiltro(e.target.value)} />
        <button style={btnSm('#2563eb')} onClick={() => { setEditId('new'); setEditNombre(''); }}>+ Nueva dependencia</button>
        <button style={{ ...btnSm('#16a34a'), marginLeft: 'auto' }} onClick={() => exportToExcel('dependencias', exportRows)}>ðŸ“Š Excel</button>
        <button style={btnSm()} onClick={cargar}>ðŸ”„</button>
        <span style={{ fontSize: '0.73rem', color: '#64748b' }}>{filtradas.length} registros</span>
      </div>

      {/* Formulario nuevo */}
      {editId === 'new' && (
        <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Nueva dependencia:</span>
          <input autoFocus style={inputSt} placeholder="Nombreâ€¦" value={editNombre}
            onChange={e => setEditNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditId(null); }} />
          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
          <button style={btnSm()} onClick={() => setEditId(null)}>âœ• Cancelar</button>
        </div>
      )}

      {/* Tabla */}
      {loading ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Cargandoâ€¦</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={thSt}>ID</th><th style={thSt}>Nombre</th><th style={thSt}>Acciones</th></tr>
            </thead>
            <tbody>
              {filtradas.map(dep => (
                <tr key={dep.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ ...tdSt, color: '#64748b', width: 50 }}>{dep.id}</td>
                  <td style={tdSt}>
                    {editId === dep.id ? (
                      <input autoFocus style={inputSt} value={editNombre}
                        onChange={e => setEditNombre(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditId(null); }} />
                    ) : dep.nombre}
                  </td>
                  <td style={{ ...tdSt, width: 220 }}>
                    {confirmDel === dep.id ? (
                      <ConfirmDelete nombre={dep.nombre} onConfirm={() => eliminar(dep.id)} onCancel={() => setConfirmDel(null)} />
                    ) : editId === dep.id ? (
                      <span style={{ display: 'inline-flex', gap: 5 }}>
                        <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
                        <button style={btnSm()} onClick={() => setEditId(null)}>âœ•</button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 5 }}>
                        <button style={btnSm('#1d4ed8')} onClick={() => { setEditId(dep.id); setEditNombre(dep.nombre); }}>âœŽ Editar</button>
                        <button style={btnSm('#991b1b')} onClick={() => setConfirmDel(dep.id)}>ðŸ—‘</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TAB: REPARTICIONES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function RepTab({ dependencias, onChanged }: { dependencias: Dependencia[]; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Reparticion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDep, setFiltroDep] = useState('');
  const [editId, setEditId] = useState<number | 'new' | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDepId, setEditDepId] = useState<string>('');
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const depMap = useMemo(() => Object.fromEntries(dependencias.map(d => [d.id, d.nombre])), [dependencias]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/reparticiones?limit=500');
      setRows(r?.data || []);
    } catch (e: any) { toast.error('Error al cargar reparticiones', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => rows.filter(r => {
    if (filtroDep && String(r.dependencia_id) !== filtroDep) return false;
    if (filtroTexto && !r.reparticion_nombre.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.reparticion_nombre.localeCompare(b.reparticion_nombre, 'es')), [rows, filtroTexto, filtroDep]);

  const guardar = async () => {
    if (!editNombre.trim()) return toast.error('El nombre no puede estar vacÃ­o');
    if (!editDepId) return toast.error('Selecciona la dependencia padre');
    const body = { reparticion_nombre: editNombre.trim(), dependencia_id: Number(editDepId) };
    setSaving(true);
    try {
      if (editId === 'new') {
        const r = await apiFetch<any>('/reparticiones', { method: 'POST', body: JSON.stringify(body) });
        setRows(prev => [...prev, r?.data ?? r]);
        toast.ok('ReparticiÃ³n creada');
      } else {
        await apiFetch(`/reparticiones/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setRows(prev => prev.map(d => d.id === editId ? { ...d, ...body } : d));
        toast.ok('Guardado');
      }
      setEditId(null); setEditNombre(''); setEditDepId('');
      onChanged();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  const eliminar = async (id: number) => {
    try {
      await apiFetch(`/reparticiones/${id}`, { method: 'DELETE' });
      setRows(prev => prev.filter(d => d.id !== id));
      setConfirmDel(null); onChanged(); toast.ok('Eliminada');
    } catch (e: any) { toast.error('Error al eliminar', e?.message); }
  };

  const exportRows = filtradas.map(r => ({ ID: r.id, 'Reparticion': r.reparticion_nombre, Dependencia: depMap[r.dependencia_id!] || 'â€”' }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputSt} placeholder="Buscar reparticiÃ³nâ€¦" value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
        <select style={selectSt} value={filtroDep} onChange={e => setFiltroDep(e.target.value)}>
          <option value="">Todas las dependencias</option>
          {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
        </select>
        <button style={btnSm('#2563eb')} onClick={() => { setEditId('new'); setEditNombre(''); setEditDepId(filtroDep); }}>+ Nueva reparticiÃ³n</button>
        <button style={{ ...btnSm('#16a34a'), marginLeft: 'auto' }} onClick={() => exportToExcel('reparticiones', exportRows)}>ðŸ“Š Excel</button>
        <button style={btnSm()} onClick={cargar}>ðŸ”„</button>
        <span style={{ fontSize: '0.73rem', color: '#64748b' }}>{filtradas.length} registros</span>
      </div>

      {editId === 'new' && (
        <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Nueva reparticiÃ³n:</span>
          <input autoFocus style={inputSt} placeholder="Nombreâ€¦" value={editNombre}
            onChange={e => setEditNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setEditId(null); }} />
          <select style={selectSt} value={editDepId} onChange={e => setEditDepId(e.target.value)}>
            <option value="">Elegi dependencia padre</option>
            {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
          </select>
          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
          <button style={btnSm()} onClick={() => setEditId(null)}>âœ• Cancelar</button>
        </div>
      )}

      {loading ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Cargandoâ€¦</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>ID</th>
                <th style={thSt}>ReparticiÃ³n</th>
                <th style={thSt}>Dependencia</th>
                <th style={thSt}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(rep => (
                <tr key={rep.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ ...tdSt, color: '#64748b', width: 50 }}>{rep.id}</td>
                  <td style={tdSt}>
                    {editId === rep.id
                      ? <input autoFocus style={inputSt} value={editNombre} onChange={e => setEditNombre(e.target.value)} />
                      : rep.reparticion_nombre}
                  </td>
                  <td style={tdSt}>
                    {editId === rep.id ? (
                      <select style={selectSt} value={editDepId} onChange={e => setEditDepId(e.target.value)}>
                        <option value="">Elegi dependencia padre</option>
                        {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: rep.dependencia_id ? 'inherit' : '#64748b' }}>
                        {rep.dependencia_id ? (depMap[rep.dependencia_id] || `#${rep.dependencia_id}`) : 'â€”'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdSt, width: 220 }}>
                    {confirmDel === rep.id ? (
                      <ConfirmDelete nombre={rep.reparticion_nombre} onConfirm={() => eliminar(rep.id)} onCancel={() => setConfirmDel(null)} />
                    ) : editId === rep.id ? (
                      <span style={{ display: 'inline-flex', gap: 5 }}>
                        <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
                        <button style={btnSm()} onClick={() => setEditId(null)}>âœ•</button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 5 }}>
                        <button style={btnSm('#1d4ed8')} onClick={() => { setEditId(rep.id); setEditNombre(rep.reparticion_nombre); setEditDepId(String(rep.dependencia_id ?? '')); }}>âœŽ Editar</button>
                        <button style={btnSm('#991b1b')} onClick={() => setConfirmDel(rep.id)}>ðŸ—‘</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TAB: SERVICIOS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SvcTab({ reparticiones, dependencias, onChanged }: { reparticiones: Reparticion[]; dependencias: Dependencia[]; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Servicio[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroRep, setFiltroRep] = useState('');
  const [filtroDep, setFiltroDep] = useState('');
  const [editId, setEditId] = useState<number | 'new' | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDepId, setEditDepId] = useState<string>('');
  const [editRepId, setEditRepId] = useState<string>('');
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const repMap = useMemo(() => Object.fromEntries(reparticiones.map(r => [r.id, r.reparticion_nombre])), [reparticiones]);
  const depMap = useMemo(() => Object.fromEntries(dependencias.map(d => [d.id, d.nombre])), [dependencias]);

  // Reparticiones filtradas por dependencia seleccionada
  const repsFiltradas = useMemo(() =>
    filtroDep ? reparticiones.filter(r => String(r.dependencia_id) === filtroDep) : reparticiones,
    [reparticiones, filtroDep]);

  const editRepsFiltradas = useMemo(() =>
    editDepId ? reparticiones.filter(r => String(r.dependencia_id) === editDepId) : [],
    [reparticiones, editDepId]);

  const depDeRep = useCallback((rep_id: number | null) => {
    if (!rep_id) return null;
    const rep = reparticiones.find(r => r.id === rep_id);
    return rep?.dependencia_id ?? null;
  }, [reparticiones]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/servicios?limit=500');
      setRows(r?.data || []);
    } catch (e: any) { toast.error('Error al cargar servicios', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => rows.filter(s => {
    if (filtroRep && String(s.reparticion_id) !== filtroRep) return false;
    if (filtroDep) {
      const depId = depDeRep(s.reparticion_id);
      if (String(depId) !== filtroDep) return false;
    }
    if (filtroTexto && !s.nombre.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [rows, filtroTexto, filtroRep, filtroDep, depDeRep]);

  const guardar = async () => {
    if (!editNombre.trim()) return toast.error('El nombre no puede estar vacÃ­o');
    if (!editRepId) return toast.error('Selecciona la reparticion padre');
    const body = { nombre: editNombre.trim(), reparticion_id: Number(editRepId) };
    setSaving(true);
    try {
      if (editId === 'new') {
        const r = await apiFetch<any>('/servicios', { method: 'POST', body: JSON.stringify(body) });
        setRows(prev => [...prev, r?.data ?? r]);
        toast.ok('Servicio creado');
      } else {
        await apiFetch(`/servicios/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setRows(prev => prev.map(s => s.id === editId ? { ...s, ...body } : s));
        toast.ok('Guardado');
      }
      setEditId(null); setEditNombre(''); setEditDepId(''); setEditRepId('');
      onChanged();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  const eliminar = async (id: number) => {
    try {
      await apiFetch(`/servicios/${id}`, { method: 'DELETE' });
      setRows(prev => prev.filter(s => s.id !== id));
      setConfirmDel(null); onChanged(); toast.ok('Eliminado');
    } catch (e: any) { toast.error('Error al eliminar', e?.message); }
  };

  const exportRows = filtradas.map(s => {
    const depId = depDeRep(s.reparticion_id);
    return {
      ID: s.id,
      Servicio: s.nombre,
      'Reparticion': s.reparticion_id ? (repMap[s.reparticion_id] || `#${s.reparticion_id}`) : 'â€”',
      Dependencia: depId ? (depMap[depId] || `#${depId}`) : 'â€”',
    };
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputSt} placeholder="Buscar servicioâ€¦" value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
        <select style={selectSt} value={filtroDep} onChange={e => { setFiltroDep(e.target.value); setFiltroRep(''); }}>
          <option value="">Todas las dependencias</option>
          {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
        </select>
        <select style={selectSt} value={filtroRep} onChange={e => setFiltroRep(e.target.value)}>
          <option value="">Todas las reparticiones</option>
          {repsFiltradas.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
        </select>
        <button style={btnSm('#2563eb')} onClick={() => { setEditId('new'); setEditNombre(''); setEditDepId(filtroDep); setEditRepId(filtroRep); }}>+ Nuevo servicio</button>
        <button style={{ ...btnSm('#16a34a'), marginLeft: 'auto' }} onClick={() => exportToExcel('servicios', exportRows)}>ðŸ“Š Excel</button>
        <button style={btnSm()} onClick={cargar}>ðŸ”„</button>
        <span style={{ fontSize: '0.73rem', color: '#64748b' }}>{filtradas.length} registros</span>
      </div>

      {editId === 'new' && (
        <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Nuevo servicio:</span>
          <input autoFocus style={inputSt} placeholder="Nombreâ€¦" value={editNombre}
            onChange={e => setEditNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setEditId(null); }} />
          <select style={selectSt} value={editDepId} onChange={e => { setEditDepId(e.target.value); setEditRepId(''); }}>
            <option value="">Elegi dependencia padre</option>
            {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
          </select>
          <select style={selectSt} value={editRepId} onChange={e => setEditRepId(e.target.value)} disabled={!editDepId}>
            <option value="">Elegi reparticion padre</option>
            {editRepsFiltradas.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
          </select>
          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
          <button style={btnSm()} onClick={() => setEditId(null)}>âœ• Cancelar</button>
        </div>
      )}

      {loading ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Cargandoâ€¦</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>ID</th>
                <th style={thSt}>Servicio</th>
                <th style={thSt}>ReparticiÃ³n</th>
                <th style={thSt}>Dependencia</th>
                <th style={thSt}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(svc => {
                const depId = depDeRep(svc.reparticion_id);
                return (
                  <tr key={svc.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ ...tdSt, color: '#64748b', width: 50 }}>{svc.id}</td>
                    <td style={tdSt}>
                      {editId === svc.id
                        ? <input autoFocus style={inputSt} value={editNombre} onChange={e => setEditNombre(e.target.value)} />
                        : svc.nombre}
                    </td>
                    <td style={tdSt}>
                      {editId === svc.id ? (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          <select style={selectSt} value={editDepId} onChange={e => { setEditDepId(e.target.value); setEditRepId(''); }}>
                            <option value="">Elegi dependencia padre</option>
                            {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
                          </select>
                          <select style={selectSt} value={editRepId} onChange={e => setEditRepId(e.target.value)} disabled={!editDepId}>
                            <option value="">Elegi reparticion padre</option>
                            {editRepsFiltradas.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
                          </select>
                        </span>
                      ) : (
                        <span style={{ color: svc.reparticion_id ? 'inherit' : '#64748b' }}>
                          {svc.reparticion_id ? (repMap[svc.reparticion_id] || `#${svc.reparticion_id}`) : 'â€”'}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdSt, color: '#94a3b8', fontSize: '0.76rem' }}>
                      {depId ? (depMap[depId] || `#${depId}`) : 'â€”'}
                    </td>
                    <td style={{ ...tdSt, width: 220 }}>
                      {confirmDel === svc.id ? (
                        <ConfirmDelete nombre={svc.nombre} onConfirm={() => eliminar(svc.id)} onCancel={() => setConfirmDel(null)} />
                      ) : editId === svc.id ? (
                        <span style={{ display: 'inline-flex', gap: 5 }}>
                          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
                          <button style={btnSm()} onClick={() => setEditId(null)}>âœ•</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 5 }}>
                          <button style={btnSm('#1d4ed8')} onClick={() => { setEditId(svc.id); setEditNombre(svc.nombre); setEditDepId(String(depDeRep(svc.reparticion_id) ?? '')); setEditRepId(String(svc.reparticion_id ?? '')); }}>âœŽ Editar</button>
                          <button style={btnSm('#991b1b')} onClick={() => setConfirmDel(svc.id)}>ðŸ—‘</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TAB: SECTORES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SecTab({ servicios, reparticiones, dependencias, onChanged }: { servicios: Servicio[]; reparticiones: Reparticion[]; dependencias: Dependencia[]; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDep, setFiltroDep] = useState('');
  const [filtroRep, setFiltroRep] = useState('');
  const [filtroSvc, setFiltroSvc] = useState('');
  const [editId, setEditId] = useState<number | 'new' | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editDepId, setEditDepId] = useState<string>('');
  const [editRepId, setEditRepId] = useState<string>('');
  const [editSvcId, setEditSvcId] = useState<string>('');
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const svcMap = useMemo(() => Object.fromEntries(servicios.map(s => [s.id, s.nombre])), [servicios]);
  const repMap = useMemo(() => Object.fromEntries(reparticiones.map(r => [r.id, r.reparticion_nombre])), [reparticiones]);
  const depMap = useMemo(() => Object.fromEntries(dependencias.map(d => [d.id, d.nombre])), [dependencias]);

  const getRepDep = useCallback((svc_id: number | null) => {
    if (!svc_id) return { rep: null, dep: null };
    const svc = servicios.find(s => s.id === svc_id);
    if (!svc?.reparticion_id) return { rep: null, dep: null };
    const rep = reparticiones.find(r => r.id === svc.reparticion_id);
    return { rep: rep?.reparticion_nombre ?? null, dep: rep?.dependencia_id ? (depMap[rep.dependencia_id] ?? null) : null };
  }, [servicios, reparticiones, depMap]);

  const repIdDeServicio = useCallback((svc_id: number | null) => {
    if (!svc_id) return null;
    const svc = servicios.find(s => s.id === svc_id);
    return svc?.reparticion_id ?? null;
  }, [servicios]);

  const depIdDeServicio = useCallback((svc_id: number | null) => {
    const repId = repIdDeServicio(svc_id);
    if (!repId) return null;
    return reparticiones.find(r => r.id === repId)?.dependencia_id ?? null;
  }, [reparticiones, repIdDeServicio]);

  const repsFiltro = useMemo(() =>
    filtroDep ? reparticiones.filter(r => String(r.dependencia_id) === filtroDep) : reparticiones,
    [reparticiones, filtroDep]);

  const serviciosFiltro = useMemo(() => servicios.filter(s => {
    if (filtroRep && String(s.reparticion_id) !== filtroRep) return false;
    if (filtroDep && String(depIdDeServicio(s.id)) !== filtroDep) return false;
    return true;
  }), [servicios, filtroRep, filtroDep, depIdDeServicio]);

  const editRepsFiltro = useMemo(() =>
    editDepId ? reparticiones.filter(r => String(r.dependencia_id) === editDepId) : [],
    [reparticiones, editDepId]);

  const editServiciosFiltro = useMemo(() =>
    editRepId ? servicios.filter(s => String(s.reparticion_id) === editRepId) : [],
    [servicios, editRepId]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/sectores?limit=500');
      setRows(r?.data || []);
    } catch (e: any) { toast.error('Error al cargar sectores', e?.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => rows.filter(s => {
    if (filtroDep && String(depIdDeServicio(s.servicio_id)) !== filtroDep) return false;
    if (filtroRep && String(repIdDeServicio(s.servicio_id)) !== filtroRep) return false;
    if (filtroSvc && String(s.servicio_id) !== filtroSvc) return false;
    if (filtroTexto && !s.nombre.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    return true;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [rows, filtroTexto, filtroSvc, filtroRep, filtroDep, repIdDeServicio, depIdDeServicio]);

  const guardar = async () => {
    if (!editNombre.trim()) return toast.error('El nombre no puede estar vacÃ­o');
    if (!editSvcId) return toast.error('Selecciona el servicio padre');
    const body = { nombre: editNombre.trim(), servicio_id: Number(editSvcId) };
    setSaving(true);
    try {
      if (editId === 'new') {
        const r = await apiFetch<any>('/sectores', { method: 'POST', body: JSON.stringify(body) });
        setRows(prev => [...prev, r?.data ?? r]);
        toast.ok('Sector creado');
      } else {
        await apiFetch(`/sectores/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setRows(prev => prev.map(s => s.id === editId ? { ...s, ...body } : s));
        toast.ok('Guardado');
      }
      setEditId(null); setEditNombre(''); setEditDepId(''); setEditRepId(''); setEditSvcId('');
      onChanged();
    } catch (e: any) { toast.error('Error al guardar', e?.message); }
    finally { setSaving(false); }
  };

  const eliminar = async (id: number) => {
    try {
      await apiFetch(`/sectores/${id}`, { method: 'DELETE' });
      setRows(prev => prev.filter(s => s.id !== id));
      setConfirmDel(null); onChanged(); toast.ok('Eliminado');
    } catch (e: any) { toast.error('Error al eliminar', e?.message); }
  };

  const exportRows = filtradas.map(s => {
    const { rep, dep } = getRepDep(s.servicio_id);
    return {
      ID: s.id, Sector: s.nombre,
      Servicio: s.servicio_id ? (svcMap[s.servicio_id] || `#${s.servicio_id}`) : 'â€”',
      'Reparticion': rep || 'â€”', Dependencia: dep || 'â€”',
    };
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={inputSt} placeholder="Buscar sectorâ€¦" value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
        <select style={selectSt} value={filtroDep} onChange={e => { setFiltroDep(e.target.value); setFiltroRep(''); setFiltroSvc(''); }}>
          <option value="">Todas las dependencias</option>
          {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
        </select>
        <select style={selectSt} value={filtroRep} onChange={e => { setFiltroRep(e.target.value); setFiltroSvc(''); }} disabled={!filtroDep}>
          <option value="">Todas las reparticiones</option>
          {repsFiltro.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
        </select>
        <select style={selectSt} value={filtroSvc} onChange={e => setFiltroSvc(e.target.value)}>
          <option value="">Todos los servicios</option>
          {serviciosFiltro.map(s => <option key={s.id} value={String(s.id)}>{s.nombre}</option>)}
        </select>
        <button style={btnSm('#2563eb')} onClick={() => { setEditId('new'); setEditNombre(''); setEditDepId(filtroDep); setEditRepId(filtroRep); setEditSvcId(filtroSvc); }}>+ Nuevo sector</button>
        <button style={{ ...btnSm('#16a34a'), marginLeft: 'auto' }} onClick={() => exportToExcel('sectores', exportRows)}>ðŸ“Š Excel</button>
        <button style={btnSm()} onClick={cargar}>ðŸ”„</button>
        <span style={{ fontSize: '0.73rem', color: '#64748b' }}>{filtradas.length} registros</span>
      </div>

      {editId === 'new' && (
        <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Nuevo sector:</span>
          <input autoFocus style={inputSt} placeholder="Nombreâ€¦" value={editNombre}
            onChange={e => setEditNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setEditId(null); }} />
          <select style={selectSt} value={editDepId} onChange={e => { setEditDepId(e.target.value); setEditRepId(''); setEditSvcId(''); }}>
            <option value="">Elegi dependencia padre</option>
            {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
          </select>
          <select style={selectSt} value={editRepId} onChange={e => { setEditRepId(e.target.value); setEditSvcId(''); }} disabled={!editDepId}>
            <option value="">Elegi reparticion padre</option>
            {editRepsFiltro.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
          </select>
          <select style={selectSt} value={editSvcId} onChange={e => setEditSvcId(e.target.value)} disabled={!editRepId}>
            <option value="">Elegi servicio padre</option>
            {editServiciosFiltro.map(s => <option key={s.id} value={String(s.id)}>{s.nombre}</option>)}
          </select>
          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
          <button style={btnSm()} onClick={() => setEditId(null)}>âœ• Cancelar</button>
        </div>
      )}

      {loading ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Cargandoâ€¦</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>ID</th>
                <th style={thSt}>Sector</th>
                <th style={thSt}>Servicio</th>
                <th style={thSt}>ReparticiÃ³n</th>
                <th style={thSt}>Dependencia</th>
                <th style={thSt}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(sec => {
                const { rep, dep } = getRepDep(sec.servicio_id);
                return (
                  <tr key={sec.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ ...tdSt, color: '#64748b', width: 50 }}>{sec.id}</td>
                    <td style={tdSt}>
                      {editId === sec.id
                        ? <input autoFocus style={inputSt} value={editNombre} onChange={e => setEditNombre(e.target.value)} />
                        : sec.nombre}
                    </td>
                    <td style={tdSt}>
                      {editId === sec.id ? (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          <select style={selectSt} value={editDepId} onChange={e => { setEditDepId(e.target.value); setEditRepId(''); setEditSvcId(''); }}>
                            <option value="">Elegi dependencia padre</option>
                            {dependencias.map(d => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
                          </select>
                          <select style={selectSt} value={editRepId} onChange={e => { setEditRepId(e.target.value); setEditSvcId(''); }} disabled={!editDepId}>
                            <option value="">Elegi reparticion padre</option>
                            {editRepsFiltro.map(r => <option key={r.id} value={String(r.id)}>{r.reparticion_nombre}</option>)}
                          </select>
                          <select style={selectSt} value={editSvcId} onChange={e => setEditSvcId(e.target.value)} disabled={!editRepId}>
                            <option value="">Elegi servicio padre</option>
                            {editServiciosFiltro.map(s => <option key={s.id} value={String(s.id)}>{s.nombre}</option>)}
                          </select>
                        </span>
                      ) : (
                        <span style={{ color: sec.servicio_id ? 'inherit' : '#64748b' }}>
                          {sec.servicio_id ? (svcMap[sec.servicio_id] || `#${sec.servicio_id}`) : 'â€”'}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdSt, color: '#94a3b8', fontSize: '0.76rem' }}>{rep || 'â€”'}</td>
                    <td style={{ ...tdSt, color: '#64748b', fontSize: '0.74rem' }}>{dep || 'â€”'}</td>
                    <td style={{ ...tdSt, width: 220 }}>
                      {confirmDel === sec.id ? (
                        <ConfirmDelete nombre={sec.nombre} onConfirm={() => eliminar(sec.id)} onCancel={() => setConfirmDel(null)} />
                      ) : editId === sec.id ? (
                        <span style={{ display: 'inline-flex', gap: 5 }}>
                          <button style={btnSm('#16a34a')} onClick={guardar} disabled={saving}>{saving ? 'â€¦' : 'âœ” Guardar'}</button>
                          <button style={btnSm()} onClick={() => setEditId(null)}>âœ•</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 5 }}>
                          <button style={btnSm('#1d4ed8')} onClick={() => { setEditId(sec.id); setEditNombre(sec.nombre); setEditDepId(String(depIdDeServicio(sec.servicio_id) ?? '')); setEditRepId(String(repIdDeServicio(sec.servicio_id) ?? '')); setEditSvcId(String(sec.servicio_id ?? '')); }}>âœŽ Editar</button>
                          <button style={btnSm('#991b1b')} onClick={() => setConfirmDel(sec.id)}>ðŸ—‘</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PÃGINA PRINCIPAL
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function EstructuraPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('dependencias');

  // CatÃ¡logos compartidos entre tabs (cargados una sola vez)
  const [dependencias, setDependencias] = useState<Dependencia[]>([]);
  const [reparticiones, setReparticiones] = useState<Reparticion[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [loadingCat, setLoadingCat] = useState(true);

  const cargarCatalogos = useCallback(async () => {
    setLoadingCat(true);
    try {
      const [rD, rR, rS] = await Promise.all([
        apiFetch<any>('/dependencias?limit=500'),
        apiFetch<any>('/reparticiones?limit=500'),
        apiFetch<any>('/servicios?limit=500'),
      ]);
      setDependencias(rD?.data || []);
      setReparticiones(rR?.data || []);
      setServicios(rS?.data || []);
    } catch (e: any) {
      toast.error('Error al cargar catalogos', e?.message);
    } finally {
      setLoadingCat(false);
    }
  }, [toast]);

  useEffect(() => { cargarCatalogos(); }, [cargarCatalogos]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'dependencias',  label: 'ðŸ›ï¸ Dependencias',  count: dependencias.length },
    { key: 'reparticiones', label: 'ðŸ—‚ Reparticiones', count: reparticiones.length },
    { key: 'servicios',     label: 'ðŸ¢ Servicios',      count: servicios.length },
    { key: 'sectores',      label: 'ðŸ“ Sectores' },
  ];

  return (
    <Layout title="Estructura Organizacional" showBack>
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4 }}>
            ðŸ—ï¸ Estructura organizacional
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            JerarquÃ­a: <strong>Dependencia</strong> â†’ <strong>ReparticiÃ³n</strong> â†’ <strong>Servicio</strong> â†’ <strong>Sector</strong>
            {' Â· '}HacÃ© clic en cualquier nivel para administrarlo.
          </div>
        </div>

        {/* Diagrama de jerarquÃ­a */}
        <div style={{ ...card, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, padding: '12px 18px' }}>
          {[
            { label: 'Dependencias', count: dependencias.length, color: '#7c3aed' },
            { label: 'â†’', count: null, color: '#64748b' },
            { label: 'Reparticiones', count: reparticiones.length, color: '#2563eb' },
            { label: 'â†’', count: null, color: '#64748b' },
            { label: 'Servicios', count: servicios.length, color: '#10b981' },
            { label: 'â†’', count: null, color: '#64748b' },
            { label: 'Sectores', count: null, color: '#f59e0b' },
          ].map((item, i) => (
            item.count !== null ? (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 800, color: item.color, lineHeight: 1 }}>
                  {loadingCat ? 'â€¦' : item.count}
                </span>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>{item.label}</span>
              </div>
            ) : (
              <span key={i} style={{ fontSize: '1.4rem', color: item.color, margin: '0 4px' }}>
                {item.label}
              </span>
            )
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 0 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                fontSize: '0.82rem', padding: '7px 16px', border: 'none', cursor: 'pointer',
                borderBottom: tab === t.key ? '2px solid #7c3aed' : '2px solid transparent',
                background: 'transparent',
                color: tab === t.key ? '#c4b5fd' : '#94a3b8',
                fontWeight: tab === t.key ? 700 : 400,
                borderRadius: '6px 6px 0 0',
                transition: 'color 0.15s',
              }}
            >
              {t.label}
              {t.count !== undefined && (
                <span style={{
                  marginLeft: 6, fontSize: '0.68rem', background: 'rgba(255,255,255,0.1)',
                  padding: '1px 6px', borderRadius: 10, color: '#94a3b8',
                }}>
                  {loadingCat ? 'â€¦' : t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Contenido del tab */}
        <div style={card}>
          {tab === 'dependencias'  && <DepTab onChanged={cargarCatalogos} />}
          {tab === 'reparticiones' && <RepTab dependencias={dependencias} onChanged={cargarCatalogos} />}
          {tab === 'servicios'     && <SvcTab reparticiones={reparticiones} dependencias={dependencias} onChanged={cargarCatalogos} />}
          {tab === 'sectores'      && <SecTab servicios={servicios} reparticiones={reparticiones} dependencias={dependencias} onChanged={cargarCatalogos} />}
        </div>

      </div>
    </Layout>
  );
}
