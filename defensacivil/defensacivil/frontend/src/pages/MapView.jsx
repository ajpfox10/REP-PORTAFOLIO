import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  MapContainer, TileLayer, Marker, Popup,
  LayersControl, ScaleControl, ZoomControl,
  useMap, useMapEvents, GeoJSON,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { incidentsApi } from '../api/incidents.api';
import { geoApi } from '../api/geo.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const PROVINCE_CENTERS = {
  'AR-C': { lat:-34.6037, lng:-58.3816, zoom:13 },
  'AR-B': { lat:-36.6769, lng:-60.5588, zoom:8  },
  'AR-K': { lat:-28.4696, lng:-65.7795, zoom:8  },
  'AR-H': { lat:-26.0000, lng:-61.0000, zoom:8  },
  'AR-U': { lat:-43.2930, lng:-65.1023, zoom:7  },
  'AR-X': { lat:-31.4135, lng:-64.1811, zoom:8  },
  'AR-W': { lat:-28.4698, lng:-58.8341, zoom:8  },
  'AR-E': { lat:-31.7333, lng:-60.5167, zoom:8  },
  'AR-P': { lat:-24.8941, lng:-59.9290, zoom:8  },
  'AR-Y': { lat:-24.1858, lng:-65.2995, zoom:9  },
  'AR-L': { lat:-36.6227, lng:-64.2900, zoom:7  },
  'AR-F': { lat:-29.4127, lng:-66.8557, zoom:8  },
  'AR-M': { lat:-32.8908, lng:-68.8272, zoom:9  },
  'AR-N': { lat:-26.9478, lng:-55.1304, zoom:8  },
  'AR-Q': { lat:-38.9516, lng:-68.0591, zoom:8  },
  'AR-R': { lat:-40.8135, lng:-63.0000, zoom:7  },
  'AR-A': { lat:-24.7821, lng:-65.4232, zoom:9  },
  'AR-J': { lat:-31.5375, lng:-68.5364, zoom:9  },
  'AR-D': { lat:-33.2954, lng:-66.3356, zoom:8  },
  'AR-Z': { lat:-51.6230, lng:-69.2168, zoom:7  },
  'AR-S': { lat:-30.7069, lng:-60.9498, zoom:8  },
  'AR-G': { lat:-27.7834, lng:-64.2643, zoom:8  },
  'AR-V': { lat:-54.8019, lng:-68.3030, zoom:9  },
  'AR-T': { lat:-26.8241, lng:-65.2226, zoom:10 },
};

// ─── Iconos ───────────────────────────────────────────────────────────────────

function makeIncidentIcon(color, priority) {
  const size   = priority === 'CRITICA' ? 22 : priority === 'ALTA' ? 18 : 14;
  const border = priority === 'CRITICA' ? '3px solid #fff' : '2px solid rgba(0,0,0,0.35)';
  const shadow = priority === 'CRITICA' ? '0 0 8px rgba(255,0,0,0.8)' : 'none';
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50%;box-shadow:${shadow}"></div>`,
    className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
}

function makeWaypointIcon(label, color) {
  return L.divIcon({
    html: `<div style="width:28px;height:28px;background:${color};border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${label}</div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
  });
}

function makePoliceIcon() {
  return L.divIcon({
    html: `<div style="width:20px;height:20px;background:#003087;border:2px solid white;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:white;box-shadow:0 2px 4px rgba(0,0,0,0.4)">P</div>`,
    className: '', iconSize: [20, 20], iconAnchor: [10, 10],
  });
}

const INFRA_CONFIG = {
  HOSPITAL:      { label:'Hospital',      bg:'#dc2626', emoji:'🏥', border:'#991b1b' },
  SALITA:        { label:'Centro Salud',  bg:'#16a34a', emoji:'⚕️', border:'#14532d' },
  BOMBEROS:      { label:'Bomberos',      bg:'#ea580c', emoji:'🚒', border:'#9a3412' },
  SAME:          { label:'SAME/SAMU',     bg:'#7c3aed', emoji:'🚑', border:'#4c1d95' },
  DEFENSA_CIVIL: { label:'Defensa Civil', bg:'#0284c7', emoji:'⚡', border:'#0c4a6e' },
  CUARTEL_GN:    { label:'Gendarmería',   bg:'#4b5563', emoji:'💂', border:'#1f2937' },
  OTRO:          { label:'Otro',          bg:'#6b7280', emoji:'📍', border:'#374151' },
};

function makeInfraIcon(type) {
  const cfg = INFRA_CONFIG[type] || INFRA_CONFIG.OTRO;
  return L.divIcon({
    html: `<div style="width:24px;height:24px;background:${cfg.bg};border:2px solid ${cfg.border};border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,0.45)">${cfg.emoji}</div>`,
    className: '', iconSize: [24, 24], iconAnchor: [12, 12],
  });
}

// ─── Badges ───────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  RECIBIDO:   { bg:'#dbeafe', text:'#1d4ed8', label:'Recibido' },
  EN_CAMINO:  { bg:'#fef3c7', text:'#d97706', label:'En Camino' },
  EN_ESCENA:  { bg:'#fee2e2', text:'#dc2626', label:'En Escena' },
  CONTROLADO: { bg:'#fef9c3', text:'#ca8a04', label:'Controlado' },
  CERRADO:    { bg:'#dcfce7', text:'#16a34a', label:'Cerrado' },
  CANCELADO:  { bg:'#f1f5f9', text:'#64748b', label:'Cancelado' },
};
const PRIORITY_BADGE = {
  BAJA:    { bg:'#dcfce7', text:'#16a34a', label:'Baja' },
  MEDIA:   { bg:'#dbeafe', text:'#1d4ed8', label:'Media' },
  ALTA:    { bg:'#fef3c7', text:'#d97706', label:'Alta' },
  CRITICA: { bg:'#fee2e2', text:'#dc2626', label:'Crítica' },
};

function htmlBadge(bg, text, label) {
  return `<span style="display:inline-flex;align-items:center;padding:0.125rem 0.625rem;border-radius:9999px;font-size:0.75rem;font-weight:600;background:${bg};color:${text};white-space:nowrap">${label}</span>`;
}

// ─── ClusterLayer ──────────────────────────────────────────────────────────────

function ClusterLayer({ points, incidentTypes, routeMode }) {
  const map = useMap();

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 60, showCoverageOnHover: false,
    });

    points.forEach(p => {
      const type  = incidentTypes.find(t => t.id === p.incident_type_id);
      const color = type?.color_hex || p.color_hex || '#FF4500';
      const icon  = makeIncidentIcon(color, p.priority);
      const sc    = STATUS_BADGE[p.status]     || { bg:'#f1f5f9', text:'#64748b', label: p.status };
      const pc    = PRIORITY_BADGE[p.priority] || { bg:'#f1f5f9', text:'#64748b', label: p.priority };
      const dateStr = format(new Date(p.started_at), 'dd/MM/yy HH:mm', { locale: es });

      const routeBtn = (p.latitude && p.longitude)
        ? `<button onclick="window.__setRouteDest(${p.latitude},${p.longitude},'${p.incident_number.replace(/'/g,"\\'")}');this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button')?.click()"
            style="margin-top:6px;width:100%;padding:4px 8px;background:#1d4ed8;color:white;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600">
            🧭 Calcular ruta aquí
           </button>`
        : '';

      const popupHtml = `
        <div style="min-width:220px">
          <div style="font-weight:700;font-size:0.875rem;margin-bottom:0.25rem;color:#1e293b">${p.incident_number}</div>
          <div style="font-size:0.8125rem;margin-bottom:0.5rem;color:#475569">${p.title}</div>
          <div style="display:flex;gap:0.375rem;margin-bottom:0.5rem;flex-wrap:wrap">
            ${htmlBadge(sc.bg, sc.text, sc.label)}
            ${htmlBadge(pc.bg, pc.text, pc.label)}
          </div>
          <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.5rem">${p.type_name} · ${dateStr}</div>
          <a href="/incidents/${p.uuid}" style="color:#1d4ed8;font-size:0.8125rem;font-weight:500">Ver detalle →</a>
          ${routeBtn}
        </div>`;

      const marker = L.marker([Number(p.latitude), Number(p.longitude)], { icon });
      marker.bindPopup(popupHtml, { minWidth: 220 });
      clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);
    return () => { map.removeLayer(clusterGroup); };
  }, [points, incidentTypes, routeMode, map]);

  return null;
}

// ─── RouteClickHandler ────────────────────────────────────────────────────────

function RouteClickHandler({ active, settingPoint, onMapClick }) {
  useMapEvents({
    click: (e) => {
      if (active && settingPoint) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

// ─── FitBounds ────────────────────────────────────────────────────────────────

function FitBounds({ points, trigger }) {
  const map = useMap();
  const prev = useRef(null);
  useEffect(() => {
    if (!points.length || trigger === prev.current) return;
    prev.current = trigger;
    const valid = points.filter(p => p.latitude && p.longitude);
    if (!valid.length) return;
    const bounds = L.latLngBounds(valid.map(p => [Number(p.latitude), Number(p.longitude)]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, trigger, map]);
  return null;
}

// ─── MapController ────────────────────────────────────────────────────────────

function MapController({ provinceCode, partidoLatLng, localityLatLng, localityBoundary }) {
  const map = useMap();
  useEffect(() => {
    if (localityBoundary) {
      try {
        const layer = L.geoJSON(localityBoundary);
        const bounds = layer.getBounds();
        if (bounds.isValid()) { map.fitBounds(bounds, { padding: [30, 30] }); return; }
      } catch {/* fall through */}
    }
    if (localityLatLng) {
      map.flyTo([localityLatLng.lat, localityLatLng.lng], 14, { duration: 1.0 });
    } else if (partidoLatLng) {
      map.flyTo([partidoLatLng.lat, partidoLatLng.lng], 11, { duration: 1.0 });
    } else if (provinceCode && PROVINCE_CENTERS[provinceCode]) {
      const c = PROVINCE_CENTERS[provinceCode];
      map.flyTo([c.lat, c.lng], c.zoom, { duration: 1.2 });
    } else if (!provinceCode) {
      map.flyTo([-38.4161, -63.6167], 5, { duration: 1.2 });
    }
  }, [provinceCode, partidoLatLng, localityLatLng, localityBoundary, map]);
  return null;
}

const { BaseLayer } = LayersControl;
const INFRA_TYPES = Object.keys(INFRA_CONFIG);

// ─── Helpers de ruta ─────────────────────────────────────────────────────────

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtTime(s) {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`;
}
const MANEUVER_ES = {
  'turn-right': 'Girar a la derecha', 'turn-left': 'Girar a la izquierda',
  'straight': 'Seguir derecho', 'merge': 'Incorporarse', 'ramp': 'Tomar rampa',
  'fork': 'Bifurcación', 'roundabout': 'Rotonda', 'arrive': 'Destino',
  'depart': 'Partir', 'end of road': 'Fin de calle',
};
function stepLabel(step) {
  const t = step.maneuver?.type || '';
  const m = step.maneuver?.modifier || '';
  const key = m ? `${t}-${m}` : t;
  return MANEUVER_ES[key] || MANEUVER_ES[t] || `${t} ${m}`.trim() || 'Continuar';
}

const RESPONSIVE_CSS = `
  .map-sel { padding:0.4rem 0.6rem; border:1px solid #d1d5db; border-radius:var(--radius); font-size:0.8rem; background:#fff; min-width:120px; max-width:100%; }
  .map-sel:disabled { opacity:0.5; }
  .map-checkbox-label { display:flex; align-items:center; gap:0.3rem; font-size:0.75rem; cursor:pointer; white-space:nowrap; }
  .route-cursor { cursor:crosshair !important; }
  .route-cursor * { cursor:crosshair !important; }
  @media (max-width: 768px) {
    .map-sel { min-width:90px; font-size:0.75rem; }
    .map-legend-sizes { display:none !important; }
    .route-panel { width:calc(100vw - 2rem) !important; left:0.5rem !important; right:0.5rem !important; }
  }
`;

// ─── Componente principal ─────────────────────────────────────────────────────

export default function MapView() {
  const {
    provinces, partidos, localities, incidentTypes,
    fetchProvinces, fetchPartidos, fetchLocalities, fetchIncidentTypes, fetchInfrastructure,
    infrastructure,
  } = useGeoStore();
  const canWrite = useAuthStore(s => s.canWrite());

  const [points,           setPoints]           = useState([]);
  const [stations,         setStations]         = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [localityBoundary, setLocalityBoundary] = useState(null);
  const [fitTrigger,       setFitTrigger]       = useState(0);

  // ── Routing ──
  const [routeMode,    setRouteMode]    = useState(false);
  const [routeOrigin,  setRouteOrigin]  = useState(null); // {lat, lng, label}
  const [routeDest,    setRouteDest]    = useState(null); // {lat, lng, label}
  const [settingPoint, setSettingPoint] = useState(null); // 'origin' | 'dest' | null
  const [routeResult,  setRouteResult]  = useState(null); // {distance, duration, geojson, steps}
  const [routeLoading, setRouteLoading] = useState(false);
  const [stepsOpen,    setStepsOpen]    = useState(false);

  const [filters, setFilters] = useState({
    province_id: '', province_code: '',
    partido_id: '', partido_lat: null, partido_lng: null,
    locality_id: '', locality_lat: null, locality_lng: null,
    incident_type_id: '', status: '',
  });

  const [infraLayers, setInfraLayers] = useState({
    showPolice: true, HOSPITAL: true, SALITA: true, BOMBEROS: true,
    SAME: true, DEFENSA_CIVIL: true, CUARTEL_GN: false, OTRO: false,
  });

  const STATUSES = [
    { value:'RECIBIDO', label:'Recibido' }, { value:'EN_CAMINO', label:'En Camino' },
    { value:'EN_ESCENA', label:'En Escena' }, { value:'CONTROLADO', label:'Controlado' },
    { value:'CERRADO', label:'Cerrado' }, { value:'CANCELADO', label:'Cancelado' },
  ];

  // Exponer callback global para el botón "Calcular ruta" en popups
  useEffect(() => {
    window.__setRouteDest = (lat, lng, label) => {
      setRouteDest({ lat: Number(lat), lng: Number(lng), label });
      setRouteMode(true);
      setSettingPoint(null);
    };
    return () => { delete window.__setRouteDest; };
  }, []);

  // Calcular ruta con OSRM cuando ambos waypoints están listos
  useEffect(() => {
    if (!routeOrigin || !routeDest) { setRouteResult(null); return; }
    setRouteLoading(true);
    const url = `https://router.project-osrm.org/route/v1/driving/${routeOrigin.lng},${routeOrigin.lat};${routeDest.lng},${routeDest.lat}?overview=full&geometries=geojson&steps=true`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.routes?.[0]) {
          const route = data.routes[0];
          setRouteResult({
            distance: route.distance,
            duration: route.duration,
            geojson:  route.geometry,
            steps:    route.legs?.[0]?.steps || [],
          });
        } else {
          setRouteResult(null);
        }
      })
      .catch(() => setRouteResult(null))
      .finally(() => setRouteLoading(false));
  }, [routeOrigin, routeDest]);

  const clearRoute = () => {
    setRouteOrigin(null); setRouteDest(null);
    setRouteResult(null); setSettingPoint(null); setStepsOpen(false);
  };

  const handleGeolocation = (target) => {
    if (!navigator.geolocation) return alert('Tu navegador no soporta geolocalización.');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Mi ubicación' };
        if (target === 'origin') setRouteOrigin(pt);
        else setRouteDest(pt);
        setSettingPoint(null);
      },
      () => alert('No se pudo obtener tu ubicación. Verificá los permisos.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleMapClick = (lat, lng) => {
    if (settingPoint === 'origin') {
      setRouteOrigin({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    } else if (settingPoint === 'dest') {
      setRouteDest({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    }
    setSettingPoint(null);
  };

  useEffect(() => { fetchProvinces(); fetchIncidentTypes(); }, []);

  useEffect(() => {
    if (filters.province_id) { fetchPartidos(filters.province_id); fetchInfrastructure({ province_id: filters.province_id }); }
    else fetchInfrastructure({});
  }, [filters.province_id]);

  useEffect(() => {
    if (filters.partido_id) { fetchLocalities(filters.partido_id); fetchInfrastructure({ province_id: filters.province_id, partido_id: filters.partido_id }); }
    else if (filters.province_id) fetchInfrastructure({ province_id: filters.province_id });
    setFilters(f => ({ ...f, locality_id: '', locality_lat: null, locality_lng: null }));
    setLocalityBoundary(null);
  }, [filters.partido_id]);

  useEffect(() => {
    if (!filters.locality_id) { setLocalityBoundary(null); return; }
    const locality = (localities[filters.partido_id] || []).find(l => String(l.id) === String(filters.locality_id));
    if (!locality) return;
    const provinceName = provinces.find(p => String(p.id) === String(filters.province_id))?.name || '';
    const q = encodeURIComponent(`${locality.name}, ${provinceName}, Argentina`);
    fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=geojson&polygon_geojson=1&limit=1&countrycodes=ar`)
      .then(r => r.json())
      .then(data => setLocalityBoundary(data.features?.[0]?.geometry || null))
      .catch(() => setLocalityBoundary(null));
  }, [filters.locality_id]);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (filters.incident_type_id) params.incident_type_id = filters.incident_type_id;
    if (filters.status)           params.status           = filters.status;
    if (filters.province_id)      params.province_id      = filters.province_id;
    if (filters.partido_id)       params.partido_id       = filters.partido_id;
    if (filters.locality_id)      params.locality_id      = filters.locality_id;
    Promise.all([
      incidentsApi.getMapPoints(params),
      geoApi.getPoliceStations(filters.province_id || undefined),
    ]).then(([pts, sts]) => {
      setPoints(pts.data);
      setStations(sts.data);
      if (pts.data.length && !filters.locality_id && !filters.partido_id && !filters.province_id)
        setFitTrigger(t => t + 1);
    }).finally(() => setLoading(false));
  }, [filters.province_id, filters.partido_id, filters.locality_id, filters.incident_type_id, filters.status]);

  const handleProvinceChange = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    setFilters(f => ({ ...f, province_id: e.target.value, province_code: opt.dataset.code || '', partido_id: '', partido_lat: null, partido_lng: null, locality_id: '', locality_lat: null, locality_lng: null }));
    setLocalityBoundary(null);
  };
  const handlePartidoChange = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    setFilters(f => ({ ...f, partido_id: e.target.value, partido_lat: parseFloat(opt.dataset.lat) || null, partido_lng: parseFloat(opt.dataset.lng) || null }));
  };
  const handleLocalityChange = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    setFilters(f => ({ ...f, locality_id: e.target.value, locality_lat: parseFloat(opt.dataset.lat) || null, locality_lng: parseFloat(opt.dataset.lng) || null }));
  };
  const toggleInfraLayer = (key) => setInfraLayers(l => ({ ...l, [key]: !l[key] }));
  const clearFilters = () => {
    setFilters({ province_id:'', province_code:'', partido_id:'', partido_lat:null, partido_lng:null, locality_id:'', locality_lat:null, locality_lng:null, incident_type_id:'', status:'' });
    setLocalityBoundary(null);
    fetchInfrastructure({});
  };

  const currentPartidos = partidos[filters.province_id] || [];
  const partidoLatLng   = (filters.partido_lat && filters.partido_lng) ? { lat: filters.partido_lat, lng: filters.partido_lng } : null;
  const localityLatLng  = (filters.locality_lat && filters.locality_lng) ? { lat: filters.locality_lat, lng: filters.locality_lng } : null;

  return (
    <>
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 56px - 3rem)', gap:'0.75rem' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem' }}>
          <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Mapa de Incidentes</h1>
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
            {loading && <span style={{ fontSize:'0.8rem', color:'#94a3b8' }}>⟳ Actualizando...</span>}
            <span style={{ fontSize:'0.8rem', color:'#64748b', background:'#f1f5f9', padding:'0.25rem 0.75rem', borderRadius:'9999px' }}>
              {points.length} incidentes
            </span>
            <button
              onClick={() => { setRouteMode(m => !m); if (routeMode) clearRoute(); }}
              style={{ padding:'0.375rem 0.75rem', border:'none', borderRadius:'var(--radius)', fontSize:'0.8125rem', fontWeight:600, cursor:'pointer',
                background: routeMode ? '#1d4ed8' : '#f1f5f9', color: routeMode ? '#fff' : '#374151' }}
            >
              🧭 {routeMode ? 'Salir de Ruta' : 'Calcular Ruta'}
            </button>
            {canWrite && <Link to="/incidents/new"><Button size="sm">➕ Nuevo Incidente</Button></Link>}
          </div>
        </div>

        {/* Filtros */}
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'0.75rem 1rem', display:'flex', flexWrap:'wrap', gap:'0.6rem', alignItems:'center' }}>
          <label style={{ fontSize:'0.8rem', fontWeight:500, color:'#374151' }}>Provincia:</label>
          <select className="map-sel" value={filters.province_id} onChange={handleProvinceChange}>
            <option value="" data-code="">Toda Argentina</option>
            {provinces.map(p => <option key={p.id} value={p.id} data-code={p.code}>{p.name}</option>)}
          </select>

          <label style={{ fontSize:'0.8rem', fontWeight:500, color:'#374151' }}>Partido/Municipio:</label>
          <select className="map-sel" value={filters.partido_id} onChange={handlePartidoChange} disabled={!filters.province_id}>
            <option value="" data-lat="" data-lng="">{filters.province_id ? 'Todo el partido' : '— elegir prov. —'}</option>
            {currentPartidos.map(p => <option key={p.id} value={p.id} data-lat={p.latitude||''} data-lng={p.longitude||''}>{p.name}</option>)}
          </select>

          <label style={{ fontSize:'0.8rem', fontWeight:500, color:'#374151' }}>Localidad:</label>
          <select className="map-sel" value={filters.locality_id} onChange={handleLocalityChange} disabled={!filters.partido_id}>
            <option value="" data-lat="" data-lng="">{filters.partido_id ? 'Todas' : '— elegir partido —'}</option>
            {(localities[filters.partido_id] || []).map(l => (
              <option key={l.id} value={l.id} data-lat={l.latitude||''} data-lng={l.longitude||''}>
                {l.name}{l.postal_code ? ` (${l.postal_code})` : ''}
              </option>
            ))}
          </select>

          <label style={{ fontSize:'0.8rem', fontWeight:500, color:'#374151' }}>Tipo:</label>
          <select className="map-sel" value={filters.incident_type_id} onChange={e => setFilters(f => ({ ...f, incident_type_id: e.target.value }))}>
            <option value="">Todos</option>
            {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <label style={{ fontSize:'0.8rem', fontWeight:500, color:'#374151' }}>Estado:</label>
          <select className="map-sel" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <Button size="sm" variant="secondary" onClick={clearFilters}>Limpiar</Button>
        </div>

        {/* Capas de infraestructura */}
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'0.6rem 1rem', display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.75rem', fontWeight:600, color:'#374151' }}>Mostrar:</span>
          <label className="map-checkbox-label">
            <input type="checkbox" checked={infraLayers.showPolice} onChange={() => toggleInfraLayer('showPolice')} />
            <span style={{ width:14, height:14, background:'#003087', borderRadius:3, border:'2px solid white', boxShadow:'0 1px 2px rgba(0,0,0,0.3)', display:'inline-block' }} />
            Comisarías
          </label>
          {INFRA_TYPES.map(type => {
            const cfg = INFRA_CONFIG[type];
            return (
              <label key={type} className="map-checkbox-label">
                <input type="checkbox" checked={infraLayers[type]} onChange={() => toggleInfraLayer(type)} />
                <span style={{ width:16, height:16, background:cfg.bg, borderRadius:4, border:`2px solid ${cfg.border}`, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'9px' }}>
                  {cfg.emoji}
                </span>
                {cfg.label}
              </label>
            );
          })}
        </div>

        {/* Leyenda */}
        <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', fontSize:'0.75rem', color:'#64748b', alignItems:'center' }}>
          {incidentTypes.map(t => (
            <span key={t.id} style={{ display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background:t.color_hex, border:'1px solid rgba(0,0,0,0.2)', display:'inline-block' }} />
              {t.name}
            </span>
          ))}
          <span className="map-legend-sizes" style={{ marginLeft:'auto', display:'flex', gap:'0.75rem', flexShrink:0 }}>
            <span>● Crítico</span><span>● Alto</span><span>● Normal</span>
          </span>
        </div>

        {/* Mapa */}
        <div style={{ flex:1, minHeight:'350px', borderRadius:'var(--radius)', overflow:'hidden', boxShadow:'var(--shadow)', position:'relative' }}>

          <MapContainer
            center={[-38.4161, -63.6167]} zoom={5}
            style={{ height:'100%', width:'100%' }}
            zoomControl={false}
            className={routeMode && settingPoint ? 'route-cursor' : ''}
          >
            <ZoomControl position="topright" />
            <ScaleControl position="bottomright" imperial={false} />
            <MapController provinceCode={filters.province_code} partidoLatLng={partidoLatLng} localityLatLng={localityLatLng} localityBoundary={localityBoundary} />
            <FitBounds points={points} trigger={fitTrigger} />
            <RouteClickHandler active={routeMode} settingPoint={settingPoint} onMapClick={handleMapClick} />

            {/* Límite de localidad */}
            {localityBoundary && (
              <GeoJSON key={`boundary-${filters.locality_id}`} data={localityBoundary}
                style={{ color:'#2563eb', weight:2.5, opacity:0.9, fillColor:'#3b82f6', fillOpacity:0.08 }} />
            )}

            {/* Ruta OSRM */}
            {routeResult?.geojson && (
              <GeoJSON key={`route-${routeOrigin?.lat}-${routeDest?.lat}`} data={routeResult.geojson}
                style={{ color:'#2563eb', weight:5, opacity:0.85 }} />
            )}

            {/* Marcadores de ruta */}
            {routeOrigin && (
              <Marker position={[routeOrigin.lat, routeOrigin.lng]} icon={makeWaypointIcon('A', '#16a34a')}>
                <Popup><strong>Origen:</strong> {routeOrigin.label}</Popup>
              </Marker>
            )}
            {routeDest && (
              <Marker position={[routeDest.lat, routeDest.lng]} icon={makeWaypointIcon('B', '#dc2626')}>
                <Popup><strong>Destino:</strong> {routeDest.label}</Popup>
              </Marker>
            )}

            <LayersControl position="topright">
              <BaseLayer checked name="Calles y Rutas (OSM)">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' maxZoom={19} />
              </BaseLayer>
              <BaseLayer name="Mapa Claro (CartoDB)">
                <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={20} />
              </BaseLayer>
              <BaseLayer name="Mapa Oscuro (CartoDB)">
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={20} />
              </BaseLayer>
              <BaseLayer name="Satélite (ESRI)">
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri' maxZoom={18} />
              </BaseLayer>
              <BaseLayer name="Topografía (OpenTopoMap)">
                <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap' maxZoom={17} />
              </BaseLayer>
            </LayersControl>

            <ClusterLayer points={points} incidentTypes={incidentTypes} routeMode={routeMode} />

            {/* Comisarías */}
            {infraLayers.showPolice && stations.filter(s => s.latitude && s.longitude).map(s => (
              <Marker key={`ps-${s.id}`} position={[Number(s.latitude), Number(s.longitude)]} icon={makePoliceIcon()}>
                <Popup>
                  <div style={{ fontWeight:700, fontSize:'0.8125rem', marginBottom:'0.25rem' }}>🚔 {s.name}</div>
                  {s.address    && <div style={{ fontSize:'0.75rem', color:'#64748b' }}>{s.address}</div>}
                  {s.phone      && <div style={{ fontSize:'0.75rem', color:'#64748b', marginTop:'0.25rem' }}>☎ {s.phone}</div>}
                  {s.partido_name && <div style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:'0.25rem' }}>{s.partido_name}</div>}
                </Popup>
              </Marker>
            ))}

            {/* Infraestructura */}
            {infrastructure.filter(pt => pt.latitude && pt.longitude && infraLayers[pt.type]).map(pt => {
              const cfg = INFRA_CONFIG[pt.type] || INFRA_CONFIG.OTRO;
              return (
                <Marker key={`infra-${pt.id}`} position={[Number(pt.latitude), Number(pt.longitude)]} icon={makeInfraIcon(pt.type)}>
                  <Popup minWidth={200}>
                    <div style={{ fontWeight:700, fontSize:'0.8125rem', marginBottom:'0.25rem' }}>{cfg.emoji} {pt.name}</div>
                    <div style={{ display:'inline-block', fontSize:'0.7rem', padding:'0.1rem 0.4rem', background:cfg.bg, color:'white', borderRadius:4, marginBottom:'0.35rem' }}>{cfg.label}</div>
                    {pt.address  && <div style={{ fontSize:'0.75rem', color:'#64748b' }}>{pt.address}</div>}
                    {pt.phone    && <div style={{ fontSize:'0.75rem', color:'#64748b', marginTop:'0.25rem' }}>☎ {pt.phone}</div>}
                    {pt.partido_name && <div style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:'0.25rem' }}>{pt.partido_name}</div>}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* ── Panel de ruta (overlay sobre el mapa) ── */}
          {routeMode && (
            <div className="route-panel" style={{
              position:'absolute', top:10, left:10, zIndex:1000,
              background:'#fff', borderRadius:'var(--radius)', boxShadow:'0 4px 20px rgba(0,0,0,0.2)',
              width:300, padding:'0.875rem', fontSize:'0.8125rem',
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
                <span style={{ fontWeight:700, fontSize:'0.875rem', color:'#1e293b' }}>🧭 Calcular Ruta</span>
                <button onClick={() => { setRouteMode(false); clearRoute(); }}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1rem', color:'#64748b', lineHeight:1 }}>✕</button>
              </div>

              {/* Origen */}
              <div style={{ marginBottom:'0.6rem' }}>
                <div style={{ fontSize:'0.7rem', fontWeight:600, color:'#16a34a', marginBottom:3 }}>A — ORIGEN</div>
                <div style={{ display:'flex', gap:'0.35rem' }}>
                  <div style={{ flex:1, padding:'0.35rem 0.5rem', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'var(--radius)', fontSize:'0.75rem', color: routeOrigin ? '#1e293b' : '#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {routeOrigin ? routeOrigin.label : 'Sin definir'}
                  </div>
                  <button onClick={() => handleGeolocation('origin')}
                    title="Usar mi ubicación" style={{ padding:'0.35rem 0.5rem', background:'#dcfce7', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.85rem' }}>📍</button>
                  <button onClick={() => setSettingPoint(settingPoint === 'origin' ? null : 'origin')}
                    style={{ padding:'0.35rem 0.5rem', background: settingPoint === 'origin' ? '#1d4ed8' : '#f1f5f9', color: settingPoint === 'origin' ? '#fff' : '#374151', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.75rem', whiteSpace:'nowrap' }}>
                    {settingPoint === 'origin' ? '→ Clic en mapa' : '🖱 Mapa'}
                  </button>
                  {routeOrigin && <button onClick={() => setRouteOrigin(null)} style={{ padding:'0.35rem 0.4rem', background:'#fee2e2', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.75rem', color:'#dc2626' }}>✕</button>}
                </div>
              </div>

              {/* Destino */}
              <div style={{ marginBottom:'0.75rem' }}>
                <div style={{ fontSize:'0.7rem', fontWeight:600, color:'#dc2626', marginBottom:3 }}>B — DESTINO</div>
                <div style={{ display:'flex', gap:'0.35rem' }}>
                  <div style={{ flex:1, padding:'0.35rem 0.5rem', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'var(--radius)', fontSize:'0.75rem', color: routeDest ? '#1e293b' : '#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {routeDest ? routeDest.label : 'Sin definir · clic en incidente o mapa'}
                  </div>
                  <button onClick={() => handleGeolocation('dest')}
                    title="Usar mi ubicación" style={{ padding:'0.35rem 0.5rem', background:'#fee2e2', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.85rem' }}>📍</button>
                  <button onClick={() => setSettingPoint(settingPoint === 'dest' ? null : 'dest')}
                    style={{ padding:'0.35rem 0.5rem', background: settingPoint === 'dest' ? '#1d4ed8' : '#f1f5f9', color: settingPoint === 'dest' ? '#fff' : '#374151', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.75rem', whiteSpace:'nowrap' }}>
                    {settingPoint === 'dest' ? '→ Clic en mapa' : '🖱 Mapa'}
                  </button>
                  {routeDest && <button onClick={() => setRouteDest(null)} style={{ padding:'0.35rem 0.4rem', background:'#fee2e2', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.75rem', color:'#dc2626' }}>✕</button>}
                </div>
              </div>

              {/* Tip */}
              {!routeOrigin && !routeDest && (
                <div style={{ fontSize:'0.72rem', color:'#94a3b8', background:'#f8fafc', padding:'0.4rem 0.5rem', borderRadius:'var(--radius)', marginBottom:'0.5rem' }}>
                  💡 También podés hacer clic en el ícono de un incidente y elegir "Calcular ruta aquí"
                </div>
              )}

              {/* Resultado */}
              {routeLoading && <div style={{ textAlign:'center', color:'#64748b', padding:'0.5rem' }}>⟳ Calculando ruta...</div>}
              {routeResult && !routeLoading && (
                <div style={{ borderTop:'1px solid #e2e8f0', paddingTop:'0.6rem' }}>
                  <div style={{ display:'flex', gap:'1rem', marginBottom:'0.5rem' }}>
                    <span style={{ fontWeight:700, color:'#1d4ed8' }}>📏 {fmtDist(routeResult.distance)}</span>
                    <span style={{ fontWeight:700, color:'#7c3aed' }}>⏱ {fmtTime(routeResult.duration)}</span>
                  </div>
                  <button onClick={() => setStepsOpen(o => !o)}
                    style={{ width:'100%', textAlign:'left', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'var(--radius)', padding:'0.35rem 0.5rem', cursor:'pointer', fontSize:'0.75rem', color:'#374151' }}>
                    {stepsOpen ? '▲' : '▼'} Indicaciones paso a paso ({routeResult.steps.length})
                  </button>
                  {stepsOpen && (
                    <div style={{ maxHeight:180, overflowY:'auto', marginTop:'0.4rem', display:'flex', flexDirection:'column', gap:2 }}>
                      {routeResult.steps.map((step, i) => (
                        <div key={i} style={{ display:'flex', gap:'0.5rem', fontSize:'0.72rem', padding:'0.25rem 0.35rem', background: i % 2 === 0 ? '#f8fafc' : '#fff', borderRadius:4 }}>
                          <span style={{ color:'#94a3b8', minWidth:18 }}>{i + 1}.</span>
                          <span style={{ flex:1, color:'#374151' }}>{stepLabel(step)}{step.name ? ` — ${step.name}` : ''}</span>
                          <span style={{ color:'#64748b', whiteSpace:'nowrap' }}>{fmtDist(step.distance)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={clearRoute}
                    style={{ marginTop:'0.5rem', width:'100%', padding:'0.35rem', background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:'var(--radius)', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }}>
                    Limpiar ruta
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
