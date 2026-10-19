import L from 'leaflet';
import { renderToStaticMarkup } from 'react-dom/server';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { typeIconFor, INFRA_ICONS } from './icons';
import { INFRA_COLORS } from './constants';

// Íconos de Leaflet servidos desde el propio build (no desde un CDN)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const cache = new Map();
const svg = (Icon, size) => renderToStaticMarkup(<Icon size={size} color="#fff" strokeWidth={2.4} aria-hidden="true" />);

// Incidente: círculo del color del tipo; más grande cuanto mayor la prioridad
export function incidentIcon({ icon, color, priority }) {
  const key = `inc:${icon}:${color}:${priority}`;
  if (!cache.has(key)) {
    const size = priority === 'CRITICA' ? 34 : priority === 'ALTA' ? 30 : 26;
    cache.set(key, L.divIcon({
      className: '',
      html: `<div class="map-pin${priority === 'CRITICA' ? ' pulse' : ''}" style="width:${size}px;height:${size}px;background:${color || '#c62828'}">${svg(typeIconFor(icon), size * 0.5)}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    }));
  }
  return cache.get(key);
}

export function infraIcon(type) {
  const key = `infra:${type}`;
  if (!cache.has(key)) {
    const color = type === 'POLICIA' ? '#1e3a8a' : (INFRA_COLORS[type] || INFRA_COLORS.OTRO);
    cache.set(key, L.divIcon({
      className: '',
      html: `<div class="map-square" style="width:24px;height:24px;background:${color}">${svg(INFRA_ICONS[type] || INFRA_ICONS.OTRO, 13)}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
    }));
  }
  return cache.get(key);
}

// Marca de ubicación elegida por el usuario
export function pickIcon(color = '#e8641b') {
  const key = `pick:${color}`;
  if (!cache.has(key)) {
    cache.set(key, L.divIcon({
      className: '',
      html: `<div style="position:relative;width:32px;height:42px"><svg width="32" height="42" viewBox="0 0 32 42"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5.5" fill="#fff"/></svg></div>`,
      iconSize: [32, 42],
      iconAnchor: [16, 41],
      popupAnchor: [0, -38],
    }));
  }
  return cache.get(key);
}
