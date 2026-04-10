// src/pages/AdminPage/components/CatalogosTab.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../api/http';

// ─── Definición de catálogos ──────────────────────────────────────────────────
interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'checkbox';
  required?: boolean;
}

interface CatalogDef {
  table: string;
  label: string;
  pk: string;           // nombre del campo primary key
  displayKey: string;   // campo principal a mostrar en la lista
  fields: FieldDef[];
}

const CATALOGOS: CatalogDef[] = [
  { table: 'dependencias',        label: 'Dependencias',            pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'reparticiones',       label: 'Reparticiones',           pk: 'id',  displayKey: 'reparticion_nombre', fields: [{ key: 'reparticion_nombre', label: 'Nombre',          type: 'text',   required: true }, { key: 'dependencia_id', label: 'Dependencia ID', type: 'number' }] },
  { table: 'servicios',           label: 'Servicios',               pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'reparticion_id', label: 'Repartición ID', type: 'number' }] },
  { table: 'sectores',            label: 'Sectores',                pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'servicio_id',    label: 'Servicio ID',    type: 'number' }] },
  { table: 'plantas',             label: 'Plantas',                 pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'categorias',          label: 'Categorías',              pk: 'ID',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Número/Nombre',   type: 'number', required: true }] },
  { table: 'regimenes_horarios',  label: 'Regímenes Horarios',      pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'number', required: true }, { key: 'estado_planta', label: 'Estado Planta', type: 'text' }] },
  { table: 'ley',                 label: 'Leyes',                   pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'codigoexp', label: 'Código Exp', type: 'number' }, { key: 'leyactiva', label: 'Activa', type: 'checkbox' }, { key: 'descuentosprevisionales', label: 'Desc. Prev.', type: 'number' }] },
  { table: 'funciones',           label: 'Funciones',               pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'descripcion', label: 'Descripción', type: 'text' }] },
  { table: 'jefaturas',           label: 'Jefaturas',               pk: 'id',  displayKey: 'sector',           fields: [{ key: 'sector',            label: 'Sector',          type: 'text',   required: true }, { key: 'jefe', label: 'Jefe', type: 'text' }] },
  { table: 'sexos',               label: 'Sexos',                   pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'ocupaciones',         label: 'Ocupaciones',             pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'codigo', label: 'Código', type: 'number' }, { key: 'agrupamiento', label: 'Agrupamiento', type: 'text' }, { key: 'grado', label: 'Grado', type: 'text' }, { key: 'asignacion', label: 'Asignación', type: 'text' }] },
  { table: 'especialidaddesmedicas', label: 'Especialidades Médicas', pk: 'id', displayKey: 'especialidad',    fields: [{ key: 'especialidad',      label: 'Especialidad',    type: 'text',   required: true }] },
  { table: 'tipoderesolucion',    label: 'Tipos de Resolución',     pk: 'id',  displayKey: 'resolucion_nombre', fields: [{ key: 'resolucion_nombre', label: 'Nombre',         type: 'text',   required: true }] },
  { table: 'tipodedocumento',     label: 'Tipos de Documento',      pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'tipodecuidado',       label: 'Tipos de Cuidado',        pk: 'id',  displayKey: 'cuidado_nombre',   fields: [{ key: 'cuidado_nombre',    label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'ministerios',         label: 'Ministerios',             pk: 'id',  displayKey: 'ministerio',       fields: [{ key: 'ministerio',        label: 'Ministerio',      type: 'text',   required: true }] },
  { table: 'nomenclador',         label: 'Nomenclador',             pk: 'id',  displayKey: 'cargo',            fields: [{ key: 'cargo',             label: 'Cargo',           type: 'text',   required: true }, { key: 'tareas', label: 'Tareas ID', type: 'number' }] },
  { table: 'codigoa',             label: 'Códigos A',               pk: 'nu',  displayKey: 'codigo',           fields: [{ key: 'codigo',            label: 'Código',          type: 'text',   required: true }, { key: 'observacion', label: 'Observación', type: 'text' }] },
  { table: 'disiplina',           label: 'Disciplinas',             pk: 'id',  displayKey: 'disciplina',       fields: [{ key: 'disciplina',        label: 'Disciplina',      type: 'text',   required: true }] },
  { table: 'jefedeptos',          label: 'Jefes de Departamento',   pk: 'id',  displayKey: 'jefedepto',        fields: [{ key: 'jefedepto',         label: 'Jefe',            type: 'text',   required: true }, { key: 'depto', label: 'Departamento', type: 'text' }, { key: 'oficinacentral', label: 'Oficina Central', type: 'text' }] },
];

// ─── CatalogosTab ─────────────────────────────────────────────────────────────
export function CatalogosTab() {
  const [selected,  setSelected]  = useState<CatalogDef>(CATALOGOS[0]);
  const [rows,      setRows]      = useState<any[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [editRow,   setEditRow]   = useState<any | null>(null);   // null = cerrado, {} = nuevo, {id:...} = editar
  const [form,      setForm]      = useState<Record<string, any>>({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [busqueda,  setBusqueda]  = useState('');

  const cargar = useCallback(async (cat: CatalogDef) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<any>(`/${cat.table}?limit=500&page=1`);
      setRows(res?.data || res || []);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRows([]);
    setBusqueda('');
    setEditRow(null);
    cargar(selected);
  }, [selected, cargar]);

  const abrirNuevo = () => {
    const empty: Record<string, any> = {};
    for (const f of selected.fields) empty[f.key] = f.type === 'checkbox' ? false : '';
    setForm(empty);
    setEditRow({});
  };

  const abrirEditar = (row: any) => {
    const f: Record<string, any> = {};
    for (const field of selected.fields) f[field.key] = row[field.key] ?? '';
    setForm(f);
    setEditRow(row);
  };

  const guardar = async () => {
    const req = selected.fields.find(f => f.required && !form[f.key] && form[f.key] !== 0);
    if (req) { setError(`El campo "${req.label}" es obligatorio`); return; }
    setSaving(true);
    setError('');
    try {
      const isNew = !editRow?.[selected.pk];
      if (isNew) {
        await apiFetch<any>(`/${selected.table}`, { method: 'POST', body: JSON.stringify(form) });
      } else {
        await apiFetch<any>(`/${selected.table}/${editRow[selected.pk]}`, { method: 'PATCH', body: JSON.stringify(form) });
      }
      setEditRow(null);
      cargar(selected);
    } catch (e: any) {
      setError(e?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async (row: any) => {
    if (!confirm(`¿Eliminar "${row[selected.displayKey]}"?`)) return;
    try {
      await apiFetch<any>(`/${selected.table}/${row[selected.pk]}`, { method: 'DELETE' });
      cargar(selected);
    } catch (e: any) {
      setError(e?.message || 'Error al eliminar');
    }
  };

  const rowsFiltrados = busqueda
    ? rows.filter(r => String(r[selected.displayKey] ?? '').toLowerCase().includes(busqueda.toLowerCase()))
    : rows;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, minHeight: 500 }}>

      {/* ── Lista de catálogos ── */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, paddingLeft: 4 }}>
          Tablas de catálogo
        </div>
        {CATALOGOS.map(cat => (
          <button
            key={cat.table}
            onClick={() => setSelected(cat)}
            style={{
              textAlign: 'left', padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: selected.table === cat.table ? 700 : 400,
              background: selected.table === cat.table ? 'rgba(124,58,237,0.25)' : 'transparent',
              color: selected.table === cat.table ? '#c4b5fd' : 'rgba(255,255,255,0.7)',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── Panel de datos ── */}
      <div>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: '0.95rem' }}>{selected.label}</strong>
            <span className="muted" style={{ fontSize: '0.72rem', marginLeft: 8 }}>{rows.length} registros</span>
          </div>
          <button className="btn" style={{ background: '#7c3aed', color: '#fff', fontSize: '0.78rem' }}
            onClick={abrirNuevo}>+ Nuevo</button>
        </div>

        {/* Buscador */}
        <input
          className="input"
          style={{ width: '100%', marginBottom: 10, fontSize: '0.82rem' }}
          placeholder={`Buscar en ${selected.label}…`}
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />

        {error && <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>}

        {/* Formulario inline */}
        {editRow !== null && (
          <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 10 }}>
              {editRow[selected.pk] ? '✏️ Editar registro' : '➕ Nuevo registro'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              {selected.fields.map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 3 }}>{f.label}{f.required ? ' *' : ''}</div>
                  {f.type === 'checkbox' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!form[f.key]}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                      <span style={{ fontSize: '0.8rem' }}>{form[f.key] ? 'Sí' : 'No'}</span>
                    </label>
                  ) : (
                    <input
                      className="input"
                      style={{ width: '100%', fontSize: '0.82rem' }}
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ background: '#10b981', color: '#fff', fontSize: '0.78rem' }}
                onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : '💾 Guardar'}</button>
              <button className="btn" style={{ fontSize: '0.78rem' }}
                onClick={() => { setEditRow(null); setError(''); }}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Tabla */}
        {loading ? (
          <div className="muted" style={{ fontSize: '0.82rem', padding: 20, textAlign: 'center' }}>Cargando…</div>
        ) : rowsFiltrados.length === 0 ? (
          <div className="muted" style={{ fontSize: '0.82rem', padding: 20, textAlign: 'center' }}>Sin registros</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                  <th style={th}>#</th>
                  {selected.fields.map(f => <th key={f.key} style={th}>{f.label}</th>)}
                  <th style={th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rowsFiltrados.map((row, i) => (
                  <tr key={row[selected.pk] ?? i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={td}>{row[selected.pk]}</td>
                    {selected.fields.map(f => (
                      <td key={f.key} style={td}>
                        {f.type === 'checkbox' ? (row[f.key] ? '✅' : '—') : (row[f.key] ?? '—')}
                      </td>
                    ))}
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" style={{ fontSize: '0.7rem', marginRight: 4 }}
                        onClick={() => abrirEditar(row)}>✏️</button>
                      <button className="btn btn-sm" style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                        onClick={() => eliminar(row)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 10px', color: 'rgba(255,255,255,0.85)' };
