// src/pages/TableViewPage/hooks/useTableViewPagination.ts
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Meta } from '../types';

export function useTableViewPagination() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  // meta viene del data hook y se conecta desde afuera con setMeta
  const [meta, setMeta] = useState<Meta | null>(null);

  // Siempre calculado desde meta real: nunca queda en 1 por default
  const totalPages = useMemo(() => {
    if (!meta) return 1;
    if (meta.total === 0) return 1;
    return Math.max(1, Math.ceil(meta.total / limit));
  }, [meta, limit]);

  // Cuando cambia el limit, volvemos a página 1 para no quedar en una página inexistente
  useEffect(() => {
    setPage(1);
  }, [limit]);

  // Si la página actual supera el nuevo total de páginas, ajustar
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages]);

  const goToFirstPage = useCallback(() => setPage(1), []);
  const goToLastPage = useCallback(() => setPage(totalPages), [totalPages]);
  const goToNextPage = useCallback(() => setPage(p => Math.min(totalPages, p + 1)), [totalPages]);
  const goToPrevPage = useCallback(() => setPage(p => Math.max(1, p - 1)), []);

  return {
    page,
    setPage,
    limit,
    setLimit,
    meta,
    setMeta, // ← TableViewPage conecta esto al meta que devuelve useTableViewData
    totalPages,
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPrevPage,
  };
}
