// src/hooks/useIsMounted.ts
import { useRef, useEffect } from 'react';

/**
 * Hook para verificar si el componente está montado
 * Previene updates en componentes desmontados
 */
export function useIsMounted(): () => boolean {
  const isMounted = useRef(false);
  
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  
  return () => isMounted.current;
}

// Uso en llamadas async:
/*
function Componente() {
  const isMounted = useIsMounted();
  
  useEffect(() => {
    fetchData().then(data => {
      if (isMounted()) {
        setData(data); // Solo actualiza si está montado
      }
    });
  }, []);
}
*/