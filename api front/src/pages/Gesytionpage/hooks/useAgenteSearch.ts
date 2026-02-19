// hooks/useAgenteSearch.ts
import { useState } from 'react';
import { useToast } from '../../../ui/toast';
import { apiFetch } from '../../../api/http';
import { trackAction } from '../../../logging/track';

export function useAgenteSearch() {
  const toast = useToast();
  const [state, setState] = useState({
    dni: "",
    fullName: "",
    matches: [] as any[],
    loading: false,
    row: null as any,
  });

  /**
   * Resuelve el agente_id a partir de DNI usando filtro directo del CRUD.
   * ANTES: hacía loop de hasta 5 páginas en memoria → perdía agentes si había más de 250 registros.
   * AHORA: usa filtro exacto ?dni= que el back traduce directamente a WHERE dni = X.
   */
  async function resolveAgenteIdByDni(dniValue: string): Promise<string> {
    const clean = dniValue.replace(/\D/g, "");
    if (!clean) throw new Error("DNI inválido");

    // Intento 1: filtro exacto por DNI en agentexdni1 (vista que ya tiene agente_id)
    try {
      const res = await apiFetch<any>(`/agentexdni1?dni=${clean}&limit=1&page=1`);
      const first = res?.data?.[0];
      const agenteId = first?.agente_id ?? first?.agenteId ?? first?.id;
      if (agenteId) return String(agenteId);
    } catch {
      // seguimos al siguiente intento
    }

    // Intento 2: personal con filtro dni exacto
    try {
      const res = await apiFetch<any>(`/personal?dni=${clean}&limit=1&page=1`);
      const first = res?.data?.[0];
      const agenteId = first?.agente_id ?? first?.agenteId ?? first?.id ?? first?.dni;
      if (agenteId) return String(agenteId);
    } catch {
      // seguimos
    }

    // Intento 3: /personal/search si existe
    try {
      const res = await apiFetch<any>(`/personal/search?dni=${clean}&limit=1&page=1`);
      const first = res?.data?.[0];
      const agenteId = first?.agente_id ?? first?.agenteId ?? first?.id;
      if (agenteId) return String(agenteId);
    } catch {
      // endpoint personalizado puede no existir
    }

    throw new Error("No encontrado");
  }

  async function onSearch() {
    const clean = state.dni.replace(/\D/g, "");
    if (!clean) {
      toast.error("DNI inválido", "Ingresá un DNI válido");
      return;
    }

    try {
      setState(s => ({ ...s, loading: true, row: null, matches: [] }));

      const agenteId = await resolveAgenteIdByDni(clean);
      const res = await apiFetch<any>(`/agentes/${agenteId}`);

      setState(s => ({ ...s, loading: false, row: res.data }));
      toast.ok("Agente cargado");
      trackAction('gestion_load_agente_by_dni', { dni: clean, agenteId });
    } catch (e: any) {
      setState(s => ({ ...s, loading: false }));
      toast.error("No se pudo cargar el agente", e?.message || "Error");
      trackAction('gestion_load_agente_by_dni_error', { dni: clean, message: e?.message });
    }
  }

  async function onSearchByName() {
    const q = state.fullName.trim();
    if (!q) {
      toast.error("Búsqueda inválida", "Ingresá apellido y/o nombre");
      return;
    }

    try {
      setState(s => ({ ...s, loading: true, matches: [] }));
      // Filtro por nombre usando _contains (soportado por el CRUD del back)
      const res = await apiFetch<any>(
        `/personal?nombre_contains=${encodeURIComponent(q)}&limit=20&page=1`
      );
      setState(s => ({ ...s, loading: false, matches: res.data || [] }));
      toast.ok("Búsqueda lista");
    } catch (e: any) {
      // Fallback: endpoint search personalizado
      try {
        const res = await apiFetch<any>(
          `/personal/search?q=${encodeURIComponent(q)}&limit=20&page=1`
        );
        setState(s => ({ ...s, loading: false, matches: res.data || [] }));
        toast.ok("Búsqueda lista");
      } catch {
        setState(s => ({ ...s, loading: false }));
        toast.error("No se pudo buscar", e?.message || "Error");
      }
    }
  }

  return {
    dni: state.dni,
    fullName: state.fullName,
    matches: state.matches,
    loading: state.loading,
    row: state.row,
    cleanDni: state.row?.dni ? String(state.row.dni).replace(/\D/g, "") : "",

    setDni: (dni: string) => setState(s => ({ ...s, dni })),
    setFullName: (fullName: string) => setState(s => ({ ...s, fullName })),

    onSearch,
    onSearchByName,

    loadByDni: async (dniValue: string) => {
      setState(s => ({ ...s, dni: dniValue }));
      await new Promise(resolve => setTimeout(resolve, 10));
      await onSearch();
    }
  };
}
