import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import useGeoStore from '../../store/geoStore';
import Button from '../common/Button';
import CoordPicker from './CoordPicker';

const PRIORITIES = ['BAJA','MEDIA','ALTA','CRITICA'];
const STATUSES   = ['RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO'];

const field = { display:'flex', flexDirection:'column', gap:'0.375rem', marginBottom:'1rem' };
const label = { fontSize:'0.875rem', fontWeight:500, color:'#374151' };
const input = {
  padding:'0.5rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)',
  fontSize:'0.875rem', background:'#fff', width:'100%',
};
const sel = { ...input, cursor:'pointer' };

export default function IncidentForm({ defaultValues, onSubmit, isLoading, showStatus = false }) {
  const { incidentTypes, provinces, partidos, localities, fetchPartidos, fetchLocalities } = useGeoStore();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({ defaultValues });

  const typeId     = watch('incident_type_id');
  const provinceId = watch('province_id');
  const partidoId  = watch('partido_id');
  const lat        = watch('latitude');
  const lng        = watch('longitude');

  const selectedType = incidentTypes.find(t => String(t.id) === String(typeId));
  const subtypes     = selectedType?.subtypes || [];
  const partidoList  = partidos[provinceId] || [];
  const localityList = localities[partidoId] || [];

  useEffect(() => { if (provinceId) { fetchPartidos(provinceId); setValue('partido_id',''); setValue('locality_id',''); } }, [provinceId]);
  useEffect(() => { if (partidoId)  { fetchLocalities(partidoId); setValue('locality_id',''); } }, [partidoId]);

  return (
    <>
      <form id="incident-form" onSubmit={handleSubmit(onSubmit)}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 1rem' }}>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Tipo de Incidente *</label>
            <select style={sel} {...register('incident_type_id', { required: 'Requerido' })}>
              <option value="">Seleccionar tipo...</option>
              {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {errors.incident_type_id && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.incident_type_id.message}</span>}
          </div>

          {subtypes.length > 0 && (
            <div style={{ ...field, gridColumn:'1/-1' }}>
              <label style={label}>Subtipo</label>
              <select style={sel} {...register('incident_subtype_id')}>
                <option value="">Sin subtipo</option>
                {subtypes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Título *</label>
            <input style={input} placeholder="Descripción breve del incidente" {...register('title', { required:'Requerido', minLength:{ value:5, message:'Mínimo 5 caracteres' } })} />
            {errors.title && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.title.message}</span>}
          </div>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Descripción detallada *</label>
            <textarea rows={4} style={{ ...input, resize:'vertical' }} placeholder="Descripción completa de lo ocurrido..." {...register('description', { required:'Requerido' })} />
            {errors.description && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.description.message}</span>}
          </div>

          <div style={field}>
            <label style={label}>Prioridad</label>
            <select style={sel} {...register('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {showStatus && (
            <div style={field}>
              <label style={label}>Estado</label>
              <select style={sel} {...register('status')}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
              </select>
            </div>
          )}

          <div style={field}>
            <label style={label}>Provincia</label>
            <select style={sel} {...register('province_id')}>
              <option value="">Seleccionar...</option>
              {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div style={field}>
            <label style={label}>Partido / Municipio</label>
            <select style={sel} {...register('partido_id')} disabled={!provinceId}>
              <option value="">Seleccionar...</option>
              {partidoList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Localidad</label>
            <select style={sel} {...register('locality_id')} disabled={!partidoId}>
              <option value="">Seleccionar...</option>
              {localityList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Dirección</label>
            <input style={input} placeholder="Calle, número, intersección..." {...register('address')} />
          </div>

          {/* Coordinates */}
          <div style={field}>
            <label style={label}>Latitud</label>
            <input type="number" step="any" style={input} placeholder="-34.6037" {...register('latitude')} />
          </div>
          <div style={field}>
            <label style={label}>Longitud</label>
            <input type="number" step="any" style={input} placeholder="-58.3816" {...register('longitude')} />
          </div>

          <div style={{ gridColumn:'1/-1', marginBottom:'1rem' }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
              🗺️ Seleccionar en Mapa
            </Button>
            {lat && lng && (
              <span style={{ marginLeft:'0.75rem', fontSize:'0.8rem', color:'#16a34a' }}>
                ✓ Coords: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
              </span>
            )}
          </div>

          {/* Persons */}
          <div style={field}>
            <label style={label}>Personas Afectadas</label>
            <input type="number" min="0" style={input} {...register('affected_persons_count')} defaultValue={0} />
          </div>
          <div style={field}>
            <label style={label}>Heridos</label>
            <input type="number" min="0" style={input} {...register('injured_count')} defaultValue={0} />
          </div>
          <div style={field}>
            <label style={label}>Fallecidos</label>
            <input type="number" min="0" style={input} {...register('deceased_count')} defaultValue={0} />
          </div>
          <div style={field}>
            <label style={label}>Evacuados</label>
            <input type="number" min="0" style={input} {...register('evacuated_count')} defaultValue={0} />
          </div>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Oficial Asignado</label>
            <input style={input} placeholder="Nombre del oficial a cargo" {...register('assigned_officer')} />
          </div>

          <div style={{ ...field, gridColumn:'1/-1' }}>
            <label style={label}>Notas Adicionales</label>
            <textarea rows={3} style={{ ...input, resize:'vertical' }} {...register('notes')} />
          </div>
        </div>
      </form>

      <CoordPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(lat, lng, geoData) => {
          setValue('latitude',  lat);
          setValue('longitude', lng);

          // Auto-rellenar dirección
          if (geoData?.address) {
            const fullAddr = [geoData.address, geoData.locality].filter(Boolean).join(', ');
            setValue('address', fullAddr);
          }

          // Intentar hacer match de provincia por nombre (Nominatim devuelve state en español)
          if (geoData?.province && provinces.length) {
            const pNorm = geoData.province.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
              .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u');
            const matched = provinces.find(p => {
              const n = p.name.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
                .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u');
              return pNorm.includes(n) || n.includes(pNorm);
            });
            if (matched) {
              setValue('province_id', String(matched.id));
              // Cargar partidos de esa provincia para intentar hacer match de partido
              fetchPartidos(matched.id).then?.(() => {
                if (geoData.partido) {
                  const pList = partidos[matched.id] || [];
                  const paNorm = geoData.partido.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
                    .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u');
                  const matchedPa = pList.find(pa => {
                    const n = pa.name.toLowerCase().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
                      .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u');
                    return paNorm.includes(n) || n.includes(paNorm);
                  });
                  if (matchedPa) setValue('partido_id', String(matchedPa.id));
                }
              });
            }
          }

          setPickerOpen(false);
        }}
        initialLat={lat} initialLng={lng}
      />
    </>
  );
}
