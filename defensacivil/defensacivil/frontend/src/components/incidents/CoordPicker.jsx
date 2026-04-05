import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import Modal from '../common/Modal';
import Button from '../common/Button';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import useGeoStore from '../../store/geoStore';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const PROVINCE_CENTERS = {
  'AR-C': { lat:-34.6037, lng:-58.3816, zoom:12 },
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

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return null;
    const json = await res.json();
    const a    = json.address || {};
    const parts = [];
    const road = a.road || a.pedestrian || a.footway || a.path || '';
    if (road)           parts.push(road + (a.house_number ? ` ${a.house_number}` : ''));
    if (a.suburb)       parts.push(a.suburb);
    else if (a.quarter) parts.push(a.quarter);
    return {
      address:    parts.join(', '),
      locality:   a.city || a.town || a.village || a.municipality || '',
      partido:    a.county || a.municipality || '',
      province:   a.state || '',
      postcode:   a.postcode || '',
      road,
      houseNumber:a.house_number || '',
      displayName:json.display_name || '',
    };
  } catch {
    return null;
  }
}

function Clicker({ onCoord }) {
  useMapEvents({ click: e => onCoord(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Navega el mapa cuando cambia el target
function MapNavigator({ target }) {
  const map = useMap();
  const prev = useRef(null);
  useEffect(() => {
    if (!target) return;
    const key = `${target.lat},${target.lng},${target.zoom}`;
    if (key === prev.current) return;
    prev.current = key;
    map.flyTo([target.lat, target.lng], target.zoom, { duration: 0.8 });
  }, [target, map]);
  return null;
}

const sel = {
  padding:'0.35rem 0.5rem', border:'1px solid #d1d5db',
  borderRadius:'var(--radius)', fontSize:'0.8rem', background:'#fff',
  flex:1, minWidth:0,
};

export default function CoordPicker({ isOpen, onClose, onSelect, initialLat, initialLng }) {
  const defaultCenter = [-38.4161, -63.6167];
  const center = (initialLat && initialLng) ? [initialLat, initialLng] : defaultCenter;

  const [coords,    setCoords]    = useState(
    (initialLat && initialLng) ? { lat: Number(initialLat), lng: Number(initialLng) } : null
  );
  const [geoData,   setGeoData]   = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geolocating, setGeolocating] = useState(false);
  const [geolocateError, setGeolocateError] = useState('');

  // Selectores de navegación
  const [navProv,    setNavProv]    = useState('');
  const [navProvCode,setNavProvCode]= useState('');
  const [navPartido, setNavPartido] = useState('');
  const [navLocality,setNavLocality]= useState('');
  const [mapTarget,  setMapTarget]  = useState(null);

  const {
    provinces, partidos, localities,
    fetchProvinces, fetchPartidos, fetchLocalities,
  } = useGeoStore();

  useEffect(() => { fetchProvinces(); }, []);

  const handleProvChange = (e) => {
    const id   = e.target.value;
    const code = e.target.options[e.target.selectedIndex].dataset.code || '';
    setNavProv(id);
    setNavProvCode(code);
    setNavPartido('');
    setNavLocality('');
    if (id) fetchPartidos(id);
    if (code && PROVINCE_CENTERS[code]) {
      const c = PROVINCE_CENTERS[code];
      setMapTarget({ lat: c.lat, lng: c.lng, zoom: c.zoom });
    }
  };

  const handlePartidoChange = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    const id  = e.target.value;
    const lat = parseFloat(opt.dataset.lat);
    const lng = parseFloat(opt.dataset.lng);
    setNavPartido(id);
    setNavLocality('');
    if (id) fetchLocalities(id);
    if (lat && lng) setMapTarget({ lat, lng, zoom: 12 });
  };

  const handleLocalityChange = (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    const id  = e.target.value;
    const lat = parseFloat(opt.dataset.lat);
    const lng = parseFloat(opt.dataset.lng);
    setNavLocality(id);
    if (lat && lng) setMapTarget({ lat, lng, zoom: 15 });
  };

  const handleCoord = async (lat, lng) => {
    setCoords({ lat, lng });
    setGeoData(null);
    setGeocoding(true);
    const data = await reverseGeocode(lat, lng);
    setGeoData(data);
    setGeocoding(false);
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      setGeolocateError('Tu navegador no soporta geolocalización.');
      return;
    }
    setGeolocating(true);
    setGeolocateError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMapTarget({ lat, lng, zoom: 16 });
        await handleCoord(lat, lng);
        setGeolocating(false);
      },
      (err) => {
        setGeolocating(false);
        if (err.code === 1) setGeolocateError('Permiso de ubicación denegado.');
        else setGeolocateError('No se pudo obtener la ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleConfirm = () => {
    if (coords) onSelect(coords.lat, coords.lng, geoData, {
      province_id:  navProv     || null,
      partido_id:   navPartido  || null,
      locality_id:  navLocality || null,
    });
  };

  const currentPartidos   = partidos[navProv]    || [];
  const currentLocalities = localities[navPartido] || [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Seleccionar Ubicación en Mapa" width={760}>

      <p style={{ fontSize:'0.875rem', color:'#64748b', marginBottom:'0.6rem' }}>
        Usá los filtros para navegar al área y luego hacé clic en el mapa para marcar la ubicación.
      </p>

      {/* Selectores de navegación */}
      <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.6rem', alignItems:'center' }}>
        <select style={sel} value={navProv} onChange={handleProvChange}>
          <option value="" data-code="">Provincia</option>
          {provinces.map(p => (
            <option key={p.id} value={p.id} data-code={p.code}>{p.name}</option>
          ))}
        </select>

        <select style={{ ...sel, opacity: navProv ? 1 : 0.5 }} value={navPartido} onChange={handlePartidoChange} disabled={!navProv}>
          <option value="" data-lat="" data-lng="">{navProv ? 'Partido/Municipio' : '— primero elegí provincia —'}</option>
          {currentPartidos.map(p => (
            <option key={p.id} value={p.id} data-lat={p.latitude || ''} data-lng={p.longitude || ''}>{p.name}</option>
          ))}
        </select>

        <select style={{ ...sel, opacity: navPartido ? 1 : 0.5 }} value={navLocality} onChange={handleLocalityChange} disabled={!navPartido}>
          <option value="" data-lat="" data-lng="">{navPartido ? 'Localidad' : '— primero elegí partido —'}</option>
          {currentLocalities.map(l => (
            <option key={l.id} value={l.id} data-lat={l.latitude || ''} data-lng={l.longitude || ''}>
              {l.name}{l.postal_code ? ` (${l.postal_code})` : ''}
            </option>
          ))}
        </select>

        {(navProv || navPartido || navLocality) && (
          <button
            onClick={() => { setNavProv(''); setNavProvCode(''); setNavPartido(''); setNavLocality(''); setMapTarget({ lat:-38.4161, lng:-63.6167, zoom:5 }); }}
            style={{ padding:'0.35rem 0.6rem', fontSize:'0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', background:'#f1f5f9', cursor:'pointer', whiteSpace:'nowrap' }}
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* Botón geolocalización */}
      <div style={{ marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:'0.75rem' }}>
        <button
          onClick={handleGeolocate}
          disabled={geolocating}
          style={{
            display:'flex', alignItems:'center', gap:'0.4rem',
            padding:'0.4rem 0.85rem', fontSize:'0.8rem', fontWeight:500,
            border:'1px solid #3b82f6', borderRadius:'var(--radius)',
            background: geolocating ? '#eff6ff' : '#3b82f6',
            color: geolocating ? '#3b82f6' : '#fff',
            cursor: geolocating ? 'not-allowed' : 'pointer',
          }}
        >
          📍 {geolocating ? 'Obteniendo ubicación...' : 'Mi ubicación actual'}
        </button>
        {geolocateError && <span style={{ fontSize:'0.78rem', color:'#dc2626' }}>{geolocateError}</span>}
      </div>

      {/* Mapa */}
      <div style={{ height:400, borderRadius:'var(--radius)', overflow:'hidden', marginBottom:'0.75rem' }}>
        <MapContainer center={center} zoom={initialLat ? 14 : 5} style={{ height:'100%', width:'100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
            maxZoom={19}
          />
          <MapNavigator target={mapTarget} />
          <Clicker onCoord={handleCoord} />
          {coords && <Marker position={[coords.lat, coords.lng]} />}
        </MapContainer>
      </div>

      {/* Dirección resuelta */}
      <div style={{
        minHeight: 64,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 'var(--radius)',
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        fontSize: '0.8125rem',
      }}>
        {!coords && (
          <span style={{ color:'#94a3b8' }}>Haga clic en el mapa para obtener la dirección...</span>
        )}
        {coords && geocoding && (
          <span style={{ color:'#64748b' }}>⟳ Obteniendo dirección...</span>
        )}
        {coords && !geocoding && geoData && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem 1.5rem' }}>
            {geoData.address  && <span><strong>Dirección:</strong> {geoData.address}</span>}
            {geoData.locality && <span><strong>Localidad:</strong> {geoData.locality}</span>}
            {geoData.partido  && <span><strong>Partido:</strong> {geoData.partido}</span>}
            {geoData.province && <span><strong>Provincia:</strong> {geoData.province}</span>}
            <span style={{ color:'#64748b', fontSize:'0.75rem' }}>
              {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              {geoData.postcode && ` · CP ${geoData.postcode}`}
            </span>
          </div>
        )}
        {coords && !geocoding && !geoData && (
          <span style={{ color:'#f59e0b' }}>
            No se pudo obtener la dirección. Coords: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
          </span>
        )}
      </div>

      <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button disabled={!coords || geocoding} onClick={handleConfirm}>
          Confirmar Ubicación
        </Button>
      </div>
    </Modal>
  );
}
