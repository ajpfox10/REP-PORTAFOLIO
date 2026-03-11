// hooks/usePedidos.ts
import { useState, useCallback } from 'react';
import { useToast } from '../../../ui/toast';
import { apiFetch } from '../../../api/http';
import { getApiBaseUrl, loadRuntimeConfig } from '../../../api/env';
import { trackAction } from '../../../logging/track';
import { loadSession } from '../../../auth/session';
import type { ModuleState } from './useModules';

export function usePedidos(cleanDni: string, moduleState: ModuleState) {
  const toast = useToast();
  const [pedidoModal, setPedidoModal] = useState({
    open: false,
    lugar: "",
    estado: "pendiente" as "pendiente" | "hecho",
    tipos: {
      "Certificado de trabajo": false,
      "Certificado de trabajo (con características)": false,
      "IOMA": false,
      "Copia de resoluciones": false,
      "Copia de recibos": false,
      "Constancia de servicios": false,
    } as Record<string, boolean>,
    custom: "",
    caracteristicas: "",
    saving: false,
  });

  // Obtener usuario actual para auditoría
  const getActor = useCallback(() => {
    const s = loadSession();
    const u: any = s?.user || {};
    return u?.username || u?.user || u?.name || u?.email || u?.id || 'anon';
  }, []);

  const openPedidoModal = useCallback(() => {
    if (!cleanDni) {
      toast.error('Primero cargá un DNI', 'Enter primero, después módulos');
      return;
    }
    setPedidoModal(prev => ({
      ...prev,
      open: true,
      saving: false,
      lugar: prev.lugar || "",
      estado: "pendiente",
      custom: "",
      caracteristicas: "",
      tipos: Object.fromEntries(
        Object.keys(prev.tipos).map(k => [k, false])
      ) as Record<string, boolean>,
    }));
  }, [cleanDni, toast]);

  const closePedidoModal = useCallback(() => {
    setPedidoModal(prev => ({ ...prev, open: false, saving: false }));
  }, []);

  const createPedidosFromModal = useCallback(async () => {
    if (!cleanDni) return;
    const actor = getActor();

    const checked = Object.entries(pedidoModal.tipos)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const custom = (pedidoModal.custom || "").trim();
    if (custom) checked.push(custom);

    if (!checked.length) {
      toast.error("Seleccioná al menos un pedido", "Tildá un tipo o escribí uno personalizado");
      return;
    }

    try {
      setPedidoModal(prev => ({ ...prev, saving: true }));
      trackAction("gestion_pedido_create_attempt", {
        dni: Number(cleanDni),
        count: checked.length,
        estado: pedidoModal.estado,
        actor,
      });

      const car = (pedidoModal.caracteristicas || "").trim();

      // Crear todos los pedidos en paralelo
      const promises = checked.map(async (tipo) => {
        const pedidoFinal = car ? `${tipo} (Características: ${car})` : tipo;
        
        const payload: any = {
          dni: Number(cleanDni),
          pedido: pedidoFinal,
          lugar: pedidoModal.lugar || "",
          fecha: new Date().toISOString(),
          estado: pedidoModal.estado,
          created_by: actor,
          updated_by: actor,
        };

        return apiFetch<any>("/pedidos", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      });

      await Promise.all(promises);

      toast.ok("Pedido cargado", `${checked.length} pedido(s) agregado(s)`);
      closePedidoModal();
      trackAction("gestion_pedido_create_ok", { 
        dni: Number(cleanDni), 
        count: checked.length, 
        actor 
      });

      return true; // Para recargar módulo
    } catch (e: any) {
      toast.error("No se pudo cargar el pedido", e?.message || "Error");
      trackAction("gestion_pedido_create_error", { 
        dni: Number(cleanDni), 
        message: e?.message 
      });
      setPedidoModal(prev => ({ ...prev, saving: false }));
      return false;
    }
  }, [cleanDni, pedidoModal, getActor, toast, closePedidoModal]);

  const patchPedido = useCallback(async (id: any, changes: any) => {
    const pid = String(id);
    try {
      return await apiFetch<any>(`/pedidos/${encodeURIComponent(pid)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
    } catch {
      // Fallback a PUT
      return await apiFetch<any>(`/pedidos/${encodeURIComponent(pid)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...changes, id: pid }),
      });
    }
  }, []);

  const bajaPedidoSelected = useCallback(async () => {
    if (!cleanDni) return;
    const selected = moduleState.rows[moduleState.selectedIndex];
    if (!selected) {
      toast.error('Seleccioná un pedido', 'Elegí una fila o un item en navegación');
      return;
    }

    const actor = getActor();
    const nowIso = new Date().toISOString();
    const id = selected?.id;
    if (!id) {
      toast.error('Pedido inválido', 'No tiene id');
      return;
    }

    try {
      trackAction('gestion_pedido_baja_attempt', { dni: Number(cleanDni), id, actor });
      await patchPedido(id, {
        estado: 'baja',
        deleted_at: nowIso,
        updated_at: nowIso,
        updated_by: actor,
      });
      toast.ok('Pedido dado de baja', `Pedido #${id}`);
      trackAction('gestion_pedido_baja_ok', { dni: Number(cleanDni), id, actor });
      return true;
    } catch (e: any) {
      toast.error('No se pudo dar de baja', e?.message || 'Error');
      trackAction('gestion_pedido_baja_error', { dni: Number(cleanDni), id, message: e?.message });
      return false;
    }
  }, [cleanDni, moduleState, getActor, patchPedido, toast]);

  const marcarPedidoEstado = useCallback(async (next: 'pendiente' | 'hecho') => {
    if (!cleanDni) return;
    const selected = moduleState.rows[moduleState.selectedIndex];
    if (!selected) {
      toast.error('Seleccioná un pedido', 'Elegí una fila o un item en navegación');
      return;
    }
    
    const actor = getActor();
    const nowIso = new Date().toISOString();
    const id = selected?.id;
    if (!id) return;

    try {
      trackAction('gestion_pedido_estado_attempt', { dni: Number(cleanDni), id, next, actor });
      await patchPedido(id, {
        estado: next,
        updated_at: nowIso,
        updated_by: actor,
      });
      toast.ok('Actualizado', `Pedido #${id} -> ${next}`);
      trackAction('gestion_pedido_estado_ok', { dni: Number(cleanDni), id, next, actor });
      return true;
    } catch (e: any) {
      toast.error('No se pudo actualizar', e?.message || 'Error');
      trackAction('gestion_pedido_estado_error', { dni: Number(cleanDni), id, next, message: e?.message });
      return false;
    }
  }, [cleanDni, moduleState, getActor, patchPedido, toast]);

  // ✅ IOMA: genera DOCX desde backend y lo descarga
  // Endpoint: POST /api/v1/certificados/certificado-trabajo { dni }
  const generarIomaSelected = useCallback(async () => {
    if (!cleanDni) return;

    const selected = moduleState.rows[moduleState.selectedIndex];
    if (!selected) {
      toast.error('Seleccioná un pedido', 'Elegí una fila o un item en navegación');
      return;
    }

    const dni = Number(selected?.dni ?? cleanDni);
    if (!dni || Number.isNaN(dni)) {
      toast.error('DNI inválido');
      return;
    }

    const getCookie = (name: string): string | null => {
      try {
        const m = document.cookie.match(
          new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '=([^;]*)')
        );
        return m ? decodeURIComponent(m[1]) : null;
      } catch {
        return null;
      }
    };

    try {
      trackAction('gestion_ioma_generate_attempt', { dni });

      await loadRuntimeConfig();
      const apiBase = String(getApiBaseUrl() || '').replace(/\/+$/, '');

      const session = loadSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      if (session?.accessToken) headers['Authorization'] = `Bearer ${session.accessToken}`;

      const csrf = getCookie('p5_csrf');
      if (csrf) headers['x-csrf-token'] = csrf;

      const resp = await fetch(`${apiBase}/certificados/certificado-trabajo`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ dni }),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `certificado_ioma_${dni}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.ok('IOMA generado', `DNI ${dni}`);
      trackAction('gestion_ioma_generate_ok', { dni });
      return true;
    } catch (e: any) {
      console.error(e);
      toast.error('No se pudo generar IOMA', e?.message || 'Error');
      trackAction('gestion_ioma_generate_error', { dni, message: e?.message });
      return false;
    }
  }, [cleanDni, moduleState, toast]);

  return {
    pedidoModal,
    setPedidoModal,

    openPedidoModal,
    closePedidoModal,
    createPedidosFromModal,
    bajaPedidoSelected,
    marcarPedidoEstado,

    // ✅ nuevo
    generarIomaSelected,

    getSelectedPedido: () => moduleState.rows[moduleState.selectedIndex],
    hasSelectedPedido: () => !!moduleState.rows[moduleState.selectedIndex],
  };
}
