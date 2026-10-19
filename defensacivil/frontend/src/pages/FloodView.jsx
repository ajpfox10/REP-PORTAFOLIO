import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer } from 'react-leaflet';
import { Waves, Users, Home, Activity } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import { PageHeader, Card, EmptyState, Loading } from '../components/common/ui';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { IncidentMarkers, FlyTo } from '../components/map/MapParts';
import { TILE_URL, TILE_ATTRIBUTION } from '../lib/mapIcons';
import { ACTIVE_STATUSES, DEFAULT_CENTER } from '../lib/constants';
import { fmtShort, fmtNumber } from '../lib/format';

// Seguimiento de inundaciones: zonas anegadas, personas afectadas y evacuadas
export default function FloodView() {
  const [points, setPoints] = useState(null);
  const [onlyActive, setOnlyActive] = useState(true);
  const [target, setTarget] = useState(null);

  useEffect(() => {
    incidentsApi.getMapPoints({}).then(r => setPoints(r.data.filter(p => p.type_code === 'INUNDACION' || p.type_code === 'TORMENTA')));
  }, []);

  const shown = useMemo(() => (points || []).filter(p => !onlyActive || ACTIVE_STATUSES.includes(p.status)), [points, onlyActive]);
  const totals = shown.reduce((acc, p) => ({
    affected: acc.affected + (p.affected_persons_count || 0),
    evacuated: acc.evacuated + (p.evacuated_count || 0),
  }), { affected: 0, evacuated: 0 });

  if (!points) return <div className="page"><Loading /></div>;

  return (
    <div className="page">
      <PageHeader
        title="Inundaciones y temporales"
        subtitle="Zonas afectadas por agua y tormentas, con personas afectadas y evacuadas."
        actions={
          <div className="segmented" role="group" aria-label="Filtro">
            <button aria-pressed={onlyActive} onClick={() => setOnlyActive(true)}>Activos</button>
            <button aria-pressed={!onlyActive} onClick={() => setOnlyActive(false)}>Todos</button>
          </div>
        }
      />

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="stat-top">Zonas<span className="stat-icon"><Waves size={17} /></span></div><div className="stat-value">{shown.length}</div></div>
        <div className="card stat"><div className="stat-top">En curso<span className="stat-icon"><Activity size={17} /></span></div><div className="stat-value">{shown.filter(p => ACTIVE_STATUSES.includes(p.status)).length}</div></div>
        <div className="card stat"><div className="stat-top">Personas afectadas<span className="stat-icon"><Users size={17} /></span></div><div className="stat-value">{fmtNumber(totals.affected)}</div></div>
        <div className="card stat"><div className="stat-top">Evacuadas<span className="stat-icon"><Home size={17} /></span></div><div className="stat-value">{fmtNumber(totals.evacuated)}</div></div>
      </div>

      <div className="grid grid-dash">
        <div className="map-card" style={{ height: 520 }}>
          <MapContainer center={DEFAULT_CENTER} zoom={10}>
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <FlyTo target={target} />
            <IncidentMarkers points={shown} />
          </MapContainer>
        </div>
        <Card title="Zonas" hint="Ordenadas por evacuados" bodyClass={null}>
          {shown.length === 0 ? <EmptyState icon={Waves} title="Sin zonas afectadas">No hay inundaciones ni temporales {onlyActive ? 'activos' : 'registrados'}.</EmptyState> : (
            <div style={{ maxHeight: 470, overflowY: 'auto' }}>
              {[...shown].sort((a, b) => b.evacuated_count - a.evacuated_count).map(p => (
                <div key={p.uuid} className="card-list-item" style={{ display: 'block', cursor: 'pointer' }} onClick={() => setTarget([p.latitude, p.longitude, 14])}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <Link to={`/incidents/${p.uuid}`} onClick={e => e.stopPropagation()}><strong>{p.title}</strong></Link>
                    <PriorityBadge priority={p.priority} />
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <StatusBadge status={p.status} />
                    <span className="muted tabular" style={{ fontSize: 12.5 }}>{fmtNumber(p.affected_persons_count)} afectadas · {fmtNumber(p.evacuated_count)} evacuadas · {fmtShort(p.started_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
