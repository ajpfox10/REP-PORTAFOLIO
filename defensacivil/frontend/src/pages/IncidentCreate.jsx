import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { incidentsApi } from '../api/incidents.api';
import IncidentForm from '../components/incidents/IncidentForm';
import Button from '../components/common/Button';
import { PageHeader, Card, Alert } from '../components/common/ui';
import { apiError, fieldErrors } from '../lib/format';

export default function IncidentCreate() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async data => {
    setSaving(true);
    setError(null);
    try {
      const { data: incident } = await incidentsApi.create(data);
      toast.success(`Incidente ${incident.incident_number} registrado`);
      navigate(`/incidents/${incident.uuid}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Nuevo incidente" subtitle="Se registra con estado Recibido y número correlativo." back={{ to: '/incidents', label: 'Incidentes' }} />
      {error && <Alert type="error" style={{ marginBottom: 16 }}>{apiError(error, 'No se pudo registrar el incidente')}</Alert>}
      <Card>
        <IncidentForm onSubmit={onSubmit} serverErrors={fieldErrors(error)} />
        <div className="form-actions">
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" form="incident-form" isLoading={saving}>Registrar incidente</Button>
        </div>
      </Card>
    </div>
  );
}
