import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

// Protege rutas privadas del sistema.
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
