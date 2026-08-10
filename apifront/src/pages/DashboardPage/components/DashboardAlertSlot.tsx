import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/http';

export type DashboardAlertKey =
  | 'embarazadas'
  | 'guarderia'
  | 'fichero'
  | 'examenIngreso'
  | 'accidentesPunzo'
  | 'jefaturas'
  | 'concursos'
  | 'alertasAgente'
  | 'cumpleanos';

export interface DashboardAlertBehavior {
  enabled: boolean;
  delayMs: number;
  durationMs: number;
  refreshMs: number;
}

type AlertsConfig = {
  defaults: DashboardAlertBehavior;
  alerts: Record<DashboardAlertKey, DashboardAlertBehavior>;
};

const FALLBACK_BEHAVIOR: DashboardAlertBehavior = {
  enabled: true,
  delayMs: 0,
  durationMs: 0,
  refreshMs: 0,
};

const FALLBACK_CONFIG: AlertsConfig = {
  defaults: FALLBACK_BEHAVIOR,
  alerts: {
    embarazadas: FALLBACK_BEHAVIOR,
    guarderia: FALLBACK_BEHAVIOR,
    fichero: FALLBACK_BEHAVIOR,
    examenIngreso: FALLBACK_BEHAVIOR,
    accidentesPunzo: FALLBACK_BEHAVIOR,
    jefaturas: FALLBACK_BEHAVIOR,
    concursos: FALLBACK_BEHAVIOR,
    alertasAgente: FALLBACK_BEHAVIOR,
    cumpleanos: FALLBACK_BEHAVIOR,
  },
};

export function useDashboardAlertsConfig() {
  const [config, setConfig] = useState<AlertsConfig | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<any>('/dashboard-alerts/config')
      .then((response) => {
        if (active) setConfig(response?.data?.alerts ? response.data : FALLBACK_CONFIG);
      })
      .catch(() => {
        if (active) setConfig(FALLBACK_CONFIG);
      });
    return () => { active = false; };
  }, []);

  return config;
}

export function DashboardAlertSlot({
  behavior,
  children,
}: {
  behavior?: DashboardAlertBehavior;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [cycle, setCycle] = useState(0);
  const config = behavior ?? FALLBACK_BEHAVIOR;

  useEffect(() => {
    setVisible(false);
    if (!config.enabled) return;

    const show = () => setVisible(true);
    if (config.delayMs > 0) {
      const timer = window.setTimeout(show, config.delayMs);
      return () => window.clearTimeout(timer);
    }
    show();
  }, [config.enabled, config.delayMs]);

  useEffect(() => {
    if (!visible || config.durationMs <= 0) return;
    const timer = window.setTimeout(() => setVisible(false), config.durationMs);
    return () => window.clearTimeout(timer);
  }, [visible, config.durationMs]);

  useEffect(() => {
    if (!visible || config.refreshMs <= 0) return;
    const timer = window.setInterval(() => setCycle((value) => value + 1), config.refreshMs);
    return () => window.clearInterval(timer);
  }, [visible, config.refreshMs]);

  if (!config.enabled || !visible) return null;
  return <React.Fragment key={cycle}>{children}</React.Fragment>;
}
