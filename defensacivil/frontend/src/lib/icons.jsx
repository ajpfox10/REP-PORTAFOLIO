import {
  Flame, Zap, Car, Droplets, Wind, Building2, Anchor, FlaskConical, HeartPulse,
  CloudLightning, Search, CircleAlert, Hospital, Stethoscope, Ambulance, ShieldHalf,
  Shield, Siren, MapPin,
} from 'lucide-react';

// Los tipos de incidente guardan el nombre del ícono (estilo lucide) en la base
const TYPE_ICONS = {
  fire: Flame, zap: Zap, car: Car, droplets: Droplets, wind: Wind, building: Building2,
  anchor: Anchor, flask: FlaskConical, heart: HeartPulse, 'cloud-lightning': CloudLightning,
  search: Search,
};

export function typeIconFor(name) {
  return TYPE_ICONS[name] || CircleAlert;
}

export function TypeIcon({ name, size = 16, ...rest }) {
  const Icon = typeIconFor(name);
  return <Icon size={size} aria-hidden="true" {...rest} />;
}

// Chip con el ícono del tipo sobre un fondo suave de su color
export function TypeChip({ icon, color, name, small = false }) {
  return (
    <span className="type-chip">
      <span className={`type-icon${small ? ' sm' : ''}`} style={color ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}>
        <TypeIcon name={icon} size={small ? 14 : 16} />
      </span>
      {name && <span className="truncate">{name}</span>}
    </span>
  );
}

export const INFRA_ICONS = {
  HOSPITAL: Hospital, SALITA: Stethoscope, BOMBEROS: Flame, SAME: Ambulance,
  DEFENSA_CIVIL: ShieldHalf, CUARTEL_GN: Shield, OTRO: MapPin, POLICIA: Siren,
};
