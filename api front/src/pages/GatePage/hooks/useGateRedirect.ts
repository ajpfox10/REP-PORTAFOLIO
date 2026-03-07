// src/pages/GatePage/hooks/useGateRedirect.ts
import { useAuth } from '../../../auth/AuthProvider';

export function useGateRedirect() {
  const { session } = useAuth();
  
  // Si hay sesión, debería redirigir a /app
  const shouldRedirect = !!session;
  
  return {
    shouldRedirect,
    session,
  };
}