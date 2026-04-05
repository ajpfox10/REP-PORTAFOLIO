import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geoApi } from '../api/geo.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import CoordPicker from '../components/incidents/CoordPicker';
import { toast } from 'sonner';

// ── Iconos por tipo ───────────────────────────────────────────────────────────

const TYPE_META = {
  HOSPITAL:     { label: 'Hospital',        color: '#dc2626', emoji: '🏥' },
  SALITA:       { label: 'Centro de Salud', color: '#f97316', emoji: '🩺' },
  BOMBEROS:     { label: 'Bomberos',        color: '#ea580c', emoji: '🚒' },
  SAME:         { label: 'SAME / SAMU',     color: '#7c3aed', emoji: '🚑' },
  DEFENSA_CIVIL:{ label: 'Defensa Civil',   color: '#0284c7', emoji: '🛡️' },
  CUARTEL_GN:   { label: 'Gendarmería',     color: '#15803d', emoji: '⚔️' },
  OTRO:         { label: 'Otro',            color: '#64748b', emoji: '📍' },
  POLICIA:      { label: 'Comisaría',       color: '#1e3a8a', emoji: '🚔' },
};

function makeIcon(type) {
  const m = TYPE_META[type] || TYPE_META.OTRO;
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${m.color};color:#fff;border-radius:50%;
      width:32px;height:32px;display:flex;align-items:center;
      justify-content:center;font-size:15px;border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.4);">${m.emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// ── FitBounds helper ──────────────────────────────────────────────────────────

function FitBounds({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !points.length) return;
    const valid = points.filter(p => p.latitude && p.longitude);
    if (!valid.length) return;
    map.fitBounds(valid.map(p => [p.latitude, p.longitude]), { padding: [40, 40], maxZoom: 13 });
    fitted.current = true;
  }, [points, map]);
  return null;
}

// ── Formulario modal ──────────────────────────────────────────────────────────

const INPUT = {
  width: '100%', padding: '0.45rem 0.6rem',
  border: '1px solid #d1d5db', borderRadius: 'var(--radius)',
  fontSize: '0.875rem', boxSizing: 'border-box',
};
const LABEL = { fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.2rem', display: 'block' };
const ROW   = { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' };
const FIELD = (flex = 1) => ({ flex, minWidth: 0, display: 'flex', flexDirection: 'column', marginBottom: '0.6rem' });

function ResourceForm({ initial, onSave, onClose }) {
  const { user } = useAuthStore();
  const canEdit  = user?.role === 'admin' || user?.role === 'medium';

  const isNew  = !initial;
  const isPol  = initial?.source === 'police';

  const [form, setForm]     = useState({
    source:     isPol ? 'police' : 'infra',
    type:       initial?.type       || 'HOSPITAL',
    name:       initial?.name       || '',
    address:    initial?.address    || '',
    phone:      initial?.phone      || '',
    province_id:initial?.province_id ? String(initial.province_id) : '',
    partido_id: initial?.partido_id  ? String(initial.partido_id)  : '',
    latitude:   initial?.latitude   || '',
    longitude:  initial?.longitude  || '',
    beds:       initial?.beds        || '',
    level:      initial?.level       || '',
    is_active:  initial?.is_active !== undefined ? initial.is_active : 1,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [geolocating, setGeolocating] = useState(false);

  const { provinces, partidos, fetchPartidos } = useGeoStore();
  useEffect(() => { if (!provinces.length) useGeoStore.getState().fetchProvinces(); }, []);
  const currentPartidos = partidos[form.province_id] || [];

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleProv = (e) => {
    set('province_id', e.target.value);
    set('partido_id', '');
    if (e.target.value) fetchPartidos(e.target.value);
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) { setError('Navegador sin soporte de geolocalización.'); return; }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { set('latitude', pos.coords.latitude.toFixed(7)); set('longitude', pos.coords.longitude.toFixed(7)); setGeolocating(false); },
      () => { setError('No se pudo obtener ubicación.'); setGeolocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const data = {
      ...form,
      province_id: form.province_id ? Number(form.province_id) : null,
      partido_id:  form.partido_id  ? Number(form.partido_id)  : null,
      latitude:    form.latitude    ? parseFloat(form.latitude)  : null,
      longitude:   form.longitude   ? parseFloat(form.longitude) : null,
      beds:        form.beds        ? Number(form.beds)           : null,
    };
    try {
      await onSave(data, initial?.id);
      toast.success(initial ? 'Recurso actualizado' : 'Recurso agregado correctamente');
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al guardar';
      toast.error(msg);
      setError(msg);
      setSaving(false);
    }
  };

  const isPolice = form.source === 'police';

  return (
    <form onSubmit={handleSubmit}>
      {/* Tipo de recurso */}
      {isNew && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={LABEL}>Tipo de recurso</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="radio" name="src" value="infra" checked={!isPolice} onChange={() => set('source','infra')} />
              Infraestructura (hospital, bomberos, SAME…)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="radio" name="src" value="police" checked={isPolice}  onChange={() => set('source','police')} />
              Comisaría / Policía
            </label>
          </div>
        </div>
      )}

      {/* Subtipo de infraestructura */}
      {!isPolice && (
        <div style={FIELD()}>
          <label style={LABEL}>Categoría</label>
          <select style={INPUT} value={form.type} onChange={e => set('type', e.target.value)}>
            {Object.entries(TYPE_META).filter(([k]) => k !== 'POLICIA').map(([k, m]) => (
              <option key={k} value={k}>{m.emoji} {m.label}</option>
            ))}
          </select>
        </div>
      )}

      <div style={ROW}>
        <div style={FIELD(2)}>
          <label style={LABEL}>Nombre *</label>
          <input style={INPUT} value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
        <div style={FIELD(1)}>
          <label style={LABEL}>Teléfono</label>
          <input style={INPUT} value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>

      <div style={FIELD()}>
        <label style={LABEL}>Dirección</label>
        <input style={INPUT} value={form.address} onChange={e => set('address', e.target.value)} />
      </div>

      <div style={ROW}>
        <div style={FIELD()}>
          <label style={LABEL}>Provincia</label>
          <select style={INPUT} value={form.province_id} onChange={handleProv}>
            <option value="">— Seleccionar —</option>
            {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={FIELD()}>
          <label style={LABEL}>Partido / Municipio</label>
          <select style={INPUT} value={form.partido_id} onChange={e => set('partido_id', e.target.value)} disabled={!form.province_id}>
            <option value="">— Seleccionar —</option>
            {currentPartidos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Coordenadas */}
      <div style={ROW}>
        <div style={FIELD()}>
          <label style={LABEL}>Latitud</label>
          <input style={INPUT} type="number" step="any" value={form.latitude} onChange={e => set('latitude', e.target.value)} />
        </div>
        <div style={FIELD()}>
          <label style={LABEL}>Longitud</label>
          <input style={INPUT} type="number" step="any" value={form.longitude} onChange={e => set('longitude', e.target.value)} />
        </div>
        <div style={{ ...FIELD(0), justifyContent: 'flex-end' }}>
          <label style={{ ...LABEL, opacity: 0 }}>.</label>
          <button type="button" onClick={handleGeolocate} disabled={geolocating}
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', border: '1px solid #3b82f6', borderRadius: 'var(--radius)', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📍 {geolocating ? 'Obteniendo…' : 'Mi ubicación'}
          </button>
        </div>
      </div>

      {/* Solo hospitales */}
      {!isPolice && form.type === 'HOSPITAL' && (
        <div style={ROW}>
          <div style={FIELD()}>
            <label style={LABEL}>Camas</label>
            <input style={INPUT} type="number" min="0" value={form.beds} onChange={e => set('beds', e.target.value)} />
          </div>
          <div style={FIELD()}>
            <label style={LABEL}>Nivel / Complejidad</label>
            <input style={INPUT} placeholder="ej. Alta complejidad" value={form.level} onChange={e => set('level', e.target.value)} />
          </div>
        </div>
      )}

      {!isNew && (
        <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" id="active" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} />
          <label htmlFor="active" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Activo</label>
        </div>
      )}

      {error && <div style={{ background:'#fee2e2', color:'#dc2626', padding:'0.5rem 0.75rem', borderRadius:'var(--radius)', marginBottom:'0.75rem', fontSize:'0.85rem' }}>{error}</div>}

      <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end', paddingTop:'0.5rem', borderTop:'1px solid #e5e7eb' }}>
        <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
        <Button type="submit" isLoading={saving}>{isNew ? 'Agregar' : 'Guardar'}</Button>
      </div>
    </form>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

const ALL_TYPES = Object.entries(TYPE_META).map(([k, m]) => ({ value: k, ...m }));

export default function InfrastructureView() {
  const { user }   = useAuthStore();
  const canEdit    = user?.role === 'admin' || user?.role === 'medium';

  const { provinces, fetchProvinces } = useGeoStore();
  useEffect(() => { if (!provinces.length) fetchProvinces(); }, []);

  const [infra,   setInfra]   = useState([]);
  const [police,  setPolice]  = useState([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [filterType,   setFilterType]   = useState('');
  const [filterProv,   setFilterProv]   = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // Vista
  const [view,    setView]    = useState('table'); // 'table' | 'map'

  // Modal
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editItem,     setEditItem]     = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType && filterType !== 'POLICIA') params.type = filterType;
      if (filterProv) params.province_id = filterProv;

      const [infraRes, policeRes] = await Promise.all([
        filterType !== 'POLICIA' ? geoApi.getInfrastructure(params) : Promise.resolve({ data: [] }),
        filterType === '' || filterType === 'POLICIA'
          ? geoApi.getPoliceStations(filterProv || undefined)
          : Promise.resolve({ data: [] }),
      ]);
      setInfra(infraRes.data.map(r => ({ ...r, source: 'infra' })));
      setPolice(policeRes.data.map(r => ({ ...r, type: 'POLICIA', source: 'police' })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterType, filterProv]);

  const combined = [...infra, ...police].filter(r => {
    if (!filterSearch) return true;
    const s = filterSearch.toLowerCase();
    return [r.name, r.address, r.province_name, r.partido_name].some(f => f?.toLowerCase().includes(s));
  });

  const handleSave = async (data, id) => {
    const { source, ...payload } = data;
    if (source === 'police') {
      if (id) await geoApi.updatePoliceStation(id, payload);
      else     await geoApi.createPoliceStation(payload);
    } else {
      if (id) await geoApi.updateInfrastructure(id, payload);
      else     await geoApi.createInfrastructure(payload);
    }
    await load();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.source === 'police') await geoApi.deletePoliceStation(confirmDelete.id);
      else                                   await geoApi.deleteInfrastructure(confirmDelete.id);
      toast.success(`${confirmDelete.name} eliminado`);
    } catch {
      toast.error('Error al eliminar');
    }
    setConfirmDelete(null);
    await load();
  };

  // Contadores por tipo
  const counts = {};
  combined.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });

  const sel = {
    padding:'0.4rem 0.6rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)',
    fontSize:'0.8rem', background:'#fff',
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', gap:'1rem' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:'0.75rem' }}>
        <h1 style={{ fontSize:'1.4rem', fontWeight:700, flex:1, minWidth:0 }}>Recursos e Infraestructura</h1>
        {canEdit && (
          <Button onClick={() => { setEditItem(null); setModalOpen(true); }}>
            + Agregar recurso
          </Button>
        )}
      </div>

      {/* Tarjetas de resumen */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
        {ALL_TYPES.map(t => {
          const cnt = counts[t.value] || 0;
          return (
            <button key={t.value} onClick={() => setFilterType(filterType === t.value ? '' : t.value)}
              style={{
                display:'flex', alignItems:'center', gap:'0.4rem',
                padding:'0.4rem 0.75rem', borderRadius:'var(--radius)',
                border:`2px solid ${filterType === t.value ? t.color : '#e5e7eb'}`,
                background: filterType === t.value ? t.color + '18' : '#fff',
                cursor:'pointer', fontSize:'0.8rem', fontWeight:500,
              }}>
              {t.emoji} {t.label} <span style={{ fontWeight:700, color: t.color }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Barra de filtros */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center' }}>
        <input
          placeholder="Buscar por nombre, dirección…"
          value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
          style={{ ...sel, flex:1, minWidth:180 }}
        />
        <select style={sel} value={filterProv} onChange={e => setFilterProv(e.target.value)}>
          <option value="">Todas las provincias</option>
          {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ display:'flex', gap:'2px', border:'1px solid #d1d5db', borderRadius:'var(--radius)', overflow:'hidden' }}>
          {['table','map'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:'0.4rem 0.75rem', fontSize:'0.8rem', border:'none',
              background: view === v ? '#1d4ed8' : '#fff',
              color: view === v ? '#fff' : '#475569',
              cursor:'pointer',
            }}>
              {v === 'table' ? '≡ Tabla' : '🗺 Mapa'}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      {loading ? (
        <p style={{ color:'#64748b', textAlign:'center', padding:'2rem' }}>Cargando…</p>
      ) : combined.length === 0 ? (
        <div style={{ textAlign:'center', padding:'3rem', color:'#94a3b8' }}>
          <div style={{ fontSize:'2.5rem', marginBottom:'0.5rem' }}>🏗️</div>
          <p>No hay recursos cargados con esos filtros.</p>
          {canEdit && <p style={{ fontSize:'0.85rem' }}>Hacé clic en "Agregar recurso" para empezar.</p>}
        </div>
      ) : view === 'table' ? (
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.85rem' }}>
            <thead>
              <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                {['Tipo','Nombre','Dirección','Partido / Provincia','Teléfono','',''].map((h, i) => (
                  <th key={i} style={{ padding:'0.6rem 0.75rem', textAlign:'left', fontWeight:600, color:'#475569', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {combined.map((r, i) => {
                const m = TYPE_META[r.type] || TYPE_META.OTRO;
                return (
                  <tr key={`${r.source}-${r.id}`} style={{ borderBottom:'1px solid #f1f5f9', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding:'0.55rem 0.75rem', whiteSpace:'nowrap' }}>
                      <span style={{
                        display:'inline-flex', alignItems:'center', gap:'0.3rem',
                        background: m.color + '18', color: m.color,
                        padding:'0.2rem 0.5rem', borderRadius:999, fontSize:'0.75rem', fontWeight:600,
                      }}>
                        {m.emoji} {m.label}
                      </span>
                    </td>
                    <td style={{ padding:'0.55rem 0.75rem', fontWeight:500 }}>{r.name}</td>
                    <td style={{ padding:'0.55rem 0.75rem', color:'#64748b', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.address || '—'}</td>
                    <td style={{ padding:'0.55rem 0.75rem', color:'#64748b', whiteSpace:'nowrap' }}>{[r.partido_name, r.province_name].filter(Boolean).join(' / ') || '—'}</td>
                    <td style={{ padding:'0.55rem 0.75rem', color:'#64748b', whiteSpace:'nowrap' }}>{r.phone || '—'}</td>
                    <td style={{ padding:'0.55rem 0.4rem' }}>
                      {r.latitude && r.longitude && (
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}&zoom=16`}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize:'0.75rem', color:'#3b82f6', textDecoration:'none' }}
                        >📍 Ver</a>
                      )}
                    </td>
                    {canEdit && (
                      <td style={{ padding:'0.55rem 0.4rem', whiteSpace:'nowrap' }}>
                        <button onClick={() => { setEditItem(r); setModalOpen(true); }}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#3b82f6', fontSize:'0.8rem', marginRight:4 }}>Editar</button>
                        <button onClick={() => setConfirmDelete(r)}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#dc2626', fontSize:'0.8rem' }}>Eliminar</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding:'0.5rem 0.75rem', color:'#94a3b8', fontSize:'0.75rem', borderTop:'1px solid #f1f5f9' }}>
            {combined.length} recursos
          </div>
        </div>
      ) : (
        /* Vista Mapa */
        <div style={{ flex:1, minHeight:400, borderRadius:'var(--radius)', overflow:'hidden', boxShadow:'var(--shadow)' }}>
          <MapContainer center={[-38.4161,-63.6167]} zoom={5} style={{ height:'100%', width:'100%', minHeight:400 }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
              maxZoom={19}
            />
            <FitBounds points={combined} />
            {combined.filter(r => r.latitude && r.longitude).map(r => (
              <Marker key={`${r.source}-${r.id}`} position={[r.latitude, r.longitude]} icon={makeIcon(r.type)}>
                <Popup>
                  <div style={{ minWidth:160 }}>
                    <strong>{r.name}</strong><br />
                    <span style={{ fontSize:'0.8rem', color:'#64748b' }}>{TYPE_META[r.type]?.label}</span>
                    {r.address && <><br /><span style={{ fontSize:'0.8rem' }}>{r.address}</span></>}
                    {r.phone   && <><br />📞 {r.phone}</>}
                    {r.beds    && <><br />🛏 {r.beds} camas</>}
                    {r.level   && <><br />⚕️ {r.level}</>}
                    {canEdit && (
                      <div style={{ marginTop:'0.5rem', display:'flex', gap:'0.4rem' }}>
                        <button onClick={() => { setEditItem(r); setModalOpen(true); }}
                          style={{ fontSize:'0.75rem', padding:'0.2rem 0.5rem', border:'1px solid #3b82f6', borderRadius:4, background:'#eff6ff', color:'#1d4ed8', cursor:'pointer' }}>
                          Editar
                        </button>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* Modal agregar / editar */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editItem ? `Editar: ${editItem.name}` : 'Agregar Recurso'}
        width={620}
      >
        <ResourceForm
          initial={editItem}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      </Modal>

      {/* Modal confirmar eliminar */}
      <Modal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirmar eliminación" width={420}>
        <p style={{ marginBottom:'1rem', color:'#374151' }}>
          ¿Querés eliminar <strong>{confirmDelete?.name}</strong>? Esta acción lo marcará como inactivo.
        </p>
        <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  );
}
