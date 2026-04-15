// hooks/useAgenteSearch.ts
import { useState } from 'react';
import { useToast } from '../../../ui/toast';
import { apiFetch } from '../../../api/http';
import { searchPersonal } from '../../../api/searchPersonal';
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

  // FIX: El flujo original hacía agentexdni1 → GET /agentes/:id pero esa ruta
  // no existe en el backend (solo existe /agentes/:dni/foto).
  // Ahora usamos GET /personal/:dni que devuelve el perfil completo con dni garantizado.
  async function onSearch(dniOverride?: string) {
    const clean = (dniOverride ?? state.dni).replace(/\D/g, "");
    if (!clean) {
      toast.error("DNI inválido", "Ingresá un DNI válido");
      return;
    }

    try {
      setState(s => ({ ...s, loading: true, row: null, matches: [] }));

      const res = await apiFetch<any>(`/personal/${clean}`);

      if (!res?.ok || !res?.data) {
        toast.error("No encontrado", `No hay agente con DNI ${clean}`);
        setState(s => ({ ...s, loading: false }));
        return;
      }

      // Garantizar que dni siempre esté presente para que cleanDni y la foto funcionen
      const rowData = { ...res.data };
      if (!rowData.dni) rowData.dni = Number(clean);

      setState(s => ({ ...s, loading: false, row: rowData }));
      toast.ok("Agente cargado", `${rowData.apellido ?? ''}, ${rowData.nombre ?? ''}`);
      trackAction('gestion_load_agente_by_dni', { dni: clean });
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
      // /personal/search tiene un bug SQL en el backend.
      // Usamos cache local con búsqueda client-side.
      const results = await searchPersonal(q);
      setState(s => ({ ...s, loading: false, matches: results }));
      if (!results.length) toast.error("Sin resultados", `No se encontró "${q}"`);
      else toast.ok(`${results.length} resultado(s)`);
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
    // cleanDni siempre tiene valor porque garantizamos rowData.dni arriba
    cleanDni: state.row?.dni ? String(state.row.dni).replace(/\D/g, "") : "",

    setDni: (dni: string) => setState(s => ({ ...s, dni })),
    setFullName: (fullName: string) => setState(s => ({ ...s, fullName })),

    onSearch,
    onSearchByName,

    // FIX race condition: pasa el DNI directo sin depender del state desactualizado
    loadByDni: async (dniValue: string) => {
      const clean = String(dniValue).replace(/\D/g, "");
      setState(s => ({ ...s, dni: clean }));
      await onSearch(clean);
    }
  };
}
