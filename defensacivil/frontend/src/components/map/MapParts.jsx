import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { StatusBadge, PriorityBadge } from '../common/Badge';
import { incidentIcon, infraIcon } from '../../lib/mapIcons';
import { INFRA_LABELS } from '../../lib/constants';
import { fmtShort } from '../../lib/format';

export const PROVINCE_CENTERS = {
  'AR-C': [-34.6037, -58.3816, 12], 'AR-B': [-36.6769, -60.5588, 7], 'AR-K': [-28.4696, -65.7795, 7],
  'AR-H': [-26.0, -61.0, 7], 'AR-U': [-43.293, -65.1023, 6], 'AR-X': [-31.4135, -64.1811, 7],
  'AR-W': [-28.4698, -58.8341, 7], 'AR-E': [-31.7333, -60.5167, 7], 'AR-P': [-24.8941, -59.929, 7],
  'AR-Y': [-24.1858, -65.2995, 8], 'AR-L': [-36.6227, -64.29, 7], 'AR-F': [-29.4127, -66.8557, 7],
  'AR-M': [-32.8908, -68.8272, 8], 'AR-N': [-26.9478, -55.1304, 7], 'AR-Q': [-38.9516, -68.0591, 7],
  'AR-R': [-40.8135, -63.0, 6], 'AR-A': [-24.7821, -65.4232, 8], 'AR-J': [-31.5375, -68.5364, 8],
  'AR-D': [-33.2954, -66.3356, 7], 'AR-Z': [-51.623, -69.2168, 6], 'AR-S': [-30.7069, -60.9498, 7],
  'AR-G': [-27.7834, -64.2643, 7], 'AR-V': [-54.8019, -68.303, 8], 'AR-T': [-26.8241, -65.2226, 9],
};

export function FlyTo({ target, zoom = 14 }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target[0], target[1]], target[2] || zoom, { duration: 0.8 });
  }, [target, zoom, map]);
  return null;
}

export function ClickHandler({ onClick }) {
  useMapEvents({ click: e => onClick(e.latlng) });
  return null;
}

export function IncidentPopup({ p, children }) {
  return (
    <div className="popup">
      <h4>{p.title}</h4>
      <p className="mono" style={{ fontSize: 12 }}>{p.incident_number} · {p.type_name}</p>
      <div className="row"><StatusBadge status={p.status} /><PriorityBadge priority={p.priority} /></div>
      <p style={{ fontSize: 12 }}>{p.address || 'Sin dirección'} · {fmtShort(p.started_at)}</p>
      {children || <Link to={`/incidents/${p.uuid}`}>Ver detalle →</Link>}
    </div>
  );
}

export function IncidentMarkers({ points, onSelect, renderPopup }) {
  return (
    <MarkerClusterGroup chunkedLoading maxClusterRadius={50} showCoverageOnHover={false}>
      {points.map(p => (
        <Marker
          key={p.uuid}
          position={[p.latitude, p.longitude]}
          icon={incidentIcon({ icon: p.type_icon, color: p.color_hex, priority: p.priority })}
          eventHandlers={onSelect ? { click: () => onSelect(p) } : undefined}
        >
          {renderPopup !== null && <Popup minWidth={230}>{renderPopup ? renderPopup(p) : <IncidentPopup p={p} />}</Popup>}
        </Marker>
      ))}
    </MarkerClusterGroup>
  );
}

export function PlaceMarkers({ places, type }) {
  return places.filter(pt => pt.latitude != null && pt.longitude != null).map(pt => (
    <Marker key={`${type || pt.type}-${pt.id}`} position={[pt.latitude, pt.longitude]} icon={infraIcon(type || pt.type)}>
      <Popup minWidth={200}>
        <div className="popup">
          <h4>{pt.name}</h4>
          <p style={{ fontSize: 12 }}>{type === 'POLICIA' ? 'Comisaría' : INFRA_LABELS[pt.type]}{pt.level ? ` · ${pt.level}` : ''}{pt.beds ? ` · ${pt.beds} camas` : ''}</p>
          {pt.address && <p style={{ fontSize: 12 }}>{pt.address}</p>}
          {pt.phone && <p style={{ fontSize: 12 }}>Tel.: <a href={`tel:${pt.phone.replace(/[^\d+]/g, '')}`}>{pt.phone}</a></p>}
        </div>
      </Popup>
    </Marker>
  ));
}
