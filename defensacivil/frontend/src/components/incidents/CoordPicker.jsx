import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import { MapPin, LocateFixed } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { TILE_URL, TILE_ATTRIBUTION, pickIcon } from '../../lib/mapIcons';
import { DEFAULT_CENTER } from '../../lib/constants';
import { fmtCoords } from '../../lib/format';

// Dirección aproximada a partir de coordenadas (Nominatim / OpenStreetMap)
async function reverseGeocode(lat, lng, signal) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const a = (await res.json()).address || {};
    const road = a.road || a.pedestrian || a.footway || '';
    return {
      address:  [road && `${road}${a.house_number ? ` ${a.house_number}` : ''}`, a.suburb || a.quarter].filter(Boolean).join(', '),
      locality: a.city || a.town || a.village || '',
      partido:  a.county || a.municipality || '',
      province: a.state || '',
    };
  } catch {
    return null;
  }
}

function ClickToPick({ onPick }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function CoordPicker({ isOpen, onClose, onSelect, initialLat, initialLng }) {
  const hasInitial = initialLat !== '' && initialLat != null && initialLng !== '' && initialLng != null;
  const [coords, setCoords] = useState(null);
  const [geo, setGeo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCoords(hasInitial ? { lat: Number(initialLat), lng: Number(initialLng) } : null);
      setGeo(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!coords) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    reverseGeocode(coords.lat, coords.lng, ctrl.signal).then(data => {
      if (!ctrl.signal.aborted) { setGeo(data); setLoading(false); }
    });
    return () => ctrl.abort();
  }, [coords]);

  const useGps = () => navigator.geolocation?.getCurrentPosition(p => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ubicación del incidente"
      width={760}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={!coords} onClick={() => onSelect(coords.lat, coords.lng, geo)}>Usar esta ubicación</Button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <span className="muted">Hacé clic en el mapa para marcar el lugar. La dirección se completa sola.</span>
        <Button variant="secondary" size="sm" icon={LocateFixed} onClick={useGps}>Mi ubicación</Button>
      </div>
      <div className="map-card" style={{ height: 380 }}>
        <MapContainer center={coords ? [coords.lat, coords.lng] : DEFAULT_CENTER} zoom={coords ? 15 : 10}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <ClickToPick onPick={(lat, lng) => setCoords({ lat, lng })} />
          {coords && <Marker position={[coords.lat, coords.lng]} icon={pickIcon()} />}
        </MapContainer>
      </div>
      <div className="alert alert-info" style={{ marginTop: 12 }}>
        <MapPin size={17} />
        <div>
          {!coords && 'Todavía no marcaste ninguna ubicación.'}
          {coords && loading && 'Buscando la dirección…'}
          {coords && !loading && (
            <>
              <strong>{geo?.address || 'Dirección no disponible'}</strong>
              <div style={{ fontSize: 12.5 }}>{[geo?.locality, geo?.partido, geo?.province].filter(Boolean).join(' · ')} {fmtCoords(coords.lat, coords.lng)}</div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
