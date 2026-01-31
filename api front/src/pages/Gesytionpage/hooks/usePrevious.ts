// src/hooks/usePrevious.ts
import { useRef, useEffect } from 'react';

/**
 * Hook para obtener el valor anterior de una variable
 * Útil para comparar cambios
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  
  useEffect(() => {
    ref.current = value;
  });
  
  return ref.current;
}

// Uso:
/*
function Componente({ contador }) {
  const prevContador = usePrevious(contador);
  
  useEffect(() => {
    if (prevContador !== undefined && contador !== prevContador) {
      console.log(`Contador cambió de ${prevContador} a ${contador}`);
    }
  }, [contador, prevContador]);
}
*/