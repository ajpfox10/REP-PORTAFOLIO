import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import { StatusBadge } from '../components/common/Badge';
import Button from '../components/common/Button';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const ACTIVO_STATUSES   = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA'];
const CONTROL_STATUSES  = ['CONTROLADO'];
const CERRADO_STATUSES  = ['CERRADO', 'CANCELADO'];

function isActivo(s)    { return ACTIVO_STATUSES.includes(s); }
function isCerrado(s)   { return CERRADO_STATUSES.includes(s); }

function makeFloodIcon(priority) {
  const size   = priority === 'CRITICA' ? 22 : priority === 'ALTA' ? 18 : 14;
  const color  = priority === 'CRITICA' ? '#dc2626' : priority === 'ALTA' ? '#d97706' : '#3b82f6';
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(59,130,246,0.6)"></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FloodCluster({ incidents }) {
  const map = useMap();
  useEffect(() => {
    const group = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50, showCoverageOnHover: false });
    incidents.filter(i => i.latitude && i.longitude).forEach(i => {
      const icon = makeFloodIcon(i.priority);
      const marker = L.marker([Number(i.latitude), Number(i.longitude)], { icon });
      marker.bindPopup(`
        <div style="min-width:180px">
          <div style="font-weight:700;font-size:0.8rem;margin-bottom:4px;color:#1e3a8a">${i.incident_number}</div>
          <div style="font-size:0.75rem;color:#374151;margin-bottom:6px">${i.title}</div>
          <div style="font-size:0.72rem;color:#64748b">
            👥 ${i.affected_persons_count || 0} afectados · 🏠 ${i.evacuated_count || 0} evacuados
          </div>
          <a href="/incidents/${i.uuid}" style="font-size:0.75rem;color:#1d4ed8;display:block;margin-top:6px">Ver detalle →</a>
        </div>`, { minWidth: 180 });
      group.addLayer(marker);
    });
    map.addLayer(group);

    // Fit bounds if there are points
    const valid = incidents.filter(i => i.latitude && i.longitude);
    if (valid.length) {
      try {
        const bounds = L.latLngBounds(valid.map(i => [Number(i.latitude), Number(i.longitude)]));
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } catch {/* ignore */}
    }

    return () => map.removeLayer(group);
  }, [incidents, map]);
  return null;
}

// ─── Card de resumen ──────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color = '#1d4ed8', bg = '#eff6ff' }) {
  return (
    <div style={{ background: bg, borderRadius: 'var(--radius)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 140 }}>
      <span style={{ fontSize: '1.75rem' }}>{icon}</span>
      <div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Modal de cambio de estado ────────────────────────────────────────────────
function StatusModal({ incident, onClose, onSaved }) {
  const [status, setStatus] = useState('CERRADO');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await incidentsApi.updateStatus(incident.uuid, { status, notes });
      toast.success(`Estado actualizado a ${status}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al actualizar estado');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'0 20px 60px rgba(0,0,0,0.25)', padding:'1.5rem', width:400, maxWidth:'90vw' }}>
        <h3 style={{ fontSize:'1rem', fontWeight:700, marginBottom:'0.75rem' }}>
          Cambiar estado — {incident.incident_number}
        </h3>
        <div style={{ marginBottom:'0.75rem' }}>
          <label style={{ fontSize:'0.8rem', fontWeight:500, display:'block', marginBottom:4 }}>Nuevo estado</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            style={{ width:'100%', padding:'0.4rem 0.6rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem' }}>
            <option value="CONTROLADO">Controlado</option>
            <option value="CERRADO">Cerrado / Resuelto</option>
            <option value="CANCELADO">Cancelado</option>
            <option value="EN_ESCENA">En Escena</option>
            <option value="EN_CAMINO">En Camino</option>
            <option value="RECIBIDO">Recibido</option>
          </select>
        </div>
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ fontSize:'0.8rem', fontWeight:500, display:'block', marginBottom:4 }}>Notas (opcional)</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones sobre el cambio de estado..."
            style={{ width:'100%', padding:'0.4rem 0.6rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem', resize:'vertical' }} />
        </div>
        <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" isLoading={saving} onClick={save}>Guardar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function InundadosView() {
  const { incidentTypes, provinces, fetchProvinces, fetchIncidentTypes } = useGeoStore();
  const canWrite = useAuthStore(s => s.canWrite());

  const [all,          setAll]          = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modalTarget,  setModalTarget]  = useState(null);
  const [viewMode,     setViewMode]     = useState('tabla'); // 'tabla' | 'mapa'

  // Filtros locales (cliente)
  const [filterStatus, setFilterStatus] = useState('todos');   // 'todos'|'activos'|'controlados'|'cerrados'
  const [filterProv,   setFilterProv]   = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  useEffect(() => { fetchProvinces(); fetchIncidentTypes(); }, []);

  const inundacionType = incidentTypes.find(t =>
    t.name.toLowerCase().includes('inundac') || t.name.toLowerCase().includes('flood')
  );

  const load = useCallback(() => {
    if (!inundacionType) return;
    setLoading(true);
    incidentsApi.getAll({ incident_type_id: inundacionType.id, limit: 500 })
      .then(r => setAll(r.data.data || r.data || []))
      .finally(() => setLoading(false));
  }, [inundacionType]);

  useEffect(() => { load(); }, [load]);

  // Filtrado cliente
  const filtered = all.filter(i => {
    if (filterStatus === 'activos'     && !isActivo(i.status))   return false;
    if (filterStatus === 'controlados' && !CONTROL_STATUSES.includes(i.status)) return false;
    if (filterStatus === 'cerrados'    && !isCerrado(i.status))  return false;
    if (filterProv && String(i.province_id) !== String(filterProv)) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      if (!i.title?.toLowerCase().includes(q) && !i.incident_number?.toLowerCase().includes(q) && !i.address?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Stats sobre TODOS (no filtrados)
  const totalActivos     = all.filter(i => isActivo(i.status)).length;
  const totalControlados = all.filter(i => CONTROL_STATUSES.includes(i.status)).length;
  const totalCerrados    = all.filter(i => isCerrado(i.status)).length;
  const totalAfectados   = all.reduce((s, i) => s + (i.affected_persons_count || 0), 0);
  const totalEvacuados   = all.reduce((s, i) => s + (i.evacuated_count || 0), 0);

  const sel = { padding:'0.35rem 0.6rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.8rem', background:'#fff' };

  if (!inundacionType && !loading) {
    return (
      <div style={{ textAlign:'center', padding:'3rem', color:'#64748b' }}>
        <div style={{ fontSize:'3rem' }}>🌊</div>
        <p style={{ marginTop:'1rem' }}>No se encontró el tipo de incidente "Inundación" en el sistema.</p>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem' }}>
        <div>
          <h1 style={{ fontSize:'1.5rem', fontWeight:700, display:'flex', alignItems:'center', gap:'0.5rem' }}>
            🌊 Inundados
          </h1>
          <p style={{ fontSize:'0.8rem', color:'#64748b', marginTop:2 }}>
            Seguimiento de incidentes de inundación · {all.length} registros en total
          </p>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {loading && <span style={{ fontSize:'0.8rem', color:'#94a3b8' }}>⟳ Actualizando...</span>}
          {canWrite && (
            <Link to="/incidents/new">
              <Button size="sm">➕ Nuevo Incidente</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Cards de resumen */}
      <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap' }}>
        <StatCard icon="🔴" label="Activos"     value={totalActivos}     color="#dc2626" bg="#fee2e2" />
        <StatCard icon="🟡" label="Controlados" value={totalControlados} color="#d97706" bg="#fef3c7" />
        <StatCard icon="✅" label="Cerrados"    value={totalCerrados}    color="#16a34a" bg="#dcfce7" />
        <StatCard icon="👥" label="Afectados"   value={totalAfectados.toLocaleString()} color="#1d4ed8" bg="#eff6ff" />
        <StatCard icon="🏠" label="Evacuados"   value={totalEvacuados.toLocaleString()} color="#7c3aed" bg="#ede9fe" />
      </div>

      {/* Barra de filtros y toggle vista */}
      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'0.65rem 1rem', display:'flex', flexWrap:'wrap', gap:'0.6rem', alignItems:'center' }}>
        <select style={sel} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="activos">Activos</option>
          <option value="controlados">Controlados</option>
          <option value="cerrados">Cerrados</option>
        </select>

        <select style={sel} value={filterProv} onChange={e => setFilterProv(e.target.value)}>
          <option value="">Todas las provincias</option>
          {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <input
          style={{ ...sel, flex:1, minWidth:160 }}
          placeholder="Buscar por número, título, dirección..."
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
        />

        <div style={{ marginLeft:'auto', display:'flex', gap:'0.35rem' }}>
          <button onClick={() => setViewMode('tabla')} style={{ padding:'0.35rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.8rem', cursor:'pointer', background: viewMode === 'tabla' ? '#1d4ed8' : '#fff', color: viewMode === 'tabla' ? '#fff' : '#374151' }}>
            ☰ Tabla
          </button>
          <button onClick={() => setViewMode('mapa')} style={{ padding:'0.35rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.8rem', cursor:'pointer', background: viewMode === 'mapa' ? '#1d4ed8' : '#fff', color: viewMode === 'mapa' ? '#fff' : '#374151' }}>
            🗺️ Mapa
          </button>
        </div>
      </div>

      {/* Vista tabla */}
      {viewMode === 'tabla' && (
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:'2rem', textAlign:'center', color:'#94a3b8' }}>Cargando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:'2rem', textAlign:'center', color:'#94a3b8' }}>
              No hay inundaciones{filterStatus !== 'todos' ? ` con estado "${filterStatus}"` : ''}.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8125rem' }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
                    {['#','Título','Ubicación','Afectados','Evacuados','Estado','Fecha inicio','Acciones'].map(h => (
                      <th key={h} style={{ padding:'0.6rem 0.875rem', textAlign:'left', fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inc, idx) => (
                    <tr key={inc.uuid} style={{ borderBottom:'1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding:'0.6rem 0.875rem', whiteSpace:'nowrap' }}>
                        <Link to={`/incidents/${inc.uuid}`} style={{ color:'#1d4ed8', fontWeight:600, textDecoration:'none' }}>
                          {inc.incident_number}
                        </Link>
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem', maxWidth:200 }}>
                        <div style={{ fontWeight:500, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inc.title}</div>
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem', color:'#475569', maxWidth:180 }}>
                        <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {[inc.locality_name, inc.partido_name, inc.province_name].filter(Boolean).join(', ') || inc.address || '—'}
                        </div>
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem', textAlign:'center', fontWeight:600, color: inc.affected_persons_count > 0 ? '#dc2626' : '#94a3b8' }}>
                        {inc.affected_persons_count || 0}
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem', textAlign:'center', fontWeight:600, color: inc.evacuated_count > 0 ? '#7c3aed' : '#94a3b8' }}>
                        {inc.evacuated_count || 0}
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem' }}>
                        <StatusBadge status={inc.status} />
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem', color:'#64748b', whiteSpace:'nowrap' }}>
                        {inc.started_at ? format(new Date(inc.started_at), 'dd/MM/yy HH:mm', { locale: es }) : '—'}
                      </td>
                      <td style={{ padding:'0.6rem 0.875rem' }}>
                        <div style={{ display:'flex', gap:'0.35rem' }}>
                          <Link to={`/incidents/${inc.uuid}`}>
                            <Button size="sm" variant="ghost">Ver</Button>
                          </Link>
                          {canWrite && !isCerrado(inc.status) && (
                            <Button size="sm" variant="secondary" onClick={() => setModalTarget(inc)}>
                              Estado
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding:'0.6rem 0.875rem', borderTop:'1px solid #f1f5f9', fontSize:'0.75rem', color:'#94a3b8' }}>
                Mostrando {filtered.length} de {all.length} inundaciones
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vista mapa */}
      {viewMode === 'mapa' && (
        <div style={{ height: 'calc(100vh - 56px - 20rem)', minHeight:400, borderRadius:'var(--radius)', overflow:'hidden', boxShadow:'var(--shadow)' }}>
          <MapContainer center={[-38.4161, -63.6167]} zoom={5} style={{ height:'100%', width:'100%' }} zoomControl>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
              maxZoom={19}
            />
            <FloodCluster incidents={filtered} />
          </MapContainer>
        </div>
      )}

      {/* Modal de estado */}
      {modalTarget && (
        <StatusModal
          incident={modalTarget}
          onClose={() => setModalTarget(null)}
          onSaved={() => { setModalTarget(null); load(); }}
        />
      )}
    </div>
  );
}
