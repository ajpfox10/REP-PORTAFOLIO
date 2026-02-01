// src/pages/TableViewPage/hooks/useTableViewPagination.ts
import { useState, useMemo, useCallback } from 'react';
import { Meta } from '../types';

export function useTableViewPagination(initialMeta: Meta | null = null) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const totalPages = useMemo(() => {
    return initialMeta ? Math.max(1, Math.ceil(initialMeta.total / initialMeta.limit)) : 1;
  }, [initialMeta]);

  const goToFirstPage = useCallback(() => setPage(1), []);
  const goToLastPage = useCallback(() => setPage(totalPages), [totalPages]);
  const goToNextPage = useCallback(() => {
    setPage(p => Math.min(totalPages, p + 1));
  }, [totalPages]);
  const goToPrevPage = useCallback(() => {
    setPage(p => Math.max(1, p - 1));
  }, []);

  return {
    page,
    setPage,
    limit,
    setLimit,
    totalPages,
    goToFirstPage,
    goToLastPage,
    goToNextPage,
    goToPrevPage
  };
}