// src/hooks/useAlertasAgente.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../api/http';

export interface AlertaAgente {
  id:                number;
  dni:               number;
  titulo:            string;
  mensaje:           string;
  urgente:           number;
  activa:            number;
  creado_por:        number | null;
  creado_por_nombre: string | null;
  created_at:        string;
  visto_at:          string | null;
  cerrado_at:        string | null;
}

export function useAlertasAgente(dni: number | null | undefined) {
  const [alertas,  setAlertas]  = useState<AlertaAgente[]>([]);
  const [loading,  setLoading]  = useState(false);
  const prevDni = useRef<number | null | undefined>(undefined);

  const cargar = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/alertas-agente/agente/${d}`);
      setAlertas(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setAlertas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dni === prevDni.current) return;
    prevDni.current = dni;
    if (dni) {
      cargar(dni);
    } else {
      setAlertas([]);
    }
  }, [dni, cargar]);

  const marcarVisto = useCallback(async (id: number) => {
    try {
      await apiFetch(`/alertas-agente/${id}/ver`, { method: 'POST' });
      setAlertas(prev =>
        prev.map(a => a.id === id ? { ...a, visto_at: new Date().toISOString() } : a)
      );
    } catch { /* silencioso */ }
  }, []);

  const cerrar = useCallback(async (id: number) => {
    try {
      await apiFetch(`/alertas-agente/${id}/cerrar`, { method: 'POST' });
      setAlertas(prev => prev.filter(a => a.id !== id));
    } catch { /* silencioso */ }
  }, []);

  // alertas sin cerrar por este usuario
  const activas = alertas.filter(a => !a.cerrado_at);

  return { alertas: activas, loading, marcarVisto, cerrar, recargar: () => dni && cargar(dni) };
}
