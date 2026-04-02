import { useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import Modal from '../common/Modal';
import Button from '../common/Button';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Llama a Nominatim (OpenStreetMap) para obtener la dirección a partir de coords
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return null;
    const json = await res.json();
    const a    = json.address || {};

    // Construir dirección legible: "Av. Corrientes 1234, San Nicolás"
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
      road:       road,
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

export default function CoordPicker({ isOpen, onClose, onSelect, initialLat, initialLng }) {
  const defaultCenter = [-38.4161, -63.6167];
  const center = (initialLat && initialLng) ? [initialLat, initialLng] : defaultCenter;

  const [coords,     setCoords]     = useState(
    (initialLat && initialLng) ? { lat: Number(initialLat), lng: Number(initialLng) } : null
  );
  const [geoData,    setGeoData]    = useState(null);
  const [geocoding,  setGeocoding]  = useState(false);
  const abortRef = useRef(null);

  const handleCoord = async (lat, lng) => {
    setCoords({ lat, lng });
    setGeoData(null);
    setGeocoding(true);

    const data = await reverseGeocode(lat, lng);
    setGeoData(data);
    setGeocoding(false);
  };

  const handleConfirm = () => {
    if (coords) onSelect(coords.lat, coords.lng, geoData);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Seleccionar Ubicación en Mapa" width={720}>
      <p style={{ fontSize:'0.875rem', color:'#64748b', marginBottom:'0.75rem' }}>
        Haga clic en el mapa para marcar la ubicación del incidente. La dirección se completará automáticamente.
      </p>

      <div style={{ height:380, borderRadius:'var(--radius)', overflow:'hidden', marginBottom:'0.75rem' }}>
        <MapContainer center={center} zoom={initialLat ? 14 : 5} style={{ height:'100%', width:'100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
          />
          <Clicker onCoord={handleCoord} />
          {coords && <Marker position={[coords.lat, coords.lng]} />}
        </MapContainer>
      </div>

      {/* Dirección resuelta */}
      <div style={{
        minHeight: 72,
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
          <div style={{ display:'flex', flexDirection:'column', gap:'0.25rem' }}>
            {geoData.address && (
              <div><strong style={{ color:'#1e293b' }}>Dirección:</strong>{' '}
                <span style={{ color:'#374151' }}>{geoData.address}</span>
              </div>
            )}
            {geoData.locality && (
              <div><strong style={{ color:'#1e293b' }}>Localidad:</strong>{' '}
                <span style={{ color:'#374151' }}>{geoData.locality}</span>
              </div>
            )}
            {geoData.partido && (
              <div><strong style={{ color:'#1e293b' }}>Partido/Municipio:</strong>{' '}
                <span style={{ color:'#374151' }}>{geoData.partido}</span>
              </div>
            )}
            {geoData.province && (
              <div><strong style={{ color:'#1e293b' }}>Provincia:</strong>{' '}
                <span style={{ color:'#374151' }}>{geoData.province}</span>
              </div>
            )}
            <div style={{ marginTop:'0.25rem', color:'#64748b', fontSize:'0.75rem' }}>
              Coords: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              {geoData.postcode && ` · CP ${geoData.postcode}`}
            </div>
          </div>
        )}
        {coords && !geocoding && !geoData && (
          <div>
            <span style={{ color:'#f59e0b' }}>No se pudo obtener la dirección.</span>
            <span style={{ color:'#64748b', marginLeft:'0.5rem', fontSize:'0.75rem' }}>
              Coords: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </span>
          </div>
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
