// hooks/useModules.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '../../../ui/toast';
import { apiFetch } from '../../../api/http';
import { trackAction } from '../../../logging/track';

export type ModuleKey = "consultas" | "pedidos" | "documentos";

export type ModuleState = {
  open: boolean;
  rows: any[];
  selectedIndex: number;
  loading: boolean;
  scanned: { pages: number; totalPages: number; total: number } | null;
  tablePage: number;
  tablePageSize: number;
};

export function useModules(cleanDni: string, dnisRelacionados?: string[]) {
  const toast = useToast();
  const prevDniRef = useRef('');

  // Lista de DNIs a consultar: el principal + los que quedaron de cambios de DNI.
  // Si aún no se resolvió la cadena, cae al principal.
  const dnis = (dnisRelacionados && dnisRelacionados.length)
    ? dnisRelacionados
    : (cleanDni ? [cleanDni] : []);

  const emptyState = () => ({
    consultas:  { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
    pedidos:    { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
    documentos: { open: false, rows: [], selectedIndex: 0, loading: false, scanned: null, tablePage: 1, tablePageSize: 50 },
  });

  const [modules, setModules] = useState<Record<ModuleKey, ModuleState>>(emptyState());

  // FIX: al cambiar de agente resetear todos los módulos para no mostrar datos del anterior.
  // closeModule solo ponía open:false pero rows quedaban → al reabrir no recargaba.
  useEffect(() => {
    if (!cleanDni || cleanDni === prevDniRef.current) return;
    prevDniRef.current = cleanDni;
    setModules(emptyState());
  }, [cleanDni]);

  const loadModule = useCallback(async (
    table: ModuleKey,
    opts?: { forceReload?: boolean }
  ) => {
    if (!cleanDni) {
      toast.error('Primero buscá un agente', 'Ingresá un DNI válido');
      return;
    }

    const current = modules[table];
    if (current.loading) return;

    setModules(prev => ({ ...prev, [table]: { ...prev[table], open: true } }));
    trackAction('gestion_module_open', { module: table, dni: Number(cleanDni), forceReload: !!opts?.forceReload });

    if (current.rows.length && !opts?.forceReload) return;

    try {
      setModules(prev => ({
        ...prev,
        [table]: { ...prev[table], loading: true, rows: [], selectedIndex: 0, scanned: null, tablePage: 1 }
      }));

      // Tabla y endpoint
      const endpoint = table === 'documentos' ? '/tblarchivos' : `/${table}`;
      const limit = 200;

      // ANTES: usaba ?q= que el back no soporta + loop de 5 páginas en frontend
      // AHORA: filtro exacto ?dni= directo, el back devuelve solo los del agente.
      // Si el agente cambió de DNI, consultamos también los DNIs viejos y fusionamos.
      const dnisConsulta = dnis.length ? dnis : [cleanDni];
      let allRows: any[] = [];

      for (const dni of dnisConsulta) {
        let page = 1;
        let totalPages = 1;
        while (true) {
          const res = await apiFetch<any>(`${endpoint}?dni=${dni}&limit=${limit}&page=${page}`);
          const rows: any[] = res?.data || [];
          const meta = res?.meta;
          if (meta) totalPages = Math.max(1, Math.ceil((Number(meta.total) || rows.length) / limit));

          allRows = [...allRows, ...rows];

          if (!rows.length || rows.length < limit || page >= totalPages) break;
          page++;
          if (allRows.length >= 2000) break; // Guardia de rendimiento
        }
        if (allRows.length >= 2000) break;
      }

      const dniViejos = dnisConsulta.slice(1);
      const filasViejas = dniViejos.length
        ? allRows.filter(r => dniViejos.includes(String(r?.dni))).length
        : 0;

      setModules(prev => ({
        ...prev,
        [table]: {
          ...prev[table],
          loading: false,
          rows: allRows,
          scanned: { pages: 1, totalPages: 1, total: allRows.length }
        }
      }));

      if (!allRows.length) {
        toast.ok("Sin resultados", `No hay ${table} para DNI ${cleanDni}`);
      } else if (filasViejas > 0) {
        toast.ok("Listo", `${table}: ${allRows.length} registro/s (incluye ${filasViejas} de DNI anterior: ${dniViejos.join(', ')})`);
      } else {
        toast.ok("Listo", `${table}: ${allRows.length} registro/s`);
      }

    } catch (e: any) {
      setModules(prev => ({ ...prev, [table]: { ...prev[table], loading: false } }));
      toast.error("No se pudo cargar módulo", e?.message || "Error");
    }
  }, [cleanDni, dnis.join(','), modules, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeModule = useCallback((table: ModuleKey) => {
    trackAction('gestion_module_close', { module: table, dni: cleanDni });
    setModules(prev => ({ ...prev, [table]: { ...prev[table], open: false } }));
  }, [cleanDni]);

  const setSelectedIndex = useCallback((table: ModuleKey, index: number) => {
    setModules(prev => ({ ...prev, [table]: { ...prev[table], selectedIndex: index } }));
  }, []);

  const setTablePage = useCallback((table: ModuleKey, page: number) => {
    setModules(prev => ({ ...prev, [table]: { ...prev[table], tablePage: page } }));
  }, []);

  const setTablePageSize = useCallback((table: ModuleKey, size: number) => {
    setModules(prev => ({ ...prev, [table]: { ...prev[table], tablePageSize: size, tablePage: 1 } }));
  }, []);

  return {
    modules,
    loadModule,
    closeModule,
    setSelectedIndex,
    setTablePage,
    setTablePageSize,
    getModule: (key: ModuleKey) => modules[key],
    isModuleOpen: (key: ModuleKey) => modules[key].open,
    getSelectedRow: (key: ModuleKey) => {
      const st = modules[key];
      if (!st.rows.length) return null;
      const idx = Math.min(Math.max(0, st.selectedIndex), st.rows.length - 1);
      return st.rows[idx];
    }
  };
}
