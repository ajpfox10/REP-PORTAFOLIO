// src/hooks/index.ts
/**
 * Barrel exports para todos los hooks
 * Esto permite importaciones limpias como:
 * import { useAgenteSearch, useDebounce } from '../hooks';
 */

// Hooks de GestionPage
export { useAgenteSearch } from './useAgenteSearch';
export { useModules, type ModuleKey, type ModuleState } from './useModules';
export { usePedidos } from './usePedidos';
export { useDocumentos } from './useDocumentos';
export { useCellModal } from './useCellModal';

// Hooks utilitarios reutilizables
export { useDebounce } from './useDebounce';
export { useLocalStorage } from './useLocalStorage';

// Hooks adicionales (puedes agregar más)
export { usePrevious } from './usePrevious';
export { useIsMounted } from './useIsMounted';
export { useOnlineStatus } from './useOnlineStatus';

// Ejemplo de otros hooks útiles:
/*
// usePrevious.ts
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

// useIsMounted.ts
export function useIsMounted(): boolean {
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return isMounted.current;
}

// useOnlineStatus.ts
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  return isOnline;
}
*/