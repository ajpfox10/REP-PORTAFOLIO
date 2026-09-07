import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/http";
import { useAuth } from "../auth/AuthProvider";

type Tab = "usuarios" | "roles" | "permisos" | "solicitudes" | "etiquetas";

type UserRow = {
  id: number;
  username: string;
  email: string;
  nombre: string;
  activo: number;
  rol_id: number;
  rol_nombre: string;
  two_factor_enabled: number;
};

type RoleRow = {
  id: number;
  nombre: string;
  descripcion: string;
  permiso_ids: number[] | string;
};

type PermissionRow = {
  id: number;
  clave: string;
  descripcion: string;
};

type RequestRow = {
  id: number;
  email: string;
  nombre: string;
  motivo: string | null;
  status: string;
  confirmed_at: string | null;
  expires_at: string;
  created_at: string;
};

type HcConfig = {
  menor: number;
  mayor: number;
  etiqueta: {
    ancho_mm: number;
    alto_mm: number;
    fuente_pt: number;
  };
};

const emptyUser = {
  username: "",
  email: "",
  nombre: "",
  password: "",
  rol_id: "",
};

// Administra usuarios, roles, permisos y solicitudes de acceso.
export function AdminPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("usuarios");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [hcConfig, setHcConfig] = useState<HcConfig>({
    menor: 5,
    mayor: 10,
    etiqueta: { ancho_mm: 64, alto_mm: 36, fuente_pt: 8 },
  });
  const [newUser, setNewUser] = useState(emptyUser);
  const [resetPasswords, setResetPasswords] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canUsers = hasPermission("usuarios:leer");
  const canCreateUsers = hasPermission("usuarios:crear");
  const canEditUsers = hasPermission("usuarios:editar");
  const canRoles = hasPermission("roles:leer");
  const canEditRoles = hasPermission("roles:editar");
  const canPermissions = hasPermission("permisos:leer");
  const canRequests = hasPermission("solicitudes:leer");
  const canLabelConfig = hasPermission("hc:configurar");

  // Normaliza permiso_ids porque MySQL puede devolver JSON como string.
  const normalizedRoles = useMemo(() => {
    return roles.map((role) => {
      const ids = typeof role.permiso_ids === "string" ? JSON.parse(role.permiso_ids || "[]") : role.permiso_ids;
      return { ...role, permiso_ids: Array.isArray(ids) ? ids.filter((id) => Number(id) > 0) : [] };
    });
  }, [roles]);

  // Carga los catalogos administrativos disponibles para el usuario.
  async function loadAdminData() {
    const tasks: Promise<unknown>[] = [];
    if (canUsers) tasks.push(apiFetch<{ ok: true; data: UserRow[] }>("/admin/usuarios").then((res) => setUsers(res.data)));
    if (canRoles) tasks.push(apiFetch<{ ok: true; data: RoleRow[] }>("/admin/roles").then((res) => setRoles(res.data)));
    if (canPermissions) tasks.push(apiFetch<{ ok: true; data: PermissionRow[] }>("/admin/permisos").then((res) => setPermissions(res.data)));
    if (canRequests) tasks.push(apiFetch<{ ok: true; data: RequestRow[] }>("/admin/solicitudes").then((res) => setRequests(res.data)));
    if (canLabelConfig) tasks.push(apiFetch<{ ok: true; data: HcConfig }>("/hc/config").then((res) => setHcConfig(res.data)));
    await Promise.all(tasks);
  }

  useEffect(() => {
    loadAdminData().catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar administracion"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "usuarios" && !canUsers) {
      if (canRoles) setTab("roles");
      else if (canPermissions) setTab("permisos");
      else if (canRequests) setTab("solicitudes");
      else if (canLabelConfig) setTab("etiquetas");
    }
  }, [canLabelConfig, canPermissions, canRequests, canRoles, canUsers, tab]);

  async function saveLabelConfig(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ ok: true; data: HcConfig }>("/hc/config", {
        method: "PATCH",
        body: JSON.stringify(hcConfig),
      });
      setHcConfig(res.data);
      setMessage("Configuracion de etiqueta guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la etiqueta");
    }
  }

  // Crea un usuario nuevo con rol unico.
  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiFetch("/admin/usuarios", {
        method: "POST",
        body: JSON.stringify({ ...newUser, rol_id: Number(newUser.rol_id), activo: true }),
      });
      setNewUser(emptyUser);
      setMessage("Usuario creado correctamente.");
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el usuario");
    }
  }

  // Cambia el estado activo/inactivo de un usuario.
  async function toggleUser(user: UserRow) {
    setError("");
    try {
      await apiFetch(`/admin/usuarios/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !Boolean(user.activo) }),
      });
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el usuario");
    }
  }

  // Cambia el rol unico del usuario.
  async function changeRole(userId: number, roleId: number) {
    setError("");
    try {
      await apiFetch(`/admin/usuarios/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ rol_id: roleId }),
      });
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el rol");
    }
  }

  // Resetea una contrasena desde administracion.
  async function resetPassword(userId: number) {
    const password = resetPasswords[userId] || "";
    if (!password) return;
    setError("");
    try {
      await apiFetch(`/admin/usuarios/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setResetPasswords((current) => ({ ...current, [userId]: "" }));
      setMessage("Contrasena actualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resetear la contrasena");
    }
  }

  // Activa o desactiva un permiso para un rol.
  async function toggleRolePermission(role: RoleRow, permissionId: number) {
    const ids = typeof role.permiso_ids === "string" ? JSON.parse(role.permiso_ids || "[]") : role.permiso_ids;
    const current = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];
    const next = current.includes(permissionId)
      ? current.filter((id) => id !== permissionId)
      : [...current, permissionId];
    setError("");
    try {
      await apiFetch(`/admin/roles/${role.id}/permisos`, {
        method: "PATCH",
        body: JSON.stringify({ permisoIds: next }),
      });
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el rol");
    }
  }

  if (!canUsers && !canRoles && !canPermissions && !canRequests && !canLabelConfig) {
    return (
      <section className="page-content">
        <div className="empty-state">No tenes permisos administrativos asignados.</div>
      </section>
    );
  }

  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <h1>Administracion</h1>
          <p>Gestion de usuarios, roles, permisos, solicitudes y etiquetas.</p>
        </div>
        {canCreateUsers && <button className="primary-btn" type="button" onClick={() => setTab("usuarios")}>Nuevo usuario</button>}
      </div>

      <div className="admin-tabs">
        {canUsers && <button className={tab === "usuarios" ? "active" : ""} onClick={() => setTab("usuarios")}>Usuarios</button>}
        {canRoles && <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}>Roles</button>}
        {canPermissions && <button className={tab === "permisos" ? "active" : ""} onClick={() => setTab("permisos")}>Permisos</button>}
        {canRequests && <button className={tab === "solicitudes" ? "active" : ""} onClick={() => setTab("solicitudes")}>Solicitudes</button>}
        {canLabelConfig && <button className={tab === "etiquetas" ? "active" : ""} onClick={() => setTab("etiquetas")}>Etiquetas</button>}
      </div>

      {error && <div className="app-alert error">{error}</div>}
      {message && <div className="app-alert success">{message}</div>}

      {tab === "usuarios" && canUsers && (
        <div className="admin-split">
          <div className="panel">
            <div className="panel-head">
              <h2>Usuarios</h2>
              <span>{users.length} registros</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Reset</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.username}</strong><span>{user.email}</span></td>
                      <td>{user.nombre}</td>
                      <td>
                        <select value={user.rol_id} disabled={!canEditUsers} onChange={(event) => changeRole(user.id, Number(event.target.value))}>
                          {normalizedRoles.map((role) => <option key={role.id} value={role.id}>{role.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className={user.activo ? "status-pill ok" : "status-pill off"} disabled={!canEditUsers} onClick={() => toggleUser(user)}>
                          {user.activo ? "Activo" : "Inactivo"}
                        </button>
                      </td>
                      <td>
                        <div className="inline-reset">
                          <input
                            type="password"
                            placeholder="Nueva clave"
                            value={resetPasswords[user.id] || ""}
                            disabled={!canEditUsers}
                            onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                          />
                          <button disabled={!canEditUsers || !resetPasswords[user.id]} onClick={() => resetPassword(user.id)}>Aplicar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {canCreateUsers && (
            <form className="panel form-panel" onSubmit={createUser}>
              <div className="panel-head">
                <h2>Alta de usuario</h2>
                <span>Rol unico</span>
              </div>
              <label className="form-field">Usuario
                <input value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} />
              </label>
              <label className="form-field">Email
                <input value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} />
              </label>
              <label className="form-field">Nombre
                <input value={newUser.nombre} onChange={(event) => setNewUser({ ...newUser, nombre: event.target.value })} />
              </label>
              <label className="form-field">Contrasena inicial
                <input type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
              </label>
              <label className="form-field">Rol
                <select value={newUser.rol_id} onChange={(event) => setNewUser({ ...newUser, rol_id: event.target.value })}>
                  <option value="">Seleccionar</option>
                  {normalizedRoles.map((role) => <option key={role.id} value={role.id}>{role.nombre}</option>)}
                </select>
              </label>
              <button className="primary-btn" type="submit">Crear usuario</button>
            </form>
          )}
        </div>
      )}

      {tab === "roles" && canRoles && (
        <div className="panel">
          <div className="panel-head">
            <h2>Roles y permisos</h2>
            <span>Un usuario tiene un solo rol</span>
          </div>
          <div className="role-grid">
            {normalizedRoles.map((role) => (
              <article className="role-card" key={role.id}>
                <h3>{role.nombre}</h3>
                <p>{role.descripcion}</p>
                <div className="permission-checks">
                  {permissions.map((permission) => (
                    <label key={permission.id}>
                      <input
                        type="checkbox"
                        checked={(role.permiso_ids as number[]).includes(permission.id)}
                        disabled={!canEditRoles}
                        onChange={() => toggleRolePermission(role, permission.id)}
                      />
                      <span>{permission.clave}</span>
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "permisos" && canPermissions && (
        <div className="panel">
          <div className="panel-head">
            <h2>Permisos disponibles</h2>
            <span>{permissions.length} permisos</span>
          </div>
          <div className="permission-list">
            {permissions.map((permission) => (
              <article key={permission.id}>
                <strong>{permission.clave}</strong>
                <span>{permission.descripcion}</span>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "solicitudes" && canRequests && (
        <div className="panel">
          <div className="panel-head">
            <h2>Solicitudes de acceso</h2>
            <span>{requests.length} registros</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Estado</th>
                  <th>Motivo</th>
                  <th>Creada</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.nombre}</td>
                    <td>{request.email}</td>
                    <td><span className="status-pill wait">{request.status}</span></td>
                    <td>{request.motivo || "-"}</td>
                    <td>{new Date(request.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "etiquetas" && canLabelConfig && (
        <form className="panel form-panel label-config-panel" onSubmit={saveLabelConfig}>
          <div className="panel-head">
            <h2>Etiqueta de historias clinicas</h2>
            <span>Milimetros y puntos</span>
          </div>
          <div className="label-config-grid">
            <label className="form-field">Ancho
              <input
                type="number"
                min="20"
                max="210"
                step="1"
                value={hcConfig.etiqueta.ancho_mm}
                onChange={(event) => setHcConfig({ ...hcConfig, etiqueta: { ...hcConfig.etiqueta, ancho_mm: Number(event.target.value) } })}
              />
            </label>
            <label className="form-field">Largo
              <input
                type="number"
                min="10"
                max="297"
                step="1"
                value={hcConfig.etiqueta.alto_mm}
                onChange={(event) => setHcConfig({ ...hcConfig, etiqueta: { ...hcConfig.etiqueta, alto_mm: Number(event.target.value) } })}
              />
            </label>
            <label className="form-field">Letra
              <input
                type="number"
                min="5"
                max="32"
                step="1"
                value={hcConfig.etiqueta.fuente_pt}
                onChange={(event) => setHcConfig({ ...hcConfig, etiqueta: { ...hcConfig.etiqueta, fuente_pt: Number(event.target.value) } })}
              />
            </label>
          </div>
          <div
            className="print-label label-preview"
            style={{
              width: `${hcConfig.etiqueta.ancho_mm}mm`,
              minHeight: `${hcConfig.etiqueta.alto_mm}mm`,
              fontSize: `${hcConfig.etiqueta.fuente_pt}pt`,
            }}
          >
            <strong>2020</strong>
            <div className="label-preview-barcode" />
            <span>Fecha ultimo movimiento: 2020-05-20</span>
            <span>Caja: CAJA 12</span>
          </div>
          <button className="primary-btn" type="submit">Guardar etiqueta</button>
        </form>
      )}
    </section>
  );
}
