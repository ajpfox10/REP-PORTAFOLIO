import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { incidentsApi } from '../api/incidents.api';
import IncidentForm from '../components/incidents/IncidentForm';
import Button from '../components/common/Button';

export default function IncidentEdit() {
  const { uuid }    = useParams();
  const navigate    = useNavigate();
  const [incident, setIncident] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    incidentsApi.getOne(uuid).then(r => setIncident(r.data)).catch(() => navigate('/incidents'));
  }, [uuid]);

  const onSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try {
      await incidentsApi.update(uuid, data);
      navigate(`/incidents/${uuid}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar');
      setLoading(false);
    }
  };

  if (!incident) return <p style={{ color:'#64748b' }}>Cargando...</p>;

  return (
    <div style={{ maxWidth:800, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}>←</button>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Editar {incident.incident_number}</h1>
      </div>

      {error && (
        <div style={{ background:'#fee2e2', color:'#dc2626', padding:'0.75rem', borderRadius:'var(--radius)', marginBottom:'1rem' }}>
          {error}
        </div>
      )}

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem' }}>
        <IncidentForm
          defaultValues={{
            incident_type_id:    incident.incident_type_id,
            incident_subtype_id: incident.incident_subtype_id || '',
            title:       incident.title,
            description: incident.description,
            status:      incident.status,
            priority:    incident.priority,
            province_id: incident.province_id || '',
            partido_id:  incident.partido_id  || '',
            locality_id: incident.locality_id || '',
            address:     incident.address     || '',
            latitude:    incident.latitude    || '',
            longitude:   incident.longitude   || '',
            affected_persons_count: incident.affected_persons_count,
            injured_count:          incident.injured_count,
            deceased_count:         incident.deceased_count,
            evacuated_count:        incident.evacuated_count,
            assigned_officer: incident.assigned_officer || '',
            notes:            incident.notes || '',
          }}
          onSubmit={onSubmit}
          isLoading={loading}
          showStatus={true}
        />
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid var(--color-border)' }}>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" form="incident-form" isLoading={loading}>Guardar Cambios</Button>
        </div>
      </div>
    </div>
  );
}
