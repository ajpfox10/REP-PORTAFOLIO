// src/hooks/useDebounce.ts
import { useState, useEffect } from 'react';

/**
 * Hook para debounce de valores
 * Útil para búsquedas, filtros, etc.
 * 
 * @param value - El valor a debounce
 * @param delay - Tiempo en milisegundos (default: 500ms)
 * @returns El valor debounced
 */
export function useDebounce<T>(value: T, delay: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Establecer un timer para actualizar el valor debounced
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Limpiar el timer si el valor cambia antes del delay
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Ejemplo de uso en GestionPage:
/*
function GestionPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  
  useEffect(() => {
    // Esta función solo se ejecuta después de 300ms sin cambios
    if (debouncedSearch) {
      buscarAgentes(debouncedSearch);
    }
  }, [debouncedSearch]);
  
  return (
    <input 
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder="Buscar..."
    />
  );
}
*/