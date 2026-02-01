// src/pages/TableViewPage/hooks/useTableViewData.ts
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';
import { Meta, TableRow } from '../types';

export function useTableViewData(tableName: string | undefined, page: number, limit: number) {
  const toast = useToast();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!tableName) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await apiFetch<any>(`/${encodeURIComponent(tableName)}?page=${page}&limit=${limit}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
      setMeta(res?.meta || null);
    } catch (e: any) {
      const message = e?.message || 'Error al cargar datos';
      setError(message);
      toast.error('No se pudo cargar', message);
    } finally {
      setLoading(false);
    }
  }, [tableName, page, limit, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { rows, meta, loading, error, reload: loadData };
}