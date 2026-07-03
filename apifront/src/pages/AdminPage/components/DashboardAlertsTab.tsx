import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';
import type { DashboardAlertBehavior, DashboardAlertKey } from '../../DashboardPage/components/DashboardAlertSlot';

type AlertsMap = Record<DashboardAlertKey, DashboardAlertBehavior>;
type ConfigResponse = {
  defaults: DashboardAlertBehavior;
  alerts: AlertsMap;
  source: 'env' | 'database';
  dbAvailable: boolean;
  updatedAt?: string;
};

const LABELS: Record<DashboardAlertKey, { title: string; description: string }> = {
  embarazadas: { title: 'Embarazadas', description: 'FPP proximas y pendientes de aviso.' },
  guarderia: { title: 'Guarderia', description: 'Tramites de guarderia pendientes.' },
  fichero: { title: 'Fichero', description: 'Estado de red y subida de fichadas.' },
  examenIngreso: { title: 'Examen de ingreso', description: 'Candidatos con turnos pendientes.' },
  accidentesPunzo: { title: 'Accidentes punzo-cortantes', description: 'Alertas activas de infectologia.' },
  jefaturas: { title: 'Jefaturas', description: 'Vencimientos proximos de cargos.' },
  concursos: { title: 'Concursos', description: 'Examenes proximos de concursos.' },
  alertasAgente: { title: 'Alertas por agente', description: 'Alertas manuales activas.' },
};

const KEYS = Object.keys(LABELS) as DashboardAlertKey[];
const seconds = (ms: number) => Math.round(ms / 1000);
const milliseconds = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1000)) : 0;
};

export function DashboardAlertsTab() {
  const toast = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState<AlertsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch<any>('/dashboard-alerts/config');
      setConfig(response.data);
      setDraft(response.data.alerts);
    } catch (err: any) {
      toast.error('No se pudo cargar la configuracion', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const change = (key: DashboardAlertKey, patch: Partial<DashboardAlertBehavior>) => {
    setDraft((current) => current ? { ...current, [key]: { ...current[key], ...patch } } : current);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await apiFetch<any>('/dashboard-alerts/config', {
        method: 'PUT',
        body: JSON.stringify({ alerts: draft }),
      });
      setConfig(response.data);
      setDraft(response.data.alerts);
      toast.ok('Banners actualizados', 'Los cambios ya estan activos para las proximas consultas del dashboard.');
    } catch (err: any) {
      toast.error('No se pudo guardar', err?.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Restaurar todos los banners a los valores definidos en el .env?')) return;
    setSaving(true);
    try {
      const response = await apiFetch<any>('/dashboard-alerts/config', { method: 'DELETE' });
      setConfig(response.data);
      setDraft(response.data.alerts);
      toast.ok('Configuracion restaurada', 'Ahora se utilizan los valores del .env.');
    } catch (err: any) {
      toast.error('No se pudo restaurar', err?.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config || !draft) return <div className="admin-empty">Cargando configuracion de banners...</div>;

  return (
    <div className="dashboard-alerts-admin">
      <div className="dashboard-alerts-head">
        <div>
          <h3>Banners del dashboard</h3>
          <p>
            Configuracion activa desde <strong>{config.source === 'database' ? 'base de datos' : '.env'}</strong>.
            Los tiempos se expresan en segundos; cero significa sin demora, sin cierre automatico o sin reconsulta.
          </p>
          {!config.dbAvailable && (
            <div className="dashboard-alerts-warning">
              La tabla de configuracion no esta disponible. Ejecute la migracion <code>028__app_runtime_config.sql</code>.
            </div>
          )}
        </div>
        <div className="dashboard-alerts-actions">
          <button className="btn" onClick={load} disabled={saving}>Actualizar</button>
          <button className="btn btn-warn" onClick={reset} disabled={saving || !config.dbAvailable}>Restaurar .env</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !config.dbAvailable}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      <div className="dashboard-alerts-grid">
        {KEYS.map((key) => {
          const item = draft[key];
          return (
            <section className={`dashboard-alert-card${item.enabled ? '' : ' disabled'}`} key={key}>
              <div className="dashboard-alert-card-title">
                <div>
                  <strong>{LABELS[key].title}</strong>
                  <span>{LABELS[key].description}</span>
                </div>
                <label className="dashboard-alert-toggle">
                  <input type="checkbox" checked={item.enabled}
                    onChange={(event) => change(key, { enabled: event.target.checked })} />
                  {item.enabled ? 'Activo' : 'Inactivo'}
                </label>
              </div>
              <div className="dashboard-alert-fields">
                <label>
                  Aparece despues de
                  <input type="number" min="0" value={seconds(item.delayMs)}
                    onChange={(event) => change(key, { delayMs: milliseconds(event.target.value) })} />
                  <span>segundos</span>
                </label>
                <label>
                  Duracion visible
                  <input type="number" min="0" value={seconds(item.durationMs)}
                    onChange={(event) => change(key, { durationMs: milliseconds(event.target.value) })} />
                  <span>segundos</span>
                </label>
                <label>
                  Reconsultar cada
                  <input type="number" min="0" value={seconds(item.refreshMs)}
                    onChange={(event) => change(key, { refreshMs: milliseconds(event.target.value) })} />
                  <span>segundos (minimo 5)</span>
                </label>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
