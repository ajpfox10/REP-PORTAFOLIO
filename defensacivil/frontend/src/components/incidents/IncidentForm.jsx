import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { MapPin, X } from 'lucide-react';
import useGeoStore from '../../store/geoStore';
import Button from '../common/Button';
import { Field } from '../common/ui';
import CoordPicker from './CoordPicker';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '../../lib/constants';
import { fmtCoords } from '../../lib/format';

const NUMBER_FIELDS = ['affected_persons_count', 'injured_count', 'deceased_count', 'evacuated_count'];
const ID_FIELDS = ['incident_type_id', 'incident_subtype_id', 'province_id', 'partido_id', 'locality_id'];

const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Convierte los valores del formulario al formato de la API
function toPayload(values) {
  const out = { ...values };
  for (const f of NUMBER_FIELDS) out[f] = Number(out[f]) || 0;
  for (const f of ID_FIELDS) out[f] = out[f] ? Number(out[f]) : null;
  out.latitude  = out.latitude  === '' || out.latitude  == null ? null : Number(out.latitude);
  out.longitude = out.longitude === '' || out.longitude == null ? null : Number(out.longitude);
  return out;
}

export default function IncidentForm({ defaultValues, onSubmit, serverErrors = {}, showStatus = false }) {
  const { incidentTypes, provinces, partidos, localities, fetchPartidos, fetchLocalities } = useGeoStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { register, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm({
    defaultValues: {
      priority: 'MEDIA', affected_persons_count: 0, injured_count: 0, deceased_count: 0, evacuated_count: 0,
      ...defaultValues,
    },
  });

  const [typeId, provinceId, partidoId, lat, lng] = watch(['incident_type_id', 'province_id', 'partido_id', 'latitude', 'longitude']);
  const subtypes = incidentTypes.find(t => String(t.id) === String(typeId))?.subtypes || [];
  const partidoList = partidos[provinceId] || [];
  const localityList = localities[partidoId] || [];

  // Al cambiar provincia o partido se limpian los niveles inferiores, pero no
  // en la primera carga (si no, al editar se perdían partido y localidad)
  const first = useRef({ province: true, partido: true });
  useEffect(() => {
    if (provinceId) fetchPartidos(provinceId);
    if (first.current.province) { first.current.province = false; return; }
    setValue('partido_id', '');
    setValue('locality_id', '');
  }, [provinceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (partidoId) fetchLocalities(partidoId);
    if (first.current.partido) { first.current.partido = false; return; }
    setValue('locality_id', '');
  }, [partidoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Las opciones de partido, localidad y subtipo llegan después que los valores
  // guardados: cuando aparecen, se vuelve a aplicar el valor para que se vea
  useEffect(() => { setValue('partido_id', getValues('partido_id')); }, [partidoList.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setValue('locality_id', getValues('locality_id')); }, [localityList.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setValue('incident_subtype_id', getValues('incident_subtype_id')); }, [subtypes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setValue('province_id', getValues('province_id')); setValue('incident_type_id', getValues('incident_type_id')); }, [provinces.length, incidentTypes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const err = name => errors[name]?.message || serverErrors[name];
  const cls = (base, name) => `${base}${err(name) ? ' invalid' : ''}`;

  const handlePick = async (pickedLat, pickedLng, geo) => {
    setValue('latitude', pickedLat.toFixed(6));
    setValue('longitude', pickedLng.toFixed(6));
    if (geo?.address) setValue('address', [geo.address, geo.locality].filter(Boolean).join(', '));
    const province = geo?.province && provinces.find(p => normalize(geo.province).includes(normalize(p.name)) || normalize(p.name).includes(normalize(geo.province)));
    if (province) {
      first.current.province = true;
      setValue('province_id', String(province.id));
      await fetchPartidos(province.id);
      const list = useGeoStore.getState().partidos[province.id] || [];
      const partido = geo.partido && list.find(pa => normalize(geo.partido).includes(normalize(pa.name)));
      if (partido) setValue('partido_id', String(partido.id));
    }
    setPickerOpen(false);
  };

  return (
    <>
      <form id="incident-form" onSubmit={handleSubmit(v => onSubmit(toPayload(v)))} noValidate className="form-grid">
        <div className="form-section">Qué pasó</div>

        <Field label="Tipo de incidente" htmlFor="f-type" required error={err('incident_type_id')}>
          <select id="f-type" className={cls('select', 'incident_type_id')} {...register('incident_type_id', { required: 'Elegí el tipo de incidente' })}>
            <option value="">Seleccionar…</option>
            {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <Field label="Subtipo" htmlFor="f-subtype">
          <select id="f-subtype" className="select" disabled={!subtypes.length} {...register('incident_subtype_id')}>
            <option value="">{subtypes.length ? 'Sin subtipo' : '—'}</option>
            {subtypes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="Título" htmlFor="f-title" required error={err('title')} className="full">
          <input id="f-title" className={cls('input', 'title')} placeholder="Ej.: Incendio en depósito de neumáticos"
            {...register('title', { required: 'Escribí un título', minLength: { value: 5, message: 'Mínimo 5 caracteres' }, maxLength: { value: 200, message: 'Máximo 200 caracteres' } })} />
        </Field>

        <Field label="Descripción" htmlFor="f-desc" required error={err('description')} className="full">
          <textarea id="f-desc" rows={4} className={cls('textarea', 'description')} placeholder="Qué se informó, riesgos, accesos, personas involucradas…"
            {...register('description', { required: 'Describí el incidente', minLength: { value: 10, message: 'Mínimo 10 caracteres' } })} />
        </Field>

        <Field label="Prioridad" htmlFor="f-priority">
          <select id="f-priority" className="select" {...register('priority')}>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </Field>

        {showStatus ? (
          <Field label="Estado" htmlFor="f-status" hint="El cambio queda registrado en el historial.">
            <select id="f-status" className="select" {...register('status')}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
        ) : <div />}

        <div className="form-section">Dónde</div>

        <div className="full">
          <div className="row" style={{ justifyContent: 'space-between', padding: '10px 12px', border: '1px dashed var(--border-2)', borderRadius: 10 }}>
            <span className="row" style={{ gap: 8 }}>
              <MapPin size={17} className="muted" />
              {lat && lng ? <span className="tabular">{fmtCoords(lat, lng)}</span> : <span className="muted">Sin ubicación en el mapa</span>}
              {(err('latitude') || err('longitude')) && <span className="field-error">{err('latitude') || err('longitude')}</span>}
            </span>
            <span className="row">
              {lat && lng && <Button variant="ghost" size="sm" icon={X} onClick={() => { setValue('latitude', ''); setValue('longitude', ''); }}>Quitar</Button>}
              <Button variant="secondary" size="sm" icon={MapPin} onClick={() => setPickerOpen(true)}>{lat && lng ? 'Cambiar' : 'Marcar en el mapa'}</Button>
            </span>
          </div>
          <input type="hidden" {...register('latitude')} />
          <input type="hidden" {...register('longitude')} />
        </div>

        <Field label="Dirección" htmlFor="f-address" className="full" error={err('address')}>
          <input id="f-address" className="input" placeholder="Calle, número, intersección o referencia" {...register('address')} />
        </Field>

        <Field label="Provincia" htmlFor="f-province">
          <select id="f-province" className="select" {...register('province_id')}>
            <option value="">Seleccionar…</option>
            {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <Field label="Partido / departamento" htmlFor="f-partido">
          <select id="f-partido" className="select" disabled={!provinceId} {...register('partido_id')}>
            <option value="">{provinceId ? 'Seleccionar…' : 'Elegí la provincia'}</option>
            {partidoList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <Field label="Localidad" htmlFor="f-locality" className="full">
          <select id="f-locality" className="select" disabled={!partidoId || !localityList.length} {...register('locality_id')}>
            <option value="">{partidoId ? (localityList.length ? 'Seleccionar…' : 'Sin localidades cargadas') : 'Elegí el partido'}</option>
            {localityList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>

        <div className="form-section">Personas</div>
        <div className="full form-grid form-grid-4">
          {[['affected_persons_count', 'Afectadas'], ['injured_count', 'Heridas'], ['deceased_count', 'Fallecidas'], ['evacuated_count', 'Evacuadas']].map(([name, label]) => (
            <Field key={name} label={label} htmlFor={`f-${name}`} error={err(name)}>
              <input id={`f-${name}`} type="number" min="0" inputMode="numeric" className="input tabular" {...register(name, { min: { value: 0, message: 'No puede ser negativo' } })} />
            </Field>
          ))}
        </div>

        <div className="form-section">Seguimiento</div>
        <Field label="Responsable a cargo" htmlFor="f-officer" className="full">
          <input id="f-officer" className="input" placeholder="Nombre de quien coordina en el lugar" {...register('assigned_officer')} />
        </Field>
        <Field label="Notas" htmlFor="f-notes" className="full">
          <textarea id="f-notes" rows={3} className="textarea" {...register('notes')} />
        </Field>
      </form>

      <CoordPicker isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={handlePick} initialLat={lat} initialLng={lng} />
    </>
  );
}
