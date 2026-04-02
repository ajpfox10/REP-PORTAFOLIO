import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { incidentsApi } from '../api/incidents.api';
import IncidentForm from '../components/incidents/IncidentForm';
import Button from '../components/common/Button';

export default function IncidentCreate() {
  const navigate    = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const onSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try {
      const { data: incident } = await incidentsApi.create(data);
      navigate(`/incidents/${incident.uuid}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el incidente');
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
