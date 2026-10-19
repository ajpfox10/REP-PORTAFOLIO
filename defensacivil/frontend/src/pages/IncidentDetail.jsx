import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { toast } from 'sonner';
import { Pencil, Trash2, RefreshCw, Plus, X, Truck, Package, History, MapPin } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import useAuthStore from '../store/authStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { PageHeader, Card, EmptyState, Loading, Alert, Field } from '../components/common/ui';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { TypeChip } from '../lib/icons';
import { TILE_URL, TILE_ATTRIBUTION, incidentIcon } from '../lib/mapIcons';
import { STATUSES, STATUS_LABELS, UNIT_TYPES, UNIT_LABELS, RESOURCE_TYPES, RESOURCE_LABELS } from '../lib/constants';
import { fmtDateTime, fmtCoords, apiError } from '../lib/format';

const EMPTY_UNIT = { unit_name: '', unit_type: 'BOMBEROS', unit_number: '', personnel_count: '' };
const EMPTY_RES = { resource_type: 'VEHICULO', resource_name: '', quantity: 1 };

export default function IncidentDetail() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const role = useAuthStore(s => s.user?.role);
  const canWrite = ['admin', 'medium', 'telefonista', 'chofer'].includes(role);
  const canEdit = ['admin', 'medium', 'telefonista'].includes(role);
  const isAdmin = role === 'admin';

  const [incident, setIncident] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: '', notes: '' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState(EMPTY_UNIT);
  const [resource, setResource] = useState(EMPTY_RES);

  const load = useCallback(async () => {
    try {
      const [inc, hist] = await Promise.all([incidentsApi.getOne(uuid), incidentsApi.getHistory(uuid)]);
      setIncident(inc.data);
      setHistory(hist.data);
    } catch (err) {
      setError(apiError(err, 'No se pudo cargar el incidente'));
    }
  }, [uuid]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) toast.success(okMessage);
      await load();
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async () => {
    if (await run(() => incidentsApi.updateStatus(uuid, statusForm), 'Estado actualizado')) setStatusOpen(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await incidentsApi.delete(uuid);
      toast.success('Incidente eliminado');
      navigate('/incidents');
    } catch (err) {
      toast.error(apiError(err));
      setBusy(false);
    }
  };

  const addUnit = async e => {
    e.preventDefault();
    const payload = { ...unit, personnel_count: Number(unit.personnel_count) || 0, arrived_at: new Date().toISOString() };
    if (await run(() => incidentsApi.addUnit(uuid, payload), 'Unidad agregada')) setUnit(EMPTY_UNIT);
  };

  const addResource = async e => {
    e.preventDefault();
    const payload = { ...resource, quantity: Number(resource.quantity) || 1 };
    if (await run(() => incidentsApi.addResource(uuid, payload), 'Recurso agregado')) setResource(EMPTY_RES);
  };

  if (error) return <div className="page"><Alert type="error">{error}</Alert></div>;
  if (!incident) return <div className="page"><Loading /></div>;

  const hasCoords = incident.latitude != null && incident.longitude != null;
  const location = [incident.locality_name, incident.partido_name, incident.province_name].filter(Boolean).join(', ');

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/incidents', label: 'Incidentes' }}
        title={incident.title}
        subtitle={<span className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="mono">{incident.incident_number}</span>
          <StatusBadge status={incident.status} />
          <PriorityBadge priority={incident.priority} />
        </span>}
        actions={<>
          {canWrite && <Button variant="secondary" icon={RefreshCw} onClick={() => { setStatusForm({ status: incident.status, notes: '' }); setStatusOpen(true); }}>Cambiar estado</Button>}
          {canEdit && <Button variant="secondary" icon={Pencil} to={`/incidents/${uuid}/edit`}>Editar</Button>}
          {isAdmin && <Button variant="danger-soft" icon={Trash2} onClick={() => setDeleteOpen(true)} aria-label="Eliminar" />}
        </>}
      />

      <div className="grid grid-dash">
        <div className="stack">
          <Card title="Detalle">
            <div className="people" style={{ marginBottom: 18 }}>
              <div><strong>{incident.affected_persons_count}</strong><span>Afectadas</span></div>
              <div className={incident.injured_count ? 'danger' : ''}><strong>{incident.injured_count}</strong><span>Heridas</span></div>
              <div className={incident.deceased_count ? 'danger' : ''}><strong>{incident.deceased_count}</strong><span>Fallecidas</span></div>
              <div><strong>{incident.evacuated_count}</strong><span>Evacuadas</span></div>
            </div>
            <dl className="kv">
              <dt>Tipo</dt><dd><TypeChip icon={incident.type_icon} color={incident.color_hex} name={[incident.type_name, incident.subtype_name].filter(Boolean).join(' · ')} small /></dd>
              <dt>Descripción</dt><dd style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{incident.description}</dd>
              <dt>Dirección</dt><dd>{incident.address || '—'}</dd>
              <dt>Zona</dt><dd>{location || '—'}</dd>
              <dt>Responsable</dt><dd>{incident.assigned_officer || '—'}</dd>
              <dt>Registrado por</dt><dd>{incident.reporter_full_name}</dd>
              <dt>Inicio</dt><dd className="tabular">{fmtDateTime(incident.started_at)}</dd>
              {incident.controlled_at && <><dt>Controlado</dt><dd className="tabular">{fmtDateTime(incident.controlled_at)}</dd></>}
              {incident.closed_at && <><dt>Cerrado</dt><dd className="tabular">{fmtDateTime(incident.closed_at)}</dd></>}
              {incident.notes && <><dt>Notas</dt><dd style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{incident.notes}</dd></>}
            </dl>
          </Card>

          <Card title="Unidades en el lugar" hint={`${incident.units.length} asignadas`}>
            {incident.units.length === 0 && <EmptyState icon={Truck} title="Sin unidades">Todavía no se asignaron unidades.</EmptyState>}
            {incident.units.map(u => (
              <div className="list-row" key={u.id}>
                <span className="type-icon"><Truck size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{u.unit_name}</strong>{u.unit_number && <span className="muted"> · Móvil {u.unit_number}</span>}
                  <div className="muted" style={{ fontSize: 12.5 }}>{UNIT_LABELS[u.unit_type]}{u.personnel_count ? ` · ${u.personnel_count} personas` : ''}{u.arrived_at ? ` · llegó ${fmtDateTime(u.arrived_at)}` : ''}</div>
                </div>
                {canWrite && <Button variant="ghost" size="sm" icon={X} aria-label={`Quitar ${u.unit_name}`} onClick={() => run(() => incidentsApi.removeUnit(uuid, u.id), 'Unidad quitada')} />}
              </div>
            ))}
            {canWrite && (
              <form onSubmit={addUnit} className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
                <input className="input input-sm" style={{ flex: '2 1 160px' }} placeholder="Nombre (ej.: Dotación 12)" value={unit.unit_name} onChange={e => setUnit(f => ({ ...f, unit_name: e.target.value }))} required aria-label="Nombre de la unidad" />
                <select className="select select-sm" style={{ flex: '1 1 130px' }} value={unit.unit_type} onChange={e => setUnit(f => ({ ...f, unit_type: e.target.value }))} aria-label="Tipo de unidad">
                  {UNIT_TYPES.map(t => <option key={t} value={t}>{UNIT_LABELS[t]}</option>)}
                </select>
                <input className="input input-sm" style={{ flex: '0 1 90px' }} placeholder="Móvil" value={unit.unit_number} onChange={e => setUnit(f => ({ ...f, unit_number: e.target.value }))} aria-label="Número de móvil" />
                <input className="input input-sm" type="number" min="0" style={{ flex: '0 1 90px' }} placeholder="Personas" value={unit.personnel_count} onChange={e => setUnit(f => ({ ...f, personnel_count: e.target.value }))} aria-label="Personas" />
                <Button type="submit" size="sm" icon={Plus} disabled={busy || !unit.unit_name.trim()}>Agregar</Button>
              </form>
            )}
          </Card>

          <Card title="Recursos" hint={`${incident.resources.length} cargados`}>
            {incident.resources.length === 0 && <EmptyState icon={Package} title="Sin recursos">No se cargaron vehículos, equipos ni materiales.</EmptyState>}
            {incident.resources.map(r => (
              <div className="list-row" key={r.id}>
                <span className="type-icon"><Package size={16} /></span>
                <div style={{ flex: 1 }}>
                  <strong>{r.resource_name}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }}>{RESOURCE_LABELS[r.resource_type]} · cantidad {r.quantity}</div>
                </div>
                {canWrite && <Button variant="ghost" size="sm" icon={X} aria-label={`Quitar ${r.resource_name}`} onClick={() => run(() => incidentsApi.removeResource(uuid, r.id), 'Recurso quitado')} />}
              </div>
            ))}
            {canWrite && (
              <form onSubmit={addResource} className="row" style={{ marginTop: 14 }}>
                <select className="select select-sm" style={{ flex: '1 1 130px' }} value={resource.resource_type} onChange={e => setResource(f => ({ ...f, resource_type: e.target.value }))} aria-label="Tipo de recurso">
                  {RESOURCE_TYPES.map(t => <option key={t} value={t}>{RESOURCE_LABELS[t]}</option>)}
                </select>
                <input className="input input-sm" style={{ flex: '2 1 160px' }} placeholder="Nombre (ej.: Motobomba)" value={resource.resource_name} onChange={e => setResource(f => ({ ...f, resource_name: e.target.value }))} required aria-label="Nombre del recurso" />
                <input className="input input-sm" type="number" min="1" style={{ flex: '0 1 80px' }} value={resource.quantity} onChange={e => setResource(f => ({ ...f, quantity: e.target.value }))} aria-label="Cantidad" />
                <Button type="submit" size="sm" icon={Plus} disabled={busy || !resource.resource_name.trim()}>Agregar</Button>
              </form>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Ubicación" hint={hasCoords ? fmtCoords(incident.latitude, incident.longitude) : 'Sin coordenadas'} bodyClass={hasCoords ? null : 'card-body'}>
            {hasCoords ? (
              <div className="map-card" style={{ height: 260, borderRadius: '0 0 14px 14px', border: 0 }}>
                <MapContainer center={[incident.latitude, incident.longitude]} zoom={15} scrollWheelZoom={false}>
                  <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
                  <Marker position={[incident.latitude, incident.longitude]} icon={incidentIcon({ icon: incident.type_icon, color: incident.color_hex, priority: incident.priority })} />
                </MapContainer>
              </div>
            ) : <EmptyState icon={MapPin} title="Sin ubicación">Se puede marcar desde Editar.</EmptyState>}
          </Card>

          <Card title="Historial" hint={`${history.length} movimientos`}>
            {history.length === 0 ? <EmptyState icon={History} title="Sin movimientos" /> : (
              <ol className="timeline">
                {[...history].reverse().map(h => (
                  <li key={h.id} className={`st-${h.new_status}`}>
                    <span className="node" aria-hidden="true" />
                    <div className="row" style={{ gap: 6 }}>
                      <StatusBadge status={h.new_status} />
                      {h.previous_status && h.previous_status !== h.new_status && <span className="muted" style={{ fontSize: 12.5 }}>desde {STATUS_LABELS[h.previous_status]}</span>}
                    </div>
                    {h.notes && <div className="note">{h.notes}</div>}
                    <div className="meta">{h.full_name || 'Usuario eliminado'} · {fmtDateTime(h.changed_at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <Modal
        isOpen={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Cambiar estado"
        width={440}
        footer={<>
          <Button variant="secondary" onClick={() => setStatusOpen(false)}>Cancelar</Button>
          <Button onClick={changeStatus} isLoading={busy} disabled={statusForm.status === incident.status && !statusForm.notes.trim()}>Guardar</Button>
        </>}
      >
        <div className="stack" style={{ gap: 14 }}>
          <Field label="Nuevo estado" htmlFor="st-status">
            <select id="st-status" className="select" value={statusForm.status} onChange={e => setStatusForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <Field label="Nota" htmlFor="st-notes" hint="Queda en el historial del incidente.">
            <textarea id="st-notes" className="textarea" rows={3} maxLength={500} value={statusForm.notes} onChange={e => setStatusForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        isLoading={busy}
        title="Eliminar incidente"
        confirmLabel="Eliminar"
        message={`¿Eliminar ${incident.incident_number}? Deja de verse en listados y mapas, pero queda registrado en la auditoría.`}
      />
    </div>
  );
}
