// src/pages/TablesPage/hooks/useTablesData.ts
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../api/http';
import type { ApiError } from '../../../api/http';

export function useTablesData() {
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTables() {
    try {
      setLoading(true);
      setError(null);
      
      const res = await apiFetch<any>('/tables');
      setTables(res?.data || []);
      
    } catch (e: any) {
      setError(e?.message || 'Error cargando tablas');
      throw e;
    } finally {
      setLoading(false);
    }
  }

  // Carga inicial
  useEffect(() => {
    let mounted = true;
    
    (async () => {
      try {
        await loadTables();
      } catch {
        if (mounted) setError('No se pudieron obtener las tablas');
      }
    })();
    
    return () => {
      mounted = false;
    };
  }, []);

  return {
    // Estado
    tables,
    loading,
    error,
    
    // Acciones
    reload: loadTables,
    
    // Helpers
    hasTables: tables.length > 0,
    totalTables: tables.length,
  };
}