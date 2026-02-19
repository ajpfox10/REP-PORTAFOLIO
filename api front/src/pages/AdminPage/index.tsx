// src/pages/AdminPage/index.tsx
import React, { useState, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { RequirePermission } from '../../auth/RequirePermission';
import { useAdminUsers, type UserRow, type Role } from './hooks/useAdminUsers';
import './styles/AdminPage.css';

// ─── Modales ─────────────────────────────────────────────────────────────────

function CreateUserModal({
  roles, form, saving,
  onChange, onClose, onSubmit,
}: {
  roles: Role[]; form: any; saving: boolean;
  onChange: (f: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  const [showPass, setShowPass] = useState(false);
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">👤 Nuevo usuario</p>
        <div className="form-grid">
          <div className="form-field">
            <label>Nombre completo *</label>
            <input value={form.nombre} placeholder="Ej: Juan Pérez"
              onChange={e => onChange({ ...form, nombre: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Email *</label>
            <input type="email" value={form.email} placeholder="usuario@dominio.com"
              onChange={e => onChange({ ...form, email: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Contraseña * (mín. 8 caracteres)</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input type={showPass ? 'text' : 'password'} value={form.password}
                placeholder="••••••••"
                style={{ flex: 1 }}
                onChange={e => onChange({ ...form, password: e.target.value })} />
              <button type="button" className="btn-icon" title="Mostrar/ocultar"
                onClick={() => setShowPass(v => !v)}>{showPass ? '🙈' : '👁️'}</button>
            </div>
          </div>
          <div className="form-field">
            <label>Estado</label>
            <select value={form.estado} onChange={e => onChange({ ...form, estado: e.target.value })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
          <div className="form-field full">
            <label>Rol</label>
            <select value={form.roleId ?? ''} onChange={e => onChange({ ...form, roleId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Sin rol —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
            {saving ? 'Guardando…' : '✓ Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditPasswordModal({ user, saving, onClose, onSubmit }: {
  user: UserRow; saving: boolean;
  onClose: () => void; onSubmit: (pwd: string) => void;
}) {
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">🔑 Resetear contraseña</p>
        <p style={{ color: '#555', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Usuario: <strong>{user.email}</strong>
        </p>
        <div className="form-field">
          <label>Nueva contraseña (mín. 8 caracteres)</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input type={show ? 'text' : 'password'} value={pwd} placeholder="••••••••"
              style={{ flex: 1 }} onChange={e => setPwd(e.target.value)} />
            <button type="button" className="btn-icon" onClick={() => setShow(v => !v)}>{show ? '🙈' : '👁️'}</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving || pwd.length < 8} onClick={() => onSubmit(pwd)}>
            {saving ? 'Guardando…' : '✓ Actualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignRoleModal({ user, roles, saving, onClose, onSubmit }: {
  user: UserRow; roles: Role[]; saving: boolean;
  onClose: () => void; onSubmit: (roleId: number | null) => void;
}) {
  const [selected, setSelected] = useState<number | null>(user.roleId ?? null);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box wide">
        <p className="modal-title">🎭 Asignar rol — {user.email}</p>
        <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '1rem' }}>
          Rol actual: <strong>{user.roleName || '— ninguno —'}</strong>
        </p>

        <div className="roles-grid">
          {/* Opción sin rol */}
          <div
            className={`role-option${selected === null ? ' selected' : ''}`}
            onClick={() => setSelected(null)}
          >
            <div className="role-option-name">🚫 Sin rol</div>
            <div className="role-option-desc">Sin acceso a la API</div>
          </div>

          {roles.map(r => (
            <div
              key={r.id}
              className={`role-option${selected === r.id ? ' selected' : ''}`}
              onClick={() => setSelected(r.id)}
            >
              <div className="role-option-name">{r.nombre}</div>
              {r.descripcion && <div className="role-option-desc">{r.descripcion}</div>}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSubmit(selected)}>
            {saving ? 'Guardando…' : '✓ Asignar rol'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function AdminPage() {
  const {
    users, roles, permissions, loading, saving,
    createModal, editModal, rolesModal, form,
    setForm, setCreateModal, setEditModal, setRolesModal,
    loadUsers, createUser, updateUserRole, toggleUserState, resetPassword,
  } = useAdminUsers();

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      (u.nombre ?? '').toLowerCase().includes(q) ||
      (u.roleName ?? '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const stats = useMemo(() => ({
    total: users.length,
    activos: users.filter(u => u.estado === 'activo').length,
    inactivos: users.filter(u => u.estado !== 'activo').length,
    sinRol: users.filter(u => !u.roleId).length,
  }), [users]);

  return (
    <RequirePermission perm="usuarios:write">
      <Layout title="Administración de Usuarios" showBack>
        <div className="admin-page">

          {/* Header */}
          <div className="admin-header">
            <div>
              <h2>👥 Usuarios del sistema</h2>
              <div className="admin-stats" style={{ marginTop: '0.5rem' }}>
                <span className="admin-stat-chip">Total: {stats.total}</span>
                <span className="admin-stat-chip active">Activos: {stats.activos}</span>
                <span className="admin-stat-chip inactive">Inactivos: {stats.inactivos}</span>
                {stats.sinRol > 0 && <span className="admin-stat-chip">Sin rol: {stats.sinRol}</span>}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => setCreateModal(true)}>
              + Nuevo usuario
            </button>
          </div>

          {/* Search */}
          <div className="admin-search">
            <input
              placeholder="Buscar por nombre, email o rol…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="btn" onClick={loadUsers} disabled={loading}>
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="admin-empty"><div className="admin-empty-icon">⏳</div>Cargando usuarios…</div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty"><div className="admin-empty-icon">👤</div>
              {search ? 'Sin resultados para la búsqueda' : 'No hay usuarios creados todavía'}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Usuario</th>
                    <th>Estado</th>
                    <th>Rol</th>
                    <th>Creado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id}>
                      <td style={{ color: '#aaa', fontSize: '0.8rem' }}>#{u.id}</td>
                      <td>
                        <div className="user-name">{u.nombre || '—'}</div>
                        <div className="user-email">{u.email}</div>
                      </td>
                      <td>
                        <span className={`estado-badge ${u.estado}`}>{u.estado}</span>
                      </td>
                      <td>
                        {u.roleName
                          ? <span className="role-chip">{u.roleName}</span>
                          : <span className="role-chip empty">Sin rol</span>
                        }
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#999' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button className="btn-icon" title="Asignar rol"
                            onClick={() => setRolesModal(u)}>🎭</button>
                          <button className="btn-icon" title="Resetear contraseña"
                            onClick={() => setEditModal(u)}>🔑</button>
                          <button
                            className={`btn-icon${u.estado === 'activo' ? ' danger' : ''}`}
                            title={u.estado === 'activo' ? 'Desactivar' : 'Activar'}
                            onClick={() => toggleUserState(u)}
                          >
                            {u.estado === 'activo' ? '🔴' : '🟢'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal crear usuario */}
        {createModal && (
          <CreateUserModal
            roles={roles}
            form={form}
            saving={saving}
            onChange={setForm}
            onClose={() => setCreateModal(false)}
            onSubmit={createUser}
          />
        )}

        {/* Modal resetear contraseña */}
        {editModal && (
          <EditPasswordModal
            user={editModal}
            saving={saving}
            onClose={() => setEditModal(null)}
            onSubmit={(pwd) => resetPassword(editModal.id, pwd)}
          />
        )}

        {/* Modal asignar rol */}
        {rolesModal && (
          <AssignRoleModal
            user={rolesModal}
            roles={roles}
            saving={saving}
            onClose={() => setRolesModal(null)}
            onSubmit={(roleId) => updateUserRole(rolesModal.id, roleId)}
          />
        )}
      </Layout>
    </RequirePermission>
  );
}

export default AdminPage;
