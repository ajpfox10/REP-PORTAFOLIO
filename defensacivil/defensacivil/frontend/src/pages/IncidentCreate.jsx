import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { incidentsApi } from '../api/incidents.api';
import IncidentForm from '../components/incidents/IncidentForm';
import Button from '../components/common/Button';

export default function IncidentCreate() {
  const navigate    = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const onSubmit = async (rawData) => {
    // Limpiar campos: strings vacíos → undefined, números como strings → Number
    const intFields   = ['incident_type_id','incident_subtype_id','province_id','partido_id','locality_id',
                         'affected_persons_count','injured_count','deceased_count','evacuated_count'];
    const floatFields = ['latitude','longitude'];

    const data = { ...rawData };
    intFields.forEach(f => {
      if (data[f] === '' || data[f] == null) delete data[f];
      else data[f] = Number(data[f]);
    });
    floatFields.forEach(f => {
      if (data[f] === '' || data[f] == null) delete data[f];
      else data[f] = parseFloat(data[f]);
    });

    setLoading(true);
    setError(null);
    try {
      const { data: incident } = await incidentsApi.create(data);
      toast.success('Incidente creado correctamente');
      navigate(`/incidents/${incident.uuid}`);
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.errors?.length) {
        errData.errors.forEach(e => toast.error(`${e.field}: ${e.message}`));
        setError(errData.errors.map(e => `${e.field}: ${e.message}`).join(' · '));
      } else {
        const msg = errData?.detail || errData?.error || 'Error al crear el incidente';
        toast.error(msg);
        setError(msg);
      }
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth:800, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}>←</button>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Nuevo Incidente</h1>
      </div>

      {error && (
        <div style={{ background:'#fee2e2', color:'#dc2626', padding:'0.75rem', borderRadius:'var(--radius)', marginBottom:'1rem' }}>
          {error}
        </div>
      )}

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem' }}>
        <IncidentForm onSubmit={onSubmit} isLoading={loading} />
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid var(--color-border)' }}>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" form="incident-form" isLoading={loading}>Crear Incidente</Button>
        </div>
      </div>
    </div>
  );
}
