import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  MapContainer, TileLayer, Marker, Popup,
  ZoomControl, ScaleControl, useMapEvents,
} from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore from '../store/geoStore';
import Button from '../components/common/Button';

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
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color || '#FF4500'};border:2px solid rgba(0,0,0,0.3);border-radius:50%;"></div>`,
    className: '',
    iconSize:  [size, size],
    iconAnchor:[size / 2, size / 2],
  });
}

function makeApproxIcon() {
  return L.divIcon({
    html: `<div style="
      width:40px;height:40px;background:#f97316;
      border:3px solid #fff;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;color:#fff;font-weight:bold;
      box-shadow:0 0 18px rgba(249,115,22,0.9);
    ">?</div>`,
    className: '',
    iconSize:  [40, 40],
    iconAnchor:[20, 20],
  });
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const PRIORITIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];

const STATUS_LABEL = {
  RECIBIDO:'Recibido', EN_CAMINO:'En Camino', EN_ESCENA:'En Escena',
  CONTROLADO:'Controlado', CERRADO:'Cerrado', CANCELADO:'Cancelado',
};

// ─── Estilos ──────────────────────────────────────────────────────────────────
const card  = { background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.25rem' };
const fld   = { display:'flex', flexDirection:'column', gap:'0.35rem', marginBottom:'0.85rem' };
const lbl   = { fontSize:'0.8rem', fontWeight:600, color:'#374151' };
const inp   = { padding:'0.5rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem', background:'#fff', width:'100%', boxSizing:'border-box' };
const sel   = { ...inp, cursor:'pointer' };
const tarea = { ...inp, resize:'vertical', minHeight:80 };

// ─── Componente ───────────────────────────────────────────────────────────────
export default function CargaTelefonista() {
  const { incidentTypes, fetchIncidentTypes } = useGeoStore();
  const [mapPoints,    setMapPoints]    = useState([]);
  const [loadingPts,   setLoadingPts]   = useState(true);

  const [loc,          setLoc]          = useState(null);
  const [form,         setForm]         = useState({ incident_type_id:'', description:'', priority:'ALTA', address:'' });
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [created,      setCreated]      = useState(null);

  useEffect(() => {
    fetchIncidentTypes();
    loadPoints();
  }, []);

  async function loadPoints() {
    setLoadingPts(true);
    try { const r = await incidentsApi.getMapPoints({}); setMapPoints(r.data); }
    finally { setLoadingPts(false); }
  }

  const handleMapClick = useCallback((latlng) => {
    setLoc(latlng);
    setError('');
  }, []);

  async function handleSubmit() {
    if (!form.incident_type_id) { setError('Seleccione el tipo de incidente'); return; }
    if (!form.description.trim()) { setError('Ingrese una descripción'); return; }
    if (!loc)                     { setError('Haga click en el mapa para marcar la ubicación'); return; }

    setLoading(true);
    setError('');
    try {
      const typeName = incidentTypes.find(t => String(t.id) === String(form.incident_type_id))?.name || 'Incidente';
      const res = await incidentsApi.create({
        incident_type_id: Number(form.incident_type_id),
        title:            `${typeName} — Telefonista`,
        description:      form.description,
        priority:         form.priority,
        latitude:         loc.lat,
        longitude:        loc.lng,
        address:          form.address || undefined,
        status:           'RECIBIDO',
      });
      setCreated(res.data);
      setLoc(null);
      setForm({ incident_type_id:'', description:'', priority:'ALTA', address:'' });
      await loadPoints();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al registrar el incidente');
    } finally {
      setLoading(false);
    }
  }

  function handleNuevoRegistro() {
    setCreated(null);
    setError('');
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 56px - 3rem)', gap:'0.75rem' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h1 style={{ fontSize:'1.5rem', fontWeight:700, margin:0 }}>📞 Central Telefonista</h1>
          <p style={{ fontSize:'0.8125rem', color:'#64748b', margin:'0.15rem 0 0' }}>
            Registre llamadas entrantes y marque la ubicación aproximada en el mapa
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          {loadingPts && <span style={{ fontSize:'0.8rem', color:'#94a3b8' }}>⟳ Actualizando...</span>}
          <span style={{ fontSize:'0.8rem', color:'#64748b', background:'#f1f5f9', padding:'0.25rem 0.75rem', borderRadius:'9999px' }}>
            {mapPoints.length} incidentes
          </span>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{ flex:1, display:'flex', gap:'1rem', overflow:'hidden', minHeight:0 }}>

        {/* Panel formulario */}
        <div style={{ width:380, flexShrink:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.75rem' }}>

          {/* Instrucciones */}
          <div style={{ ...card, padding:'0.875rem 1rem', background:'#fffbeb', border:'1px solid #fde68a' }}>
            <div style={{ fontSize:'0.8rem', color:'#92400e', lineHeight:1.6 }}>
              <strong>① </strong>Haga click en el mapa para marcar la ubicación aproximada<br/>
              <strong>② </strong>Complete el tipo y descripción del incidente<br/>
              <strong>③ </strong>Presione <strong>Registrar</strong> para crear el incidente
            </div>
          </div>

          {/* Éxito: último incidente registrado */}
          {created && (
            <div style={{ ...card, background:'#f0fdf4', border:'1px solid #86efac' }}>
              <div style={{ fontWeight:700, color:'#15803d', fontSize:'0.9rem', marginBottom:'0.5rem' }}>
                ✓ Incidente registrado
              </div>
              <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#166534', letterSpacing:'0.03em', marginBottom:'0.4rem' }}>
                {created.incident_number}
              </div>
              <div style={{ fontSize:'0.8rem', color:'#166534', marginBottom:'0.75rem' }}>
                {created.title}
              </div>
              <div style={{ display:'flex', gap:'0.5rem' }}>
                <Link to={`/incidents/${created.uuid}`}>
                  <Button size="sm" variant="secondary">Ver detalle →</Button>
                </Link>
                <Button size="sm" onClick={handleNuevoRegistro}>
                  + Nuevo registro
                </Button>
              </div>
            </div>
          )}

          {/* Formulario */}
          {!created && (
            <div style={card}>
              {/* Indicador de ubicación */}
              {loc ? (
                <div style={{ padding:'0.5rem 0.75rem', background:'#fef3c7', border:'1px solid #f59e0b', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#92400e', marginBottom:'0.85rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>📍 {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span>
                  <button
                    onClick={() => setLoc(null)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#92400e', fontWeight:700, fontSize:'1rem', lineHeight:1 }}
                  >✕</button>
                </div>
              ) : (
                <div style={{ padding:'0.625rem 0.75rem', background:'#fff7ed', border:'1px dashed #fb923c', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#c2410c', textAlign:'center', marginBottom:'0.85rem' }}>
                  ← Haga click en el mapa para marcar la ubicación
                </div>
              )}

              {/* Tipo */}
              <div style={fld}>
                <label style={lbl}>Tipo de Incidente *</label>
                <select
                  style={sel}
                  value={form.incident_type_id}
                  onChange={e => setForm(f => ({ ...f, incident_type_id: e.target.value }))}
                >
                  <option value="">Seleccionar tipo...</option>
                  {incidentTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
                  ))}
                </select>
              </div>

              {/* Descripción */}
              <div style={fld}>
                <label style={lbl}>Descripción de la llamada *</label>
                <textarea
                  style={tarea}
                  placeholder="Describa el incidente reportado por el llamante..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              {/* Prioridad + Dirección */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 0.875rem' }}>
                <div style={fld}>
                  <label style={lbl}>Prioridad</label>
                  <select style={sel} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={fld}>
                  <label style={lbl}>Dirección / Referencia</label>
                  <input
                    style={inp}
                    placeholder="Ej: Av. San Martín 123"
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  />
                </div>
              </div>

              {error && (
                <div style={{ padding:'0.5rem 0.75rem', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'var(--radius)', fontSize:'0.8rem', color:'#991b1b', marginBottom:'0.75rem' }}>
                  {error}
                </div>
              )}

              <Button onClick={handleSubmit} isLoading={loading} style={{ width:'100%' }}>
                Registrar Incidente
              </Button>
            </div>
          )}

          {/* Lista reciente de incidentes del mapa */}
          {mapPoints.length > 0 && (
            <div style={{ ...card, padding:'0.875rem 1rem' }}>
              <div style={{ fontSize:'0.8rem', fontWeight:600, color:'#374151', marginBottom:'0.6rem' }}>
                Incidentes activos en mapa ({mapPoints.filter(p => !['CERRADO','CANCELADO'].includes(p.status)).length})
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', maxHeight:200, overflowY:'auto' }}>
                {mapPoints
                  .filter(p => !['CERRADO','CANCELADO'].includes(p.status))
                  .slice(0, 15)
                  .map(p => (
                    <div key={p.uuid} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.3rem 0', borderBottom:'1px solid #f1f5f9', fontSize:'0.78rem' }}>
                      <span style={{ width:10, height:10, borderRadius:'50%', background: p.color_hex || '#94a3b8', flexShrink:0, display:'inline-block', border:'1px solid rgba(0,0,0,0.15)' }} />
                      <span style={{ color:'#374151', fontWeight:600, flexShrink:0 }}>{p.incident_number}</span>
                      <span style={{ color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.title}</span>
                      <span style={{ color:'#94a3b8', flexShrink:0 }}>{STATUS_LABEL[p.status] || p.status}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        {/* Mapa */}
        <div style={{ flex:1, borderRadius:'var(--radius)', overflow:'hidden', boxShadow:'var(--shadow)', position:'relative', minHeight:0 }}>
          <div style={{
            position:'absolute', top:12, left:12, zIndex:1000,
            background: loc ? 'rgba(16,163,74,0.9)' : 'rgba(249,115,22,0.92)',
            color:'#fff', padding:'0.35rem 0.85rem',
            borderRadius:'var(--radius)', fontSize:'0.75rem', fontWeight:600,
            pointerEvents:'none',
          }}>
            {loc ? '✓ Ubicación marcada — puede ajustarla haciendo click de nuevo' : 'Click en el mapa → marcar ubicación aproximada'}
          </div>

          <MapContainer
            center={[-38.4161, -63.6167]}
            zoom={5}
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

            {/* Incidentes existentes */}
            <MarkerClusterGroup chunkedLoading maxClusterRadius={50} showCoverageOnHover={false}>
              {mapPoints.map(p => (
                <Marker
                  key={p.uuid}
                  position={[Number(p.latitude), Number(p.longitude)]}
                  icon={makeIncidentIcon(p.color_hex, p.priority)}
                >
                  <Popup minWidth={190}>
                    <div>
                      <div style={{ fontWeight:700, fontSize:'0.8rem' }}>{p.incident_number}</div>
                      <div style={{ fontSize:'0.78rem', color:'#475569', margin:'0.2rem 0' }}>{p.title}</div>
                      <div style={{ fontSize:'0.74rem', color:'#64748b' }}>{p.type_name} · {STATUS_LABEL[p.status] || p.status}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>

            {/* Marcador de ubicación aproximada */}
            {loc && (
              <Marker position={[loc.lat, loc.lng]} icon={makeApproxIcon()}>
                <Popup>
                  <div>
                    <div style={{ fontWeight:600, fontSize:'0.8rem', color:'#ea580c' }}>Ubicación aproximada</div>
                    <div style={{ fontSize:'0.74rem', color:'#64748b', marginTop:'0.2rem' }}>
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
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
