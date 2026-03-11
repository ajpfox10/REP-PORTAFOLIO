// src/pages/AdminPage/hooks/usePendingRequests.ts
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';
import type { Role } from './useAdminUsers';

export type AccessRequest = {
  id: number;
  created_at: string;
  nombre: string;
  email: string;
  motivo: string;
  confirmed: boolean;
  confirmed_at: string | null;
  approved: boolean;
  approved_at: string | null;
  expira: string | null;
};

export function usePendingRequests(roles: Role[]) {
  const toast = useToast();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/auth/pending-requests');
      setRequests(res?.data || []);
    } catch (e: any) {
      toast.error('Error cargando solicitudes', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadRequests(); }, []);

  const approveRequest = useCallback(async (
    auditLogId: number,
    password: string,
    rolId: number | null,
  ) => {
    setSaving(true);
    try {
      await apiFetch<any>('/auth/approve-request', {
        method: 'POST',
        body: JSON.stringify({
          audit_log_id: auditLogId,
          password,
          rol_id: rolId || undefined,
        }),
      });
      toast.ok('Solicitud aprobada', 'El usuario recibió sus credenciales por email');
      await loadRequests();
    } catch (e: any) {
      toast.error('Error al aprobar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [toast, loadRequests]);

  return { requests, loading, saving, loadRequests, approveRequest };
}
