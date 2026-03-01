// src/auth/RequirePermission.tsx
import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useToast } from '../ui/toast';

export function RequirePermission({
  perm,
  children,
}: {
  perm: string;
  children: React.ReactNode;
}) {
  const { session, isReady, hasPerm } = useAuth();
  const loc = useLocation();
  const toast = useToast();
  const warned = useRef(false);

  if (!isReady) return null;
  if (!session) return <Navigate to="/gate" state={{ from: loc.pathname }} replace />;

  const ok = hasPerm(perm);
  useEffect(() => {
    if (!ok && !warned.current) {
      warned.current = true;
      toast.warning('Acceso denegado', 'No tenés permisos para entrar acá.');
    }
  }, [ok, toast]);

  if (!ok) return <Navigate to="/app/forbidden" replace />;
  return <>{children}</>;
}
