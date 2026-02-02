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

  // Busca el agenteId a partir del DNI respetando el OpenAPI
  async function resolveAgenteIdByDni(dniValue: string): Promise<string> {
    const clean = dniValue.replace(/\D/g, "");
    if (!clean) throw new Error("DNI inválido");

    // 1) Endpoint correcto según OpenAPI: /personal/search?dni=...
    // (porque /agentes NO acepta query param dni)
    try {
      const res = await apiFetch<any>(`/personal/search?dni=${clean}&limit=1&page=1`);
      const first = res?.data?.[0];

      // Preferimos agente_id (lo que después usa /agentes/{id})
      const agenteId = first?.agente_id ?? first?.agenteId ?? first?.id;
      if (agenteId) return String(agenteId);
    } catch {
      // si falla el search, seguimos al fallback para no romper el flujo
    }

    // 2) Fallback: paginación sobre agentexdni1 (como ya estaba)
    const limit = 50;
    for (let page = 1; page <= 5; page++) {
      const res = await apiFetch<any>(`/agentexdni1?page=${page}&limit=${limit}`);
      const hit = res?.data?.find((r: any) =>
        String(r?.dni ?? "").replace(/\D/g, "") === clean
      );
      if (hit?.agente_id) return String(hit.agente_id);
      if (!res?.data?.length || res.data.length < limit) break;
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
      const res = await apiFetch<any>(
        `/personal/search?q=${encodeURIComponent(q)}&limit=20&page=1`
      );
      setState(s => ({ ...s, loading: false, matches: res.data || [] }));
      toast.ok("Búsqueda lista");
    } catch (e: any) {
      setState(s => ({ ...s, loading: false }));
      toast.error("No se pudo buscar", e?.message || "Error");
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
