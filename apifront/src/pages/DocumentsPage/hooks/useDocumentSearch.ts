// src/pages/DocumentsPage/hooks/useDocumentSearch.ts
import { useState } from 'react';
import { apiFetch } from '../../../api/http';
import type { ApiError } from '../../../api/http';

export type DocRow = {
  id: number;
  nombre: string | null;
  numero: string | null;
  tipo: string | null;
  tamano: string | null;
  fecha: string | null;
  descripcion: string | null;
  fileUrl: string;
};

export function useDocumentSearch() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState<DocRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/documents?page=1&limit=50&q=${encodeURIComponent(q.trim())}`);
      const data = res?.data || [];
      setItems(data);
      if (data.length && !selected) setSelected(data[0]);
    } catch (e: any) {
      throw { message: e?.message || 'Error cargando documentos' } as ApiError;
    } finally {
      setLoading(false);
    }
  }

  return {
    // Estado
    q,
    setQ,
    loading,
    items,
    selected,
    setSelected,
    
    // Acciones
    load,
    
    // Helpers
    totalResults: items.length,
    hasResults: items.length > 0,
  };
}