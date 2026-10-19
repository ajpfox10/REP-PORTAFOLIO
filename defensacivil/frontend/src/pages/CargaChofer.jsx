import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, ZoomControl } from 'react-leaflet';
import { toast } from 'sonner';
import { LocateFixed, MapPin, X, Send, Truck } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import Button from '../components/common/Button';
import { PageHeader, Card, Field, Alert, EmptyState } from '../components/common/ui';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { IncidentMarkers, ClickHandler, FlyTo, IncidentPopup } from '../components/map/MapParts';
import { TILE_URL, TILE_ATTRIBUTION, pickIcon } from '../lib/mapIcons';
import { TypeChip } from '../lib/icons';
import { ACTIVE_STATUSES, STATUSES, STATUS_LABELS, DEFAULT_CENTER } from '../lib/constants';
import { apiError, fmtCoords, fmtAgo } from '../lib/format';

// Móvil en calle: el chofer elige su incidente, informa estado, novedades y posición
export default function CargaChofer() {
  const [points, setPoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newLoc, setNewLoc] = useState(null);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);

  const load = useCallback(async keep => {
    const { data } = await incidentsApi.getMapPoints({});
    const active = data.filter(p => ACTIVE_STATUSES.includes(p.status));
    setPoints(active);
    if (keep) {
      const fresh = data.find(p => p.uuid === keep);
      setSelected(fresh || null);
      setStatus(fresh?.status || '');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const select = p => {
    setSelected(p);
    setStatus(p.status);
    setNotes('');
    setNewLoc(null);
    setError(null);
    setTarget([p.latitude, p.longitude, 15]);
  };

  const gps = () => {
    if (!navigator.geolocation) { setError('Este dispositivo no tiene GPS disponible'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setNewLoc(ll); setTarget([ll.lat, ll.lng, 16]); },
      () => setError('No se pudo obtener la ubicación. Revisá los permisos del navegador.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const changed = selected && (notes.trim() || newLoc || status !== selected.status);

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await incidentsApi.addNote(selected.uuid, {
        notes: notes.trim() || undefined,
        status: status !== selected.status ? status : undefined,
        latitude: newLoc?.lat, longitude: newLoc?.lng,
      });
      toast.success(`${selected.incident_number} actualizado`);
      setNotes('');
      setNewLoc(null);
      await load(selected.uuid);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-full">
      <PageHeader title="Móvil en calle" subtitle="Elegí el incidente asignado e informá estado, novedades y ubicación." />

      <div className="split">
        <div className="panel">
          <Card title="Incidentes activos" hint="Tocá uno para seleccionarlo" bodyClass={null}>
            {points.length === 0 ? <EmptyState icon={Truck} title="Sin incidentes activos" /> : (
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {points.map(p => (
                  <button key={p.uuid} type="button" onClick={() => select(p)} className="card-list-item"
                    style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', border: 0, textAlign: 'left', cursor: 'pointer', background: selected?.uuid === p.uuid ? 'var(--primary-soft)' : 'transparent' }}>
                    <TypeChip icon={p.type_icon} color={p.color_hex} small />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>{p.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{p.incident_number} · {fmtAgo(p.started_at)}</div>
                    </div>
                    <StatusBadge status={p.status} />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <Card title={selected.incident_number} hint={selected.type_name} actions={<Link to={`/incidents/${selected.uuid}`} style={{ fontSize: 13 }}>Detalle</Link>}>
              <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
                <div className="row"><StatusBadge status={selected.status} /><PriorityBadge priority={selected.priority} /></div>
                <strong>{selected.title}</strong>

                <Field label="Estado" htmlFor="c-status">
                  <div className="segmented" id="c-status" role="group" aria-label="Estado">
                    {STATUSES.filter(s => s !== 'RECIBIDO').map(s => (
                      <button type="button" key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABELS[s]}</button>
                    ))}
                  </div>
                </Field>

                <Field label="Novedad" htmlFor="c-notes" hint="Queda en el historial del incidente.">
                  <textarea id="c-notes" className="textarea" rows={3} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej.: Llegamos al lugar, fuego controlado en planta baja." />
                </Field>

                <div className="field">
                  <span className="label">Ubicación</span>
                  <div className="row">
                    <Button type="button" variant="secondary" size="sm" icon={LocateFixed} onClick={gps}>Usar GPS</Button>
                    <span className="muted" style={{ fontSize: 12.5 }}>o tocá el mapa</span>
                  </div>
                  {newLoc && (
                    <div className="row" style={{ justifyContent: 'space-between', color: 'var(--success)', fontSize: 13 }}>
                      <span className="row" style={{ gap: 6 }}><MapPin size={15} /> Nueva: <span className="tabular">{fmtCoords(newLoc.lat, newLoc.lng)}</span></span>
                      <Button type="button" variant="ghost" size="sm" icon={X} aria-label="Descartar ubicación" onClick={() => setNewLoc(null)} />
                    </div>
                  )}
                </div>

                {error && <Alert type="error">{error}</Alert>}
                <Button type="submit" size="lg" block icon={Send} isLoading={saving} disabled={!changed}>Enviar novedad</Button>
              </form>
            </Card>
          )}
        </div>

        <div className="map-card" style={{ minHeight: 480 }}>
          {selected && <span className={`map-hint${newLoc ? ' ok' : ''}`}><MapPin size={14} />{newLoc ? 'Nueva ubicación marcada' : 'Tocá el mapa para corregir la ubicación'}</span>}
          <MapContainer center={DEFAULT_CENTER} zoom={11} zoomControl={false}>
            <ZoomControl position="topright" />
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <FlyTo target={target} />
            <ClickHandler onClick={ll => { if (selected) setNewLoc(ll); }} />
            <IncidentMarkers points={points} renderPopup={p => (
              <IncidentPopup p={p}><button type="button" className="btn btn-primary btn-sm" onClick={() => select(p)}>Seleccionar</button></IncidentPopup>
            )} />
            {newLoc && <Marker position={[newLoc.lat, newLoc.lng]} icon={pickIcon('#17803d')} />}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
