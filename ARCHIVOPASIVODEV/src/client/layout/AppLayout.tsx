import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

// Layout principal posterior al login con navegacion por permisos.
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, logout, hasPermission } = useAuth();
  const canAdmin =
    hasPermission("usuarios:leer") ||
    hasPermission("roles:leer") ||
    hasPermission("permisos:leer") ||
    hasPermission("solicitudes:leer") ||
    hasPermission("hc:configurar");

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <div className="side-brand">
          <span>AP</span>
          <strong>Archivo Pasivo</strong>
        </div>
        <nav className="side-nav" aria-label="Principal">
          <NavLink to="/" end>Inicio</NavLink>
          {hasPermission("hc:leer") && <NavLink to="/historias-clinicas">Historias clinicas</NavLink>}
          {canAdmin && <NavLink to="/archivo">Archivo Pasivo</NavLink>}
          {canAdmin && <NavLink to="/administracion">Administracion</NavLink>}
          {hasPermission("auditoria:leer") && <NavLink to="/auditoria">Auditoria</NavLink>}
          {hasPermission("cuenta:editar") && <NavLink to="/mi-cuenta">Mi cuenta</NavLink>}
        </nav>
        {canAdmin && (
          <div className="side-note">
            <strong>Guia de modulos</strong>
            <span>Vamos habilitando paginas a medida que definamos cada flujo.</span>
          </div>
        )}
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <div>
            <strong>{session?.user.nombre}</strong>
            <span>{session?.user.username || session?.user.email}</span>
          </div>
          <button type="button" onClick={logout}>Salir</button>
        </header>
        {children}
      </main>
    </div>
  );
}
