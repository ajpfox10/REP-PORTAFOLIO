import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, ZoomControl, ScaleControl } from 'react-leaflet';
import { Plus, X } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import { geoApi } from '../api/geo.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import { PageHeader } from '../components/common/ui';
import { IncidentMarkers, PlaceMarkers, FlyTo, PROVINCE_CENTERS } from '../components/map/MapParts';
import { TILE_URL, TILE_ATTRIBUTION } from '../lib/mapIcons';
import { INFRA_ICONS } from '../lib/icons';
import { STATUSES, STATUS_LABELS, ACTIVE_STATUSES, INFRA_TYPES, INFRA_LABELS, INFRA_COLORS, DEFAULT_CENTER } from '../lib/constants';

const LAYERS = [
  { key: 'POLICIA', label: 'Comisarías', color: '#1e3a8a' },
  ...INFRA_TYPES.map(t => ({ key: t, label: INFRA_LABELS[t], color: INFRA_COLORS[t] })),
];

export default function MapView() {
  const { provinces, partidos, incidentTypes, fetchPartidos } = useGeoStore();
  const canCreate = useAuthStore(s => s.hasRole('admin', 'medium', 'telefonista'));

  const [filters, setFilters] = useState({ province_id: '', partido_id: '', incident_type_id: '', status: 'ACTIVOS' });
  const [points, setPoints] = useState([]);
  const [stations, setStations] = useState([]);
  const [infra, setInfra] = useState([]);
  const [layers, setLayers] = useState({ POLICIA: true, HOSPITAL: true, SALITA: false, BOMBEROS: true, SAME: true, DEFENSA_CIVIL: true, CUARTEL_GN: false, OTRO: false });
  const [target, setTarget] = useState(null);

  useEffect(() => { if (filters.province_id) fetchPartidos(filters.province_id); }, [filters.province_id, fetchPartidos]);

  useEffect(() => {
    const params = {};
    for (const k of ['province_id', 'partido_id', 'incident_type_id']) if (filters[k]) params[k] = filters[k];
    if (filters.status && filters.status !== 'ACTIVOS') params.status = filters.status;
    incidentsApi.getMapPoints(params).then(r => setPoints(
      filters.status === 'ACTIVOS' ? r.data.filter(p => ACTIVE_STATUSES.includes(p.status)) : r.data
    ));
  }, [filters]);

  useEffect(() => {
    const scope = filters.province_id ? { province_id: filters.province_id } : {};
    geoApi.getPoliceStations(filters.province_id).then(r => setStations(r.data));
    geoApi.getInfrastructure({ ...scope, ...(filters.partido_id ? { partido_id: filters.partido_id } : {}) }).then(r => setInfra(r.data));
  }, [filters.province_id, filters.partido_id]);

  const setFilter = (key, value) => setFilters(f => {
    const next = { ...f, [key]: value };
    if (key === 'province_id') {
      next.partido_id = '';
      const code = provinces.find(p => String(p.id) === value)?.code;
      setTarget(code ? PROVINCE_CENTERS[code] : [...DEFAULT_CENTER, 10]);
    }
    if (key === 'partido_id' && value) {
      const pa = (partidos[f.province_id] || []).find(p => String(p.id) === value);
      if (pa?.latitude) setTarget([pa.latitude, pa.longitude, 12]);
    }
    return next;
  });

  const visibleInfra = useMemo(() => infra.filter(pt => layers[pt.type]), [infra, layers]);
  const critical = points.filter(p => p.priority === 'CRITICA').length;

  return (
    <div className="page page-full">
      <PageHeader
        title="Mapa operativo"
        subtitle={`${points.length} incidentes en el mapa${critical ? ` · ${critical} críticos` : ''}`}
        actions={canCreate && <Button icon={Plus} to="/incidents/new">Nuevo incidente</Button>}
      />

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="toolbar">
          <select className="select" value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Estado">
            <option value="ACTIVOS">Solo activos</option>
            <option value="">Todos los estados</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select className="select" value={filters.incident_type_id} onChange={e => setFilter('incident_type_id', e.target.value)} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" value={filters.province_id} onChange={e => setFilter('province_id', e.target.value)} aria-label="Provincia">
            <option value="">Todo el país</option>
            {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" value={filters.partido_id} onChange={e => setFilter('partido_id', e.target.value)} disabled={!filters.province_id} aria-label="Partido">
            <option value="">{filters.province_id ? 'Todos los partidos' : 'Elegí provincia'}</option>
            {(partidos[filters.province_id] || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(filters.province_id || filters.incident_type_id || filters.status !== 'ACTIVOS') && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setFilters({ province_id: '', partido_id: '', incident_type_id: '', status: 'ACTIVOS' }); setTarget([...DEFAULT_CENTER, 10]); }}>Limpiar</Button>
          )}
        </div>
        <div className="row" style={{ padding: '0 16px 14px', gap: 6 }}>
          <span className="muted" style={{ fontSize: 12.5, marginRight: 4 }}>Capas:</span>
          {LAYERS.map(({ key, label, color }) => {
            const Icon = INFRA_ICONS[key];
            return (
              <label key={key} className="layer-toggle" data-on={layers[key]}>
                <input type="checkbox" checked={layers[key]} onChange={() => setLayers(l => ({ ...l, [key]: !l[key] }))} />
                <span className="sw" style={{ background: color }}><Icon size={11} /></span>
                {label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="map-card" style={{ flex: 1, minHeight: 460 }}>
        <MapContainer center={DEFAULT_CENTER} zoom={10} zoomControl={false}>
          <ZoomControl position="topright" />
          <ScaleControl position="bottomright" imperial={false} />
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
          <FlyTo target={target} />
          {layers.POLICIA && <PlaceMarkers places={stations} type="POLICIA" />}
          <PlaceMarkers places={visibleInfra} />
          <IncidentMarkers points={points} />
        </MapContainer>
      </div>
    </div>
  );
}
