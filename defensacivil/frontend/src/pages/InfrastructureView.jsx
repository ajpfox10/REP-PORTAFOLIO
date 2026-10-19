import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search, Building2, Phone } from 'lucide-react';
import { geoApi } from '../api/geo.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { PageHeader, Card, EmptyState, Loading, Field, Alert } from '../components/common/ui';
import { PlaceMarkers, FlyTo, ClickHandler } from '../components/map/MapParts';
import { TILE_URL, TILE_ATTRIBUTION, pickIcon } from '../lib/mapIcons';
import { INFRA_ICONS } from '../lib/icons';
import { INFRA_TYPES, INFRA_LABELS, INFRA_COLORS, DEFAULT_CENTER } from '../lib/constants';
import { apiError, fieldErrors, fmtCoords } from '../lib/format';

const EMPTY = { type: 'HOSPITAL', name: '', address: '', phone: '', province_id: '', partido_id: '', latitude: '', longitude: '', beds: '', level: '' };

function PlaceForm({ value, onChange, isStation, errors }) {
  const { provinces, partidos, fetchPartidos } = useGeoStore();
  useEffect(() => { if (value.province_id) fetchPartidos(value.province_id); }, [value.province_id, fetchPartidos]);
  const set = key => e => onChange({ ...value, [key]: e.target.value, ...(key === 'province_id' ? { partido_id: '' } : {}) });
  const hasPoint = value.latitude !== '' && value.longitude !== '';

  return (
    <div className="form-grid">
      {!isStation && (
        <Field label="Tipo" htmlFor="pl-type" required error={errors.type}>
          <select id="pl-type" className="select" value={value.type} onChange={set('type')}>
            {INFRA_TYPES.map(t => <option key={t} value={t}>{INFRA_LABELS[t]}</option>)}
          </select>
        </Field>
      )}
      <Field label="Nombre" htmlFor="pl-name" required error={errors.name} className={isStation ? 'full' : ''}>
        <input id="pl-name" className={`input${errors.name ? ' invalid' : ''}`} value={value.name} onChange={set('name')} />
      </Field>
      <Field label="Dirección" htmlFor="pl-address" className="full"><input id="pl-address" className="input" value={value.address} onChange={set('address')} /></Field>
      <Field label="Teléfono" htmlFor="pl-phone" error={errors.phone}><input id="pl-phone" className="input" value={value.phone} onChange={set('phone')} /></Field>
      {!isStation ? (
        <Field label="Camas" htmlFor="pl-beds" error={errors.beds}><input id="pl-beds" type="number" min="0" className="input" value={value.beds} onChange={set('beds')} /></Field>
      ) : <div />}
      <Field label="Provincia" htmlFor="pl-prov">
        <select id="pl-prov" className="select" value={value.province_id} onChange={set('province_id')}>
          <option value="">Seleccionar…</option>
          {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Partido" htmlFor="pl-partido">
        <select id="pl-partido" className="select" value={value.partido_id} onChange={set('partido_id')} disabled={!value.province_id}>
          <option value="">Seleccionar…</option>
          {(partidos[value.province_id] || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {!isStation && <Field label="Nivel de complejidad" htmlFor="pl-level" className="full"><input id="pl-level" className="input" value={value.level} onChange={set('level')} placeholder="Ej.: Alta complejidad" /></Field>}
      <div className="full field">
        <span className="label">Ubicación {hasPoint && <span className="muted tabular" style={{ fontWeight: 400 }}>· {fmtCoords(value.latitude, value.longitude)}</span>}</span>
        {(errors.latitude || errors.longitude) && <span className="field-error">{errors.latitude || errors.longitude}</span>}
        <div className="map-card" style={{ height: 220, minHeight: 0 }}>
          <MapContainer center={hasPoint ? [Number(value.latitude), Number(value.longitude)] : DEFAULT_CENTER} zoom={hasPoint ? 14 : 9}>
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <ClickHandler onClick={ll => onChange({ ...value, latitude: ll.lat.toFixed(6), longitude: ll.lng.toFixed(6) })} />
            {hasPoint && <Marker position={[Number(value.latitude), Number(value.longitude)]} icon={pickIcon()} />}
          </MapContainer>
        </div>
        <span className="field-hint">Hacé clic en el mapa para ubicarlo.</span>
      </div>
    </div>
  );
}

const toPayload = (v, isStation) => {
  const out = {
    name: v.name.trim(), address: v.address, phone: v.phone,
    province_id: v.province_id ? Number(v.province_id) : null,
    partido_id: v.partido_id ? Number(v.partido_id) : null,
    latitude: v.latitude === '' ? null : Number(v.latitude),
    longitude: v.longitude === '' ? null : Number(v.longitude),
  };
  if (!isStation) Object.assign(out, { type: v.type, beds: v.beds === '' ? null : Number(v.beds), level: v.level });
  return out;
};

export default function InfrastructureView() {
  const canEdit = useAuthStore(s => s.canEditGeo());
  const [tab, setTab] = useState('infra');
  const [places, setPlaces] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);   // { id?, value }
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [target, setTarget] = useState(null);
  const isStation = tab === 'police';

  const load = useCallback(() => {
    setPlaces(null);
    (isStation ? geoApi.getPoliceStations() : geoApi.getInfrastructure()).then(r => setPlaces(r.data));
  }, [isStation]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (places || []).filter(p => (!typeFilter || p.type === typeFilter) &&
      (!q || [p.name, p.address, p.partido_name].some(f => f?.toLowerCase().includes(q))));
  }, [places, typeFilter, search]);

  const openEdit = p => {
    setFormError(null);
    const s = v => (v == null ? '' : String(v));
    setEditing(p ? { id: p.id, value: { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, s(p[k])])), type: p.type || 'HOSPITAL' } } : { value: { ...EMPTY } });
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(editing.value, isStation);
      if (isStation) await (editing.id ? geoApi.updatePoliceStation(editing.id, payload) : geoApi.createPoliceStation(payload));
      else await (editing.id ? geoApi.updateInfrastructure(editing.id, payload) : geoApi.createInfrastructure(payload));
      toast.success(editing.id ? 'Cambios guardados' : 'Punto agregado');
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await (isStation ? geoApi.deletePoliceStation(toDelete.id) : geoApi.deleteInfrastructure(toDelete.id));
      toast.success(`${toDelete.name} dado de baja`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Infraestructura"
        subtitle="Hospitales, cuarteles, bases y comisarías para coordinar la respuesta."
        actions={canEdit && <Button icon={Plus} onClick={() => openEdit(null)}>{isStation ? 'Nueva comisaría' : 'Nuevo punto'}</Button>}
      />

      <div className="grid grid-dash">
        <Card bodyClass={null}>
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={!isStation} onClick={() => { setTab('infra'); setTypeFilter(''); }}><Building2 size={15} /> Infraestructura</button>
            <button className="tab" role="tab" aria-selected={isStation} onClick={() => { setTab('police'); setTypeFilter(''); }}>{(() => { const I = INFRA_ICONS.POLICIA; return <I size={15} />; })()} Comisarías</button>
          </div>
          <div className="toolbar">
            <div className="input-group"><Search size={16} /><input className="input" placeholder="Buscar por nombre, dirección o partido" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar" /></div>
            {!isStation && (
              <select className="select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Tipo">
                <option value="">Todos los tipos</option>
                {INFRA_TYPES.map(t => <option key={t} value={t}>{INFRA_LABELS[t]}</option>)}
              </select>
            )}
          </div>
          {!places ? <Loading /> : shown.length === 0 ? <EmptyState icon={Building2} title="Sin resultados" /> : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {shown.map(p => {
                const Icon = INFRA_ICONS[isStation ? 'POLICIA' : p.type];
                const color = isStation ? '#1e3a8a' : INFRA_COLORS[p.type];
                return (
                  <div key={p.id} className="list-row" style={{ padding: '12px 16px', cursor: p.latitude ? 'pointer' : 'default' }} onClick={() => p.latitude && setTarget([p.latitude, p.longitude, 15])}>
                    <span className="type-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}><Icon size={16} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong className="truncate" style={{ display: 'block' }}>{p.name}</strong>
                      <div className="muted truncate" style={{ fontSize: 12.5 }}>
                        {[!isStation && INFRA_LABELS[p.type], p.partido_name || p.province_name, p.beds && `${p.beds} camas`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {p.phone && <a className="btn btn-ghost btn-sm btn-icon" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} aria-label={`Llamar a ${p.name}`} onClick={e => e.stopPropagation()}><Phone size={15} /></a>}
                    {canEdit && <>
                      <Button variant="ghost" size="sm" icon={Pencil} aria-label={`Editar ${p.name}`} onClick={e => { e.stopPropagation(); openEdit(p); }} />
                      <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Dar de baja ${p.name}`} onClick={e => { e.stopPropagation(); setToDelete(p); }} />
                    </>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="map-card" style={{ height: 640 }}>
          <MapContainer center={DEFAULT_CENTER} zoom={9}>
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <FlyTo target={target} />
            <PlaceMarkers places={shown} type={isStation ? 'POLICIA' : undefined} />
          </MapContainer>
        </div>
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar' : isStation ? 'Nueva comisaría' : 'Nuevo punto de infraestructura'}
        width={640}
        footer={<>
          <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button onClick={save} isLoading={saving} disabled={!editing?.value.name.trim()}>Guardar</Button>
        </>}
      >
        {formError && <Alert type="error" style={{ marginBottom: 14 }}>{apiError(formError)}</Alert>}
        {editing && <PlaceForm value={editing.value} onChange={value => setEditing(e => ({ ...e, value }))} isStation={isStation} errors={fieldErrors(formError)} />}
      </Modal>

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Dar de baja"
        confirmLabel="Dar de baja"
        message={`¿Dar de baja «${toDelete?.name}»? Deja de mostrarse en los mapas.`}
      />
    </div>
  );
}
