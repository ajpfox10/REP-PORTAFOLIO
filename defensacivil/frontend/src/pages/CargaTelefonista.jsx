import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, ZoomControl } from 'react-leaflet';
import { toast } from 'sonner';
import { PhoneIncoming, MapPin, CheckCircle2, MousePointerClick, X } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore from '../store/geoStore';
import Button from '../components/common/Button';
import { PageHeader, Card, Field, Alert } from '../components/common/ui';
import { StatusBadge } from '../components/common/Badge';
import { IncidentMarkers, ClickHandler } from '../components/map/MapParts';
import { TILE_URL, TILE_ATTRIBUTION, pickIcon } from '../lib/mapIcons';
import { TypeChip } from '../lib/icons';
import { PRIORITIES, PRIORITY_LABELS, ACTIVE_STATUSES, DEFAULT_CENTER } from '../lib/constants';
import { apiError, fieldErrors, fmtCoords, fmtAgo } from '../lib/format';

const EMPTY = { incident_type_id: '', description: '', priority: 'ALTA', address: '', caller: '' };

// Central telefónica: se atiende la llamada, se marca el lugar y se registra en segundos
export default function CargaTelefonista() {
  const { incidentTypes } = useGeoStore();
  const [points, setPoints] = useState([]);
  const [loc, setLoc] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const loadPoints = useCallback(() => incidentsApi.getMapPoints({}).then(r => setPoints(r.data.filter(p => ACTIVE_STATUSES.includes(p.status)))), []);
  useEffect(() => { loadPoints(); }, [loadPoints]);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError(null);
    if (!loc) { setError({ message: 'Marcá en el mapa el lugar del incidente.' }); return; }
    const type = incidentTypes.find(t => String(t.id) === form.incident_type_id);
    const title = `${type?.name || 'Incidente'}${form.address ? ` en ${form.address}` : ''}`.slice(0, 200);
    setSaving(true);
    try {
      const { data } = await incidentsApi.create({
        incident_type_id: Number(form.incident_type_id),
        title,
        description: form.description,
        priority: form.priority,
        address: form.address || undefined,
        notes: form.caller ? `Llamante: ${form.caller}` : undefined,
        latitude: loc.lat,
        longitude: loc.lng,
      });
      setCreated(data);
      toast.success(`Registrado ${data.incident_number}`);
      setForm(EMPTY);
      setLoc(null);
      loadPoints();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const errs = fieldErrors(error);

  return (
    <div className="page page-full">
      <PageHeader title="Central telefónica" subtitle="Atendé la llamada, marcá el lugar en el mapa y registrá el incidente." />

      <div className="split">
        <div className="panel">
          {created && (
            <Alert type="success">
              <strong>{created.incident_number}</strong> registrado. <Link to={`/incidents/${created.uuid}`}>Ver detalle</Link>
            </Alert>
          )}

          <Card title="Nueva llamada" actions={<PhoneIncoming size={18} className="muted" />}>
            <form onSubmit={submit} className="stack" style={{ gap: 14 }} noValidate>
              <div className="row" style={{ padding: '10px 12px', borderRadius: 10, border: `1px ${loc ? 'solid' : 'dashed'} var(--border-2)`, background: loc ? 'var(--success-soft)' : 'transparent', justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 8, color: loc ? 'var(--success)' : 'var(--text-3)' }}>
                  {loc ? <CheckCircle2 size={17} /> : <MousePointerClick size={17} />}
                  {loc ? <span className="tabular">{fmtCoords(loc.lat, loc.lng)}</span> : 'Hacé clic en el mapa para marcar el lugar'}
                </span>
                {loc && <Button variant="ghost" size="sm" icon={X} aria-label="Quitar ubicación" onClick={() => setLoc(null)} />}
              </div>

              <Field label="Tipo de incidente" htmlFor="t-type" required error={errs.incident_type_id}>
                <select id="t-type" className="select" value={form.incident_type_id} onChange={set('incident_type_id')} required>
                  <option value="">Seleccionar…</option>
                  {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Qué informa quien llama" htmlFor="t-desc" required error={errs.description} hint="Mínimo 10 caracteres.">
                <textarea id="t-desc" className="textarea" rows={4} value={form.description} onChange={set('description')} placeholder="Ej.: Humo saliendo de un galpón, hay personas en la vereda…" />
              </Field>
              <div className="form-grid">
                <Field label="Prioridad" htmlFor="t-priority">
                  <select id="t-priority" className="select" value={form.priority} onChange={set('priority')}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </Field>
                <Field label="Quién llama" htmlFor="t-caller">
                  <input id="t-caller" className="input" value={form.caller} onChange={set('caller')} placeholder="Nombre y teléfono" />
                </Field>
              </div>
              <Field label="Dirección o referencia" htmlFor="t-address" error={errs.address}>
                <input id="t-address" className="input" value={form.address} onChange={set('address')} placeholder="Ej.: Av. San Martín 1200" />
              </Field>

              {error && !Object.keys(errs).length && <Alert type="error">{error.message && !error.response ? error.message : apiError(error)}</Alert>}
              <Button type="submit" size="lg" block isLoading={saving} disabled={!form.incident_type_id || form.description.trim().length < 10}>Registrar incidente</Button>
            </form>
          </Card>

          <Card title="Activos" hint={`${points.length} en curso`} bodyClass={null}>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {points.slice(0, 20).map(p => (
                <Link key={p.uuid} to={`/incidents/${p.uuid}`} className="card-list-item" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <TypeChip icon={p.type_icon} color={p.color_hex} small />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 600, color: 'var(--text)' }}>{p.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmtAgo(p.started_at)}</div>
                  </div>
                  <StatusBadge status={p.status} />
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="map-card" style={{ minHeight: 480 }}>
          <span className={`map-hint${loc ? ' ok' : ''}`}><MapPin size={14} />{loc ? 'Lugar marcado · clic para ajustar' : 'Clic en el mapa para marcar el lugar'}</span>
          <MapContainer center={DEFAULT_CENTER} zoom={11} zoomControl={false}>
            <ZoomControl position="topright" />
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <ClickHandler onClick={ll => { setLoc(ll); setCreated(null); }} />
            <IncidentMarkers points={points} />
            {loc && <Marker position={[loc.lat, loc.lng]} icon={pickIcon()} />}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
