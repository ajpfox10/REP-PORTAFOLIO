// src/pages/DashboardPage/hooks/useDashboard.ts
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';

export function useDashboard() {
  const { hasPerm } = useAuth();
  const toast = useToast();
  
  const [pedidosTotal, setPedidosTotal] = useState<number | null>(null);
  const pedidosOnce = useRef(false);

  const canDocs = hasPerm('documents:read') || hasPerm('crud:*:*');
  const canTables = hasPerm('crud:*:read') || hasPerm('crud:*:*');
  const canGestion = hasPerm('crud:agentexdni1:read') || hasPerm('crud:*:*');
  const canPedidos = hasPerm('crud:pedidos:read') || hasPerm('crud:*:read') || hasPerm('crud:*:*');

  useEffect(() => {
    if (pedidosOnce.current) return;
    pedidosOnce.current = true;

    if (!canPedidos) return;

    const ac = new AbortController();
    (async () => {
      try {
        const res = await apiFetch<any>(`/pedidos?page=1&limit=1`, { signal: ac.signal });
        const total = Number(res?.meta?.total);
        setPedidosTotal(Number.isFinite(total) ? total : 0);
      } catch (e: any) {
        if (e?.aborted) return;
        toast.error('No se pudo leer Pedidos', e?.message || 'Error');
        setPedidosTotal(null);
      }
    })();

    return () => ac.abort();
  }, [canPedidos, toast]);

  return {
    pedidosTotal,
    canDocs,
    canTables,
    canGestion,
    canPedidos,
  };
}