// hooks/useModules.ts
import { useState, useCallback } from 'react';
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

export function useModules(cleanDni: string) {
  const toast = useToast();
  
  const [modules, setModules] = useState<Record<ModuleKey, ModuleState>>({
    consultas: { 
      open: false, rows: [], selectedIndex: 0, loading: false, 
      scanned: null, tablePage: 1, tablePageSize: 50 
    },
    pedidos: { 
      open: false, rows: [], selectedIndex: 0, loading: false, 
      scanned: null, tablePage: 1, tablePageSize: 50 
    },
    documentos: { 
      open: false, rows: [], selectedIndex: 0, loading: false, 
      scanned: null, tablePage: 1, tablePageSize: 50 
    },
  });

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

    // 1. Abrir módulo
    setModules(prev => ({
      ...prev,
      [table]: { ...prev[table], open: true }
    }));

    trackAction('gestion_module_open', { 
      module: table, 
      dni: Number(cleanDni), 
      forceReload: !!opts?.forceReload 
    });

    // 2. Si ya tiene datos y no forzamos reload, salir
    if (current.rows.length && !opts?.forceReload) {
      return;
    }

    try {
      setModules(prev => ({
        ...prev,
        [table]: { 
          ...prev[table], 
          loading: true, 
          rows: [], 
          selectedIndex: 0, 
          scanned: null, 
          tablePage: 1 
        }
      }));

      // OPTIMIZACIÓN: Pedir filtrado por DNI al backend
      const endpoint = table === 'documentos' 
        ? '/tblarchivos' 
        : `/${table}`;
      
      let allRows: any[] = [];
      let page = 1;
      const limit = 100;
      let total = 0;
      let totalPages = 1;

      // Intentar con filtro DNI si el backend lo soporta
      try {
        const res = await apiFetch<any>(`${endpoint}?dni=${cleanDni}&limit=${limit}`);
        if (res?.data) {
          allRows = res.data;
          total = res?.meta?.total || allRows.length;
          totalPages = Math.ceil(total / limit);
        }
      } catch {
        // Fallback: paginación tradicional
        while (page <= 5 && allRows.length < 500) {
          const res = await apiFetch<any>(`${endpoint}?page=${page}&limit=${limit}`);
          const rows = res?.data || [];
          const meta = res?.meta;
          
          if (meta) {
            total = Number(meta.total) || 0;
            totalPages = Math.max(1, Math.ceil(total / limit));
          }
          
          // Filtrar por DNI en frontend (temporal)
          const filtered = rows.filter((r: any) => 
            String(r?.dni ?? "").replace(/\D/g, "") === cleanDni
          );
          allRows = [...allRows, ...filtered];
          
          if (!rows.length || rows.length < limit) break;
          page++;
        }
      }

      setModules(prev => ({
        ...prev,
        [table]: {
          ...prev[table],
          loading: false,
          rows: allRows,
          scanned: { pages: page, totalPages, total }
        }
      }));

      if (!allRows.length) {
        toast.ok("Sin resultados", `No hay ${table} para DNI ${cleanDni}`);
      } else {
        toast.ok("Listo", `${table}: ${allRows.length} registro/s`);
      }
    } catch (e: any) {
      setModules(prev => ({
        ...prev,
        [table]: { ...prev[table], loading: false }
      }));
      toast.error("No se pudo cargar módulo", e?.message || "Error");
    }
  }, [cleanDni, modules, toast]);

  const closeModule = useCallback((table: ModuleKey) => {
    trackAction('gestion_module_close', { module: table, dni: cleanDni });
    setModules(prev => ({
      ...prev,
      [table]: { ...prev[table], open: false }
    }));
  }, [cleanDni]);

  const setSelectedIndex = useCallback((table: ModuleKey, index: number) => {
    setModules(prev => ({
      ...prev,
      [table]: { ...prev[table], selectedIndex: index }
    }));
  }, []);

  const setTablePage = useCallback((table: ModuleKey, page: number) => {
    setModules(prev => ({
      ...prev,
      [table]: { ...prev[table], tablePage: page }
    }));
  }, []);

  const setTablePageSize = useCallback((table: ModuleKey, size: number) => {
    setModules(prev => ({
      ...prev,
      [table]: { 
        ...prev[table], 
        tablePageSize: size, 
        tablePage: 1 
      }
    }));
  }, []);

  return {
    modules,
    loadModule,
    closeModule,
    setSelectedIndex,
    setTablePage,
    setTablePageSize,
    
    // Helpers
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