// src/hooks/useLocalStorage.ts
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para manejar localStorage de forma reactiva
 * 
 * @param key - Clave en localStorage
 * @param initialValue - Valor inicial
 * @returns [valor, setter, remover]
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void, () => void] {
  
  // Estado para el valor
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error leyendo localStorage clave "${key}":`, error);
      return initialValue;
    }
  });

  // Función para actualizar localStorage y estado
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // Permitir value como función (como useState)
      const valueToStore = value instanceof Function 
        ? value(storedValue) 
        : value;
      
      // Guardar en estado
      setStoredValue(valueToStore);
      
      // Guardar en localStorage
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error guardando en localStorage clave "${key}":`, error);
    }
  }, [key, storedValue]);

  // Función para remover del localStorage
  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Error removiendo localStorage clave "${key}":`, error);
    }
  }, [key, initialValue]);

  // Sincronizar entre pestañas
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setStoredValue(JSON.parse(e.newValue));
        } catch (error) {
          console.warn(`Error sincronizando localStorage clave "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue, removeValue];
}

// Ejemplo de uso:
/*
function Componente() {
  // Uso básico
  const [nombre, setNombre] = useLocalStorage('nombre', 'Juan');
  
  // Uso con objeto complejo
  const [preferencias, setPreferencias] = useLocalStorage('prefs', {
    tema: 'claro',
    notificaciones: true,
    idioma: 'es'
  });
  
  // Función de limpieza
  const [, , remover] = useLocalStorage('token', '');
  
  return (
    <div>
      <input 
        value={nombre} 
        onChange={(e) => setNombre(e.target.value)} 
      />
      <button onClick={() => setPrefs(p => ({ ...p, tema: 'oscuro' }))}>
        Cambiar tema
      </button>
      <button onClick={remover}>Limpiar token</button>
    </div>
  );
}
*/