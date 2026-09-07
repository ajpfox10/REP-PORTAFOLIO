import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

// Inicio con resumen operativo y accesos segun permisos.
export function HomePage() {
  const { session, hasPermission } = useAuth();
  const canAdmin =
    hasPermission("usuarios:leer") ||
    hasPermission("roles:leer") ||
    hasPermission("permisos:leer") ||
    hasPermission("solicitudes:leer") ||
    hasPermission("hc:configurar");

  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <h1>Inicio</h1>
          <p>{canAdmin ? "Panel base para operar Archivo Pasivo y administrar accesos." : "Accesos disponibles para el area de Legales."}</p>
        </div>
      </div>

      <div className="summary-grid">
        <article className="summary-card">
          <span>Sesion</span>
          <strong>{session?.user.username || session?.user.email}</strong>
          <p>{session?.permissions.length ?? 0} permisos activos.</p>
        </article>
        <article className="summary-card">
          <span>Modulo principal</span>
          <strong>Historias clinicas</strong>
          <p>Legales puede consultar el historial y generar pedidos al pasivo.</p>
        </article>
        {canAdmin && (
          <article className="summary-card">
            <span>Seguridad</span>
            <strong>JWT + RBAC</strong>
            <p>Access token, refresh revocable y permisos por modulo.</p>
          </article>
        )}
      </div>

      <div className="module-grid">
        {canAdmin && (
          <Link className="module-tile" to="/administracion">
            <strong>Administracion</strong>
            <span>Usuarios, roles, permisos y solicitudes de acceso.</span>
          </Link>
        )}
        {canAdmin && (
          <Link className="module-tile" to="/archivo">
            <strong>Archivo Pasivo</strong>
            <span>Mapa de paginas futuras para el modulo documental.</span>
          </Link>
        )}
        {hasPermission("hc:leer") && (
          <Link className="module-tile" to="/historias-clinicas">
            <strong>Historias clinicas</strong>
            <span>Historial de HC, pedidos y estado resuelto.</span>
          </Link>
        )}
        {hasPermission("cuenta:editar") && (
          <Link className="module-tile" to="/mi-cuenta">
            <strong>Mi cuenta</strong>
            <span>Cambiar contrasena despues de ingresar.</span>
          </Link>
        )}
      </div>
    </section>
  );
}
