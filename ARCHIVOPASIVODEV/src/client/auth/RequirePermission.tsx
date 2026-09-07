import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

// Protege una ruta por permiso fino en el frontend.
export function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
