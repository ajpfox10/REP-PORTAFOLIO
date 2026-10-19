import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { incidentsApi } from '../api/incidents.api';
import IncidentForm from '../components/incidents/IncidentForm';
import Button from '../components/common/Button';
import { PageHeader, Card, Alert, Loading } from '../components/common/ui';
import { apiError, fieldErrors } from '../lib/format';

const s = v => (v == null ? '' : String(v));

export default function IncidentEdit() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [incident, setIncident] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    incidentsApi.getOne(uuid).then(r => setIncident(r.data)).catch(err => setError(err));
  }, [uuid]);

  const onSubmit = async data => {
    setSaving(true);
    setError(null);
    try {
      await incidentsApi.update(uuid, data);
      toast.success('Cambios guardados');
      navigate(`/incidents/${uuid}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (!incident) return <div className="page">{error ? <Alert type="error">{apiError(error)}</Alert> : <Loading />}</div>;

  return (
    <div className="page page-narrow">
      <PageHeader title={`Editar ${incident.incident_number}`} subtitle={incident.title} back={{ to: `/incidents/${uuid}`, label: 'Volver al incidente' }} />
      {error && <Alert type="error" style={{ marginBottom: 16 }}>{apiError(error, 'No se pudieron guardar los cambios')}</Alert>}
      <Card>
        <IncidentForm
          showStatus
          serverErrors={fieldErrors(error)}
          onSubmit={onSubmit}
          defaultValues={{
            incident_type_id: s(incident.incident_type_id), incident_subtype_id: s(incident.incident_subtype_id),
            title: incident.title, description: incident.description, status: incident.status, priority: incident.priority,
            province_id: s(incident.province_id), partido_id: s(incident.partido_id), locality_id: s(incident.locality_id),
            address: s(incident.address), latitude: s(incident.latitude), longitude: s(incident.longitude),
            affected_persons_count: incident.affected_persons_count, injured_count: incident.injured_count,
            deceased_count: incident.deceased_count, evacuated_count: incident.evacuated_count,
            assigned_officer: s(incident.assigned_officer), notes: s(incident.notes),
          }}
        />
        <div className="form-actions">
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" form="incident-form" isLoading={saving}>Guardar cambios</Button>
        </div>
      </Card>
    </div>
  );
}
