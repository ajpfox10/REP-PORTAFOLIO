import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  MapContainer, TileLayer, Marker, Popup,
  ZoomControl, ScaleControl, useMapEvents, useMap,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore from '../store/geoStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import Button from '../components/common/Button';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Leaflet icon fix ──────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── Iconos ───────────────────────────────────────────────────────────────────
function makeIncidentIcon(color, priority) {
  const size = priority === 'CRITICA' ? 20 : priority === 'ALTA' ? 16 : 12;
  const shadow = priority === 'CRITICA' ? '0 0 7px rgba(255,0,0,0.7)' : 'none';
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color || '#FF4500'};border:2px solid rgba(0,0,0,0.3);border-radius:50%;box-shadow:${shadow};"></div>`,
    className: '',
    iconSize:  [size, size],
    iconAnchor:[size / 2, size / 2],
  });
}

function makeSelectedIcon() {
  return L.divIcon({
    html: `<div style="
      width:34px;height:34px;background:#1d4ed8;
      border:3px solid #fff;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:18px;
      box-shadow:0 0 16px rgba(29,78,216,0.9);
    ">★</div>`,
    className: '',
    iconSize:  [34, 34],
    iconAnchor:[17, 17],
  });
}

function makeNewLocIcon() {
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;background:#16a34a;
      border:3px solid #fff;border-radius:50%;
      box-shadow:0 0 14px rgba(22,163,74,0.9);
    "></div>`,
    className: '',
    iconSize:  [28, 28],
    iconAnchor:[14, 14],
  });
}

// ─── Map helpers ──────────────────────────────────────────────────────────────
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
}

function MapFlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 14, { duration: 1.1 });
  }, [target, map]);
  return null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const ACTIVE_STATUSES = new Set(['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO']);

const STATUS_LABELS = {
  RECIBIDO:'Recibido', EN_CAMINO:'En Camino', EN_ESCENA:'En Escena',
  CONTROLADO:'Controlado', CERRADO:'Cerrado', CANCELADO:'Cancelado',
};

const STATUS_COLORS = {
  RECIBIDO:   '#3b82f6',
  EN_CAMINO:  '#f59e0b',
  EN_ESCENA:  '#ef4444',
  CONTROLADO: '#eab308',
  CERRADO:    '#22c55e',
  CANCELADO:  '#94a3b8',
};

// ─── Estilos ──────────────────────────────────────────────────────────────────
const card  = { background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1rem' };
const fld   = { display:'flex', flexDirection:'column', gap:'0.35rem', marginBottom:'0.8rem' };
const lbl   = { fontSize:'0.8rem', fontWeight:600, color:'#374151' };
const inp   = { padding:'0.5rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem', background:'#fff', width:'100%', boxSizing:'border-box' };
const sel   = { ...inp, cursor:'pointer' };
const tarea = { ...inp, resize:'vertical', minHeight:72 };

// ─── Componente ───────────────────────────────────────────────────────────────
export default function CargaChofer() {
  const { incidentTypes, fetchIncidentTypes } = useGeoStore();
  const [mapPoints,    setMapPoints]    = useState([]);
  const [activeIncs,   setActiveIncs]   = useState([]);
  const [loadingPts,   setLoadingPts]   = useState(true);

  const [selectedInc,  setSelectedInc]  = useState(null);
  const [newLoc,       setNewLoc]       = useState(null);
  const [comment,      setComment]      = useState('');
  const [newStatus,    setNewStatus]    = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');
  const [flyTarget,    setFlyTarget]    = useState(null);

  useEffect(() => {
    fetchIncidentTypes();
    loadPoints();
  }, []);

  async function loadPoints() {
    setLoadingPts(true);
    try {
      const r = await incidentsApi.getMapPoints({});
      const pts = r.data;
      setMapPoints(pts);
      setActiveIncs(pts.filter(p => ACTIVE_STATUSES.has(p.status)));
    } finally {
      setLoadingPts(false);
    }
  }

  const handleMapClick = useCallback((latlng) => {
    if (selectedInc) {
      setNewLoc(latlng);
      setError('');
    }
  }, [selectedInc]);

  function selectIncident(inc) {
    setSelectedInc(inc);
    setNewLoc(null);
    setComment('');
    setNewStatus(inc?.status || '');
    setSuccess('');
    setError('');
    if (inc?.latitude && inc?.longitude) {
      setFlyTarget({ lat: Number(inc.latitude), lng: Number(inc.longitude) });
    }
  }

  function handleGPS() {
    if (!navigator.geolocation) { setError('GPS no disponible en este dispositivo'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setNewLoc(loc);
        setFlyTarget(loc);
        setError('');
      },
      () => setError('No se pudo obtener la ubicación GPS')
    );
  }

  async function handleSubmit() {
    if (!selectedInc) { setError('Seleccione un incidente'); return; }
    if (!comment.trim() && !newLoc && newStatus === selectedInc.status) {
      setError('Ingrese una novedad, nueva ubicación o cambio de estado');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await incidentsApi.addNote(selectedInc.uuid, {
        latitude:  newLoc ? newLoc.lat   : undefined,
        longitude: newLoc ? newLoc.lng   : undefined,
        notes:     comment || undefined,
        status:    newStatus !== selectedInc.status ? newStatus : undefined,
      });
      setSuccess(`Incidente ${selectedInc.incident_number} actualizado correctamente`);
      setComment('');
      setNewLoc(null);
      await loadPoints();
      // Refrescar el incidente seleccionado
      const updated = await incidentsApi.getMapPoints({});
      const updatedInc = updated.data.find(p => p.uuid === selectedInc.uuid);
      if (updatedInc) {
        setSelectedInc(updatedInc);
        setNewStatus(updatedInc.status);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Error al actualizar el incidente');
    } finally {
      setLoading(false);
    }
  }

  // Dot status indicator
  function StatusDot({ status }) {
    return (
      <span style={{
        width:8, height:8, borderRadius:'50%', flexShrink:0, display:'inline-block',
        background: STATUS_COLORS[status] || '#94a3b8',
        boxShadow:`0 0 4px ${STATUS_COLORS[status] || '#94a3b8'}`,
      }} />
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 56px - 3rem)', gap:'0.75rem' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h1 style={{ fontSize:'1.5rem', fontWeight:700, margin:0 }}>🚗 Panel Chofer</h1>
          <p style={{ fontSize:'0.8125rem', color:'#64748b', margin:'0.15rem 0 0' }}>
            Seleccione su incidente asignado, actualice la ubicación y cargue novedades
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          {loadingPts && <span style={{ fontSize:'0.8rem', color:'#94a3b8' }}>⟳ Actualizando...</span>}
          <span style={{ fontSize:'0.8rem', color:'#64748b', background:'#f1f5f9', padding:'0.25rem 0.75rem', borderRadius:'9999px' }}>
            {activeIncs.length} activos
          </span>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{ flex:1, display:'flex', gap:'1rem', overflow:'hidden', minHeight:0 }}>

        {/* Panel izquierdo */}
        <div style={{ width:390, flexShrink:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.75rem' }}>

          {/* Instrucciones */}
          <div style={{ ...card, padding:'0.8rem 1rem', background:'#eff6ff', border:'1px solid #bfdbfe' }}>
            <div style={{ fontSize:'0.8rem', color:'#1e3a8a', lineHeight:1.6 }}>
              <strong>① </strong>Seleccione el incidente asignado<br/>
              <strong>② </strong>Use el GPS o haga click en el mapa para actualizar la ubicación<br/>
              <strong>③ </strong>Cargue una novedad y/o cambie el estado, luego confirme
            </div>
          </div>

          {/* Selector de incidente */}
          <div style={card}>
            <div style={{ ...fld, marginBottom:'0.5rem' }}>
              <label style={lbl}>Incidente Asignado</label>
              <select
                style={sel}
                value={selectedInc?.uuid || ''}
                onChange={e => {
                  const inc = activeIncs.find(i => i.uuid === e.target.value) || null;
                  selectIncident(inc);
                }}
              >
                <option value="">— Seleccionar incidente activo —</option>
                {activeIncs.map(inc => (
                  <option key={inc.uuid} value={inc.uuid}>
                    {inc.incident_number} · {inc.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Detalle del incidente seleccionado */}
            {selectedInc && (
              <div style={{ padding:'0.75rem', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'var(--radius)', marginTop:'0.5rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', marginBottom:'0.4rem' }}>
                  <span style={{ fontWeight:700, color:'#0f172a', fontSize:'0.9rem' }}>{selectedInc.incident_number}</span>
                  <div style={{ display:'flex', gap:'0.3rem', flexShrink:0 }}>
                    <StatusBadge status={selectedInc.status} />
                    <PriorityBadge priority={selectedInc.priority} />
                  </div>
                </div>
                <div style={{ fontSize:'0.83rem', color:'#334155', marginBottom:'0.25rem' }}>{selectedInc.title}</div>
                <div style={{ fontSize:'0.78rem', color:'#64748b' }}>{selectedInc.type_name}</div>
                {selectedInc.started_at && (
                  <div style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:'0.25rem' }}>
                    Iniciado: {format(new Date(selectedInc.started_at), 'dd/MM/yy HH:mm', { locale: es })}
                  </div>
                )}
                {selectedInc.latitude && selectedInc.longitude && (
                  <div style={{ fontSize:'0.74rem', color:'#94a3b8', marginTop:'0.15rem' }}>
                    Ubicación actual: {Number(selectedInc.latitude).toFixed(5)}, {Number(selectedInc.longitude).toFixed(5)}
                  </div>
                )}
                <div style={{ marginTop:'0.5rem' }}>
                  <Link to={`/incidents/${selectedInc.uuid}`} style={{ fontSize:'0.78rem', color:'#1d4ed8' }}>
                    Ver detalle completo →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Acciones (visible solo si hay incidente seleccionado) */}
          {selectedInc && (
            <div style={card}>
              {/* GPS / mapa */}
              <div style={{ marginBottom:'0.85rem' }}>
                <label style={{ ...lbl, display:'block', marginBottom:'0.5rem' }}>Actualizar Ubicación</label>
                <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.5rem' }}>
                  <Button size="sm" variant="secondary" onClick={handleGPS} style={{ flexShrink:0 }}>
                    📡 Usar GPS
                  </Button>
                  <span style={{ fontSize:'0.75rem', color:'#94a3b8' }}>o haga click en el mapa</span>
                </div>

                {newLoc ? (
                  <div style={{ padding:'0.45rem 0.75rem', background:'#dcfce7', border:'1px solid #86efac', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#166534', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span>📍 Nueva: {newLoc.lat.toFixed(5)}, {newLoc.lng.toFixed(5)}</span>
                    <button onClick={() => setNewLoc(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#166534', fontWeight:700, fontSize:'1rem', lineHeight:1 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ padding:'0.45rem 0.75rem', background:'#f8fafc', border:'1px dashed #cbd5e1', borderRadius:'var(--radius)', fontSize:'0.78rem', color:'#94a3b8', textAlign:'center' }}>
                    Sin nueva ubicación (se mantiene la actual)
                  </div>
                )}
              </div>

              {/* Estado */}
              <div style={fld}>
                <label style={lbl}>Estado del Incidente</label>
                <select
                  style={sel}
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                {newStatus !== selectedInc.status && (
                  <span style={{ fontSize:'0.74rem', color:'#d97706' }}>
                    Cambiará de <strong>{STATUS_LABELS[selectedInc.status]}</strong> → <strong>{STATUS_LABELS[newStatus]}</strong>
                  </span>
                )}
              </div>

              {/* Novedad */}
              <div style={fld}>
                <label style={lbl}>Novedad / Comentario</label>
                <textarea
                  style={tarea}
                  placeholder="Ej: Unidad llegó al lugar. Se evalúa la situación con bomberos..."
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
              </div>

              {error && (
                <div style={{ padding:'0.5rem 0.75rem', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#991b1b', marginBottom:'0.75rem' }}>
                  {error}
                </div>
              )}
              {success && (
                <div style={{ padding:'0.5rem 0.75rem', background:'#dcfce7', border:'1px solid #86efac', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#166534', marginBottom:'0.75rem' }}>
                  ✓ {success}
                </div>
              )}

              <Button onClick={handleSubmit} isLoading={loading} style={{ width:'100%' }}>
                Confirmar Actualización
              </Button>
            </div>
          )}

          {/* Lista todos los activos */}
          {!selectedInc && activeIncs.length > 0 && (
            <div style={{ ...card, padding:'0.875rem 1rem' }}>
              <div style={{ fontSize:'0.8rem', fontWeight:600, color:'#374151', marginBottom:'0.6rem' }}>
                Todos los incidentes activos
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem', maxHeight:260, overflowY:'auto' }}>
                {activeIncs.map(p => (
                  <button
                    key={p.uuid}
                    onClick={() => selectIncident(p)}
                    style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.4rem 0.5rem', border:'1px solid #e2e8f0', borderRadius:'var(--radius)', background:'#fff', cursor:'pointer', textAlign:'left', fontSize:'0.78rem' }}
                    onMouseOver={e  => e.currentTarget.style.background = '#f8fafc'}
                    onMouseOut={e   => e.currentTarget.style.background = '#fff'}
                  >
                    <StatusDot status={p.status} />
                    <span style={{ color:'#374151', fontWeight:600, flexShrink:0 }}>{p.incident_number}</span>
                    <span style={{ color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.title}</span>
                    <span style={{ color: STATUS_COLORS[p.status] || '#94a3b8', flexShrink:0, fontWeight:500 }}>{STATUS_LABELS[p.status] || p.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mapa */}
        <div style={{ flex:1, borderRadius:'var(--radius)', overflow:'hidden', boxShadow:'var(--shadow)', position:'relative', minHeight:0 }}>

          {/* Overlay hint */}
          {selectedInc && !newLoc && (
            <div style={{ position:'absolute', top:12, left:12, zIndex:1000, background:'rgba(29,78,216,0.9)', color:'#fff', padding:'0.35rem 0.85rem', borderRadius:'var(--radius)', fontSize:'0.75rem', fontWeight:600, pointerEvents:'none' }}>
              Click en el mapa → actualizar ubicación del incidente
            </div>
          )}
          {selectedInc && newLoc && (
            <div style={{ position:'absolute', top:12, left:12, zIndex:1000, background:'rgba(22,163,74,0.9)', color:'#fff', padding:'0.35rem 0.85rem', borderRadius:'var(--radius)', fontSize:'0.75rem', fontWeight:600, pointerEvents:'none' }}>
              ✓ Nueva ubicación marcada — puede ajustarla haciendo click de nuevo
            </div>
          )}
          {!selectedInc && (
            <div style={{ position:'absolute', top:12, left:12, zIndex:1000, background:'rgba(100,116,139,0.85)', color:'#fff', padding:'0.35rem 0.85rem', borderRadius:'var(--radius)', fontSize:'0.75rem', fontWeight:600, pointerEvents:'none' }}>
              Seleccione un incidente para activar el mapa
            </div>
          )}

          <MapContainer
            center={[-34.770, -58.630]}
            zoom={11}
            style={{ height:'100%', width:'100%' }}
            zoomControl={false}
          >
            <ZoomControl position="topright" />
            <ScaleControl position="bottomright" imperial={false} />
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
            <MapClickHandler onMapClick={handleMapClick} />
            <MapFlyTo target={flyTarget} />

            {/* Todos los incidentes */}
            <MarkerClusterGroup chunkedLoading maxClusterRadius={50} showCoverageOnHover={false}>
              {mapPoints
                .filter(p => !selectedInc || p.uuid !== selectedInc.uuid)
                .map(p => (
                  <Marker
                    key={p.uuid}
                    position={[Number(p.latitude), Number(p.longitude)]}
                    icon={makeIncidentIcon(p.color_hex, p.priority)}
                  >
                    <Popup minWidth={200}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:'0.8rem' }}>{p.incident_number}</div>
                        <div style={{ fontSize:'0.78rem', color:'#475569', margin:'0.2rem 0' }}>{p.title}</div>
                        <div style={{ fontSize:'0.74rem', color:'#64748b' }}>{p.type_name} · {STATUS_LABELS[p.status] || p.status}</div>
                        <button
                          onClick={() => {
                            const inc = activeIncs.find(i => i.uuid === p.uuid);
                            if (inc) selectIncident(inc);
                          }}
                          style={{ marginTop:'0.35rem', fontSize:'0.78rem', color:'#1d4ed8', background:'none', border:'none', cursor:'pointer', padding:0 }}
                        >
                          Seleccionar este incidente →
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))
              }
            </MarkerClusterGroup>

            {/* Incidente seleccionado: ubicación actual */}
            {selectedInc && selectedInc.latitude && selectedInc.longitude && (
              <Marker
                position={[Number(selectedInc.latitude), Number(selectedInc.longitude)]}
                icon={makeSelectedIcon()}
              >
                <Popup>
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.8rem', color:'#1e3a8a' }}>★ {selectedInc.incident_number}</div>
                    <div style={{ fontSize:'0.78rem', color:'#475569', margin:'0.2rem 0' }}>{selectedInc.title}</div>
                    <div style={{ fontSize:'0.74rem', color:'#94a3b8' }}>Ubicación registrada</div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Nueva ubicación (GPS o click) */}
            {newLoc && (
              <Marker position={[newLoc.lat, newLoc.lng]} icon={makeNewLocIcon()}>
                <Popup>
                  <div>
                    <div style={{ fontWeight:600, fontSize:'0.8rem', color:'#16a34a' }}>Nueva ubicación</div>
                    <div style={{ fontSize:'0.74rem', color:'#64748b', marginTop:'0.2rem' }}>
                      {newLoc.lat.toFixed(5)}, {newLoc.lng.toFixed(5)}
                    </div>
                    <div style={{ fontSize:'0.74rem', color:'#94a3b8', marginTop:'0.1rem' }}>Click en el mapa para ajustar</div>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

// ─── StatusDot helper (fuera del componente para reutilizar) ──────────────────
const STATUS_COLORS_OBJ = {
  RECIBIDO:'#3b82f6', EN_CAMINO:'#f59e0b', EN_ESCENA:'#ef4444',
  CONTROLADO:'#eab308', CERRADO:'#22c55e', CANCELADO:'#94a3b8',
};

function StatusDot({ status }) {
  return (
    <span style={{
      width:8, height:8, borderRadius:'50%', flexShrink:0, display:'inline-block',
      background: STATUS_COLORS_OBJ[status] || '#94a3b8',
      boxShadow:`0 0 4px ${STATUS_COLORS_OBJ[status] || '#94a3b8'}`,
    }} />
  );
}
