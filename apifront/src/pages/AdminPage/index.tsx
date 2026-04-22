// src/pages/AdminPage/index.tsx
import React, { useState, useMemo, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useAdminUsers, type UserRow, type Role, type Permission } from './hooks/useAdminUsers';
import { apiFetch } from '../../api/http';
import { usePendingRequests } from './hooks/usePendingRequests';
import { SolicitudesTab } from './components/SolicitudesTab';
import { CatalogosTab } from './components/CatalogosTab';
import './styles/AdminPage.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatusPill({ estado }: { estado: string }) {
  const ok = estado === 'activo';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: '0.72rem', fontWeight: 700,
      background: ok ? '#dcfce7' : '#fee2e2',
      color: ok ? '#166534' : '#991b1b',
    }}>{estado}</span>
  );
}

// ─── Modal: Crear usuario ─────────────────────────────────────────────────────
function CreateUserModal({ roles, form, saving, onChange, onClose, onSubmit }: {
  roles: Role[]; form: any; saving: boolean;
  onChange: (f: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  const [showPass, setShowPass] = useState(false);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">👤 Nuevo usuario del sistema</p>
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
            <label>Contraseña * (mín. 8 chars)</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input type={showPass ? 'text' : 'password'} value={form.password}
                placeholder="••••••••" style={{ flex: 1 }}
                onChange={e => onChange({ ...form, password: e.target.value })} />
              <button type="button" className="btn-icon" onClick={() => setShowPass(v => !v)}>
                {showPass ? '🙈' : '👁️'}
              </button>
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
            <label>Rol inicial</label>
            <select value={form.roleId ?? ''} onChange={e => onChange({ ...form, roleId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Sin rol —</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}{r.descripcion ? ` · ${r.descripcion}` : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
            {saving ? '⏳ Guardando…' : '✓ Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Reset password ────────────────────────────────────────────────────
function ResetPasswordModal({ user, saving, onClose, onSubmit }: {
  user: UserRow; saving: boolean; onClose: () => void; onSubmit: (pwd: string) => void;
}) {
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">🔑 Cambiar contraseña</p>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Usuario: <strong>{user.email}</strong>
        </p>
        <div className="form-field">
          <label>Nueva contraseña (mín. 8 caracteres)</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input type={show ? 'text' : 'password'} value={pwd} placeholder="••••••••"
              style={{ flex: 1 }} onChange={e => setPwd(e.target.value)} />
            <button type="button" className="btn-icon" onClick={() => setShow(v => !v)}>
              {show ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving || pwd.length < 8} onClick={() => onSubmit(pwd)}>
            {saving ? '⏳…' : '✓ Actualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Asignar servicio (jefe_servicio) ──────────────────────────────────
function AssignServicioModal({ user, saving, onClose, onSubmit }: {
  user: UserRow; saving: boolean;
  onClose: () => void; onSubmit: (servicioId: number | null) => void;
}) {
  const [servicios, setServicios] = React.useState<any[]>([]);
  const [sel, setSel] = React.useState<number | null>((user as any).servicio_id ?? null);

  React.useEffect(() => {
    apiFetch<any>('/servicios?limit=200&page=1').then(r => setServicios(r?.data || [])).catch(() => {});
  }, []);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">🏥 Asignar Servicio</p>
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: 12 }}>
          <strong>{user.nombre || user.email}</strong> — sólo visible si tiene rol <em>jefe_servicio</em>
        </p>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Servicio</label>
          <select className="input" style={{ width: '100%', marginTop: 4 }}
            value={sel ?? ''} onChange={e => setSel(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Sin servicio —</option>
            {servicios.map((s: any) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSubmit(sel)} disabled={saving}>
            {saving ? '⏳…' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Asignar rol ────────────────────────────────────────────────────────
function AssignRoleModal({ user, roles, saving, onClose, onSubmit }: {
  user: UserRow; roles: Role[]; saving: boolean;
  onClose: () => void; onSubmit: (id: number | null) => void;
}) {
  const [sel, setSel] = useState<number | null>(user.roleId ?? null);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <p className="modal-title">🏷 Asignar rol</p>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Usuario: <strong>{user.email}</strong>
        </p>
        <div className="form-field">
          <label>Rol</label>
          <select value={sel ?? ''} onChange={e => setSel(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Sin rol —</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>
                {r.nombre}{r.descripcion ? ` · ${r.descripcion}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSubmit(sel)} disabled={saving}>
            {saving ? '⏳…' : '✓ Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Permisos de ROL ────────────────────────────────────────────────────
function RolePermissionsModal({ role, allPerms, rolePerms, saving, onToggle, onClose }: {
  role: Role; allPerms: Permission[]; rolePerms: Set<number>;
  saving: boolean; onToggle: (id: number, has: boolean) => void; onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of allPerms) {
      const prefix = p.clave.split(':')[0];
      if (!g[prefix]) g[prefix] = [];
      g[prefix].push(p);
    }
    return g;
  }, [allPerms]);

  const visible = useMemo(() => {
    const out: Record<string, Permission[]> = {};
    for (const [grp, perms] of Object.entries(grouped)) {
      const f = perms.filter(p => {
        const matchText = !filter || p.clave.toLowerCase().includes(filter.toLowerCase()) ||
          (p.descripcion || '').toLowerCase().includes(filter.toLowerCase());
        const matchActive = !onlyActive || rolePerms.has(p.id);
        return matchText && matchActive;
      });
      if (f.length) out[grp] = f;
    }
    return out;
  }, [grouped, filter, onlyActive, rolePerms]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-box-wide">
        <p className="modal-title">🔐 Permisos del rol: <strong>{role.nombre}</strong></p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="admin-search" style={{ flex: 1, minWidth: 200 }}
            placeholder="Filtrar permisos…" value={filter} onChange={e => setFilter(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
            Solo activos
          </label>
          <span style={{
            padding: '2px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)',
            fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap',
          }}>
            {rolePerms.size} / {allPerms.length} activos
          </span>
        </div>

        <div style={{ maxHeight: 440, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Object.entries(visible).map(([grp, perms]) => {
            const activeInGroup = perms.filter(p => rolePerms.has(p.id)).length;
            return (
              <div key={grp}>
                <div style={{
                  fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--border)',
                }}>
                  {grp} ({activeInGroup}/{perms.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 5 }}>
                  {perms.map(p => {
                    const has = rolePerms.has(p.id);
                    return (
                      <label key={p.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                        background: has ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${has ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                        transition: 'all 0.12s',
                      }}>
                        <input type="checkbox" checked={has} disabled={saving}
                          onChange={() => onToggle(p.id, has)} style={{ marginTop: 2 }} />
                        <div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600, color: has ? '#10b981' : 'var(--text)' }}>
                            {p.clave}
                          </div>
                          {p.descripcion && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 1 }}>{p.descripcion}</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!Object.keys(visible).length && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>Sin resultados</div>
          )}
        </div>

        <div className="modal-footer" style={{ marginTop: 12 }}>
          {saving && <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>⏳ Guardando…</span>}
          <button className="btn btn-primary" onClick={onClose}>✓ Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Permisos directos de USUARIO ──────────────────────────────────────
function UserPermissionsModal({ user, allPerms, userPerms, saving, onToggle, onClose }: {
  user: UserRow; allPerms: Permission[]; userPerms: Set<number>;
  saving: boolean; onToggle: (id: number, has: boolean) => void; onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of allPerms) {
      const prefix = p.clave.split(':')[0];
      if (!g[prefix]) g[prefix] = [];
      g[prefix].push(p);
    }
    return g;
  }, [allPerms]);

  const visible = useMemo(() => {
    const out: Record<string, Permission[]> = {};
    for (const [grp, perms] of Object.entries(grouped)) {
      const f = filter ? perms.filter(p =>
        p.clave.toLowerCase().includes(filter.toLowerCase()) ||
        (p.descripcion || '').toLowerCase().includes(filter.toLowerCase())
      ) : perms;
      if (f.length) out[grp] = f;
    }
    return out;
  }, [grouped, filter]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-box-wide">
        <p className="modal-title">🔑 Permisos directos: <strong>{user.email}</strong></p>
        <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: 10 }}>
          Los permisos directos se suman a los que otorga el rol asignado.
        </p>
        <input className="admin-search" style={{ width: '100%', marginBottom: 12 }}
          placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)} />

        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(visible).map(([grp, perms]) => (
            <div key={grp}>
              <div style={{ fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{grp}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 4 }}>
                {perms.map(p => {
                  const has = userPerms.has(p.id);
                  return (
                    <label key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px',
                      borderRadius: 7, cursor: 'pointer',
                      background: has ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${has ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                    }}>
                      <input type="checkbox" checked={has} disabled={saving}
                        onChange={() => onToggle(p.id, has)} />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: has ? '#10b981' : 'var(--text)' }}>
                        {p.clave}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          {saving && <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>⏳ Guardando…</span>}
          <button className="btn btn-primary" onClick={onClose}>✓ Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Roles y permisos ────────────────────────────────────────────────────
function RolesTab({ roles, permissions, onRefresh }: {
  roles: Role[]; permissions: Permission[]; onRefresh: () => void;
}) {
  const toast = { ok: (m: string) => {}, error: (m: string, d?: string) => {} }; // se reemplaza abajo
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePerms, setRolePerms] = useState<Set<number>>(new Set());
  const [roleSaving, setRoleSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const adminHook = useAdminUsers();

  const openRole = useCallback(async (role: Role) => {
    setSelectedRole(role);
    const ids = await adminHook.loadRolePerms(role.id);
    setRolePerms(new Set(ids));
  }, [adminHook]);

  const handleToggle = useCallback(async (permId: number, has: boolean) => {
    setRoleSaving(true);
    setRolePerms(prev => {
      const next = new Set(prev);
      has ? next.delete(permId) : next.add(permId);
      return next;
    });
    try {
      if (selectedRole) await adminHook.saveRolePerms(selectedRole.id, permId, !has);
    } catch {
      // revertir en error
      setRolePerms(prev => {
        const next = new Set(prev);
        has ? next.add(permId) : next.delete(permId);
        return next;
      });
    } finally {
      setRoleSaving(false);
    }
  }, [selectedRole, adminHook]);

  const createRole = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiFetch<any>('/roles', {
        method: 'POST',
        body: JSON.stringify({ nombre: newName.trim(), descripcion: newDesc.trim() || null }),
      });
      setNewName('');
      setNewDesc('');
      onRefresh();
    } catch {}
    finally { setCreating(false); }
  };

  return (
    <div>
      {/* Crear rol */}
      <div style={{
        background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 18px',
        border: '1px solid var(--border)', marginBottom: 16,
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 10 }}>➕ Nuevo rol</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="admin-search" placeholder="Nombre del rol *" style={{ flex: 1, minWidth: 150 }}
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createRole()} />
          <input className="admin-search" placeholder="Descripción (opcional)" style={{ flex: 2, minWidth: 180 }}
            value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          <button className="btn btn-primary" disabled={creating || !newName.trim()} onClick={createRole}>
            {creating ? '⏳…' : 'Crear'}
          </button>
        </div>
      </div>

      {/* Lista de roles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {roles.map(r => (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)',
            flexWrap: 'wrap', gap: 8,
          }}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.nombre}</span>
              {r.descripcion && <span style={{ color: 'var(--muted)', fontSize: '0.82rem', marginLeft: 10 }}>{r.descripcion}</span>}
            </div>
            <button className="btn" onClick={() => openRole(r)}>🔐 Gestionar permisos</button>
          </div>
        ))}
        {!roles.length && (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: '1.5rem' }}>No hay roles creados</div>
        )}
      </div>

      {selectedRole && (
        <RolePermissionsModal
          role={selectedRole}
          allPerms={permissions}
          rolePerms={rolePerms}
          saving={roleSaving}
          onToggle={handleToggle}
          onClose={() => setSelectedRole(null)}
        />
      )}
    </div>
  );
}

// ─── Page principal ───────────────────────────────────────────────────────────
export function AdminPage() {
  const admin = useAdminUsers();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'roles' | 'solicitudes' | 'catalogos'>('users');
  const pending = usePendingRequests(admin.roles);
  const [userPermsModal, setUserPermsModal] = useState<{ user: UserRow; perms: Set<number> } | null>(null);
  const [userPermsSaving, setUserPermsSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? admin.users : admin.users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      (u.nombre || '').toLowerCase().includes(q) ||
      (u.roleName || '').toLowerCase().includes(q)
    );
  }, [admin.users, search]);

  const openUserPerms = useCallback(async (user: UserRow) => {
    const ids = await admin.loadUserPerms(user.id);
    setUserPermsModal({ user, perms: new Set(ids) });
  }, [admin]);

  const handleUserPermToggle = useCallback(async (permId: number, has: boolean) => {
    if (!userPermsModal) return;
    setUserPermsSaving(true);
    setUserPermsModal(m => {
      if (!m) return m;
      const next = new Set(m.perms);
      has ? next.delete(permId) : next.add(permId);
      return { ...m, perms: next };
    });
    try {
      await admin.saveUserPerm(userPermsModal.user.id, permId, !has);
    } catch {
      // revertir
      setUserPermsModal(m => {
        if (!m) return m;
        const next = new Set(m.perms);
        has ? next.add(permId) : next.delete(permId);
        return { ...m, perms: next };
      });
    } finally {
      setUserPermsSaving(false);
    }
  }, [userPermsModal, admin]);

  const pendingCount = pending.requests.filter(r => r.confirmed && !r.approved).length;
  const stats = [
    { label: 'Usuarios', val: admin.users.length, icon: '👥' },
    { label: 'Activos', val: admin.users.filter(u => u.estado === 'activo').length, icon: '✅' },
    { label: 'Sin rol', val: admin.users.filter(u => !u.roleId).length, icon: '⚠️' },
    { label: 'Roles', val: admin.roles.length, icon: '🔐' },
    { label: 'Solicitudes', val: pendingCount, icon: '📬' },
    { label: 'Permisos', val: admin.permissions.length, icon: '🔑' },
  ];

  return (
    <Layout title="Administración" showBack>
      <div className="admin-page">

        {/* Stats */}
        <div className="admin-stats">
          {stats.map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-icon">{s.icon}</div>
              <div className="stat-val">{s.val}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="admin-tabs">
          <button className={`tab-btn${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
            👥 Usuarios
          </button>
          <button className={`tab-btn${tab === 'roles' ? ' active' : ''}`} onClick={() => setTab('roles')}>
            🔐 Roles y permisos
          </button>
          <button className={`tab-btn${tab === 'solicitudes' ? ' active' : ''}`} onClick={() => setTab('solicitudes')}>
            📬 Solicitudes{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
          <button className={`tab-btn${tab === 'catalogos' ? ' active' : ''}`} onClick={() => setTab('catalogos')}>
            🗂️ Catálogos
          </button>
        </div>

        {/* ── TAB USUARIOS ── */}
        {tab === 'users' && (
          <>
            <div className="admin-toolbar">
              <input className="admin-search" style={{ flex: 1 }}
                placeholder="Buscar por nombre, email o rol…"
                value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-primary" onClick={() => admin.setCreateModal(true)}>
                ➕ Nuevo usuario
              </button>
              <button className="btn" onClick={admin.loadUsers} disabled={admin.loading}>
                {admin.loading ? '⏳' : '🔄'} Actualizar
              </button>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Nombre</th><th>Email</th>
                    <th>Estado</th><th>Rol</th><th>Alta</th><th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.82rem' }}>{u.id}</td>
                      <td style={{ fontWeight: 500 }}>{u.nombre || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{u.email}</td>
                      <td><StatusPill estado={u.estado} /></td>
                      <td>
                        {u.roleName
                          ? <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600 }}>{u.roleName}</span>
                          : <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>⚠ Sin rol</span>}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" title="Asignar rol" onClick={() => admin.setRolesModal(u)}>🏷 Rol</button>
                          <button className="btn btn-sm" title="Asignar servicio" onClick={() => admin.setServicioModal(u)}>🏥 Servicio</button>
                          <button className="btn btn-sm" title="Cambiar contraseña" onClick={() => admin.setEditModal(u)}>🔒 Pass</button>
                          <button
                            className={`btn btn-sm${u.estado === 'activo' ? ' btn-warn' : ''}`}
                            onClick={() => admin.toggleEstado(u)}
                            disabled={admin.saving}
                          >
                            {u.estado === 'activo' ? '⏸ Desactivar' : '▶ Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                        {admin.loading ? '⏳ Cargando…' : 'Sin resultados'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── TAB SOLICITUDES ── */}
        {tab === 'solicitudes' && (
          <SolicitudesTab
            requests={pending.requests}
            roles={admin.roles}
            loading={pending.loading}
            saving={pending.saving}
            onRefresh={pending.loadRequests}
            onApprove={pending.approveRequest}
          />
        )}

        {/* ── TAB ROLES ── */}
        {tab === 'roles' && (
          <RolesTab roles={admin.roles} permissions={admin.permissions} onRefresh={admin.loadUsers} />
        )}

        {/* ── TAB CATÁLOGOS ── */}
        {tab === 'catalogos' && <CatalogosTab />}

        {/* ── MODALES ── */}
        {admin.createModal && (
          <CreateUserModal
            roles={admin.roles} form={admin.form} saving={admin.saving}
            onChange={admin.setForm}
            onClose={() => admin.setCreateModal(false)}
            onSubmit={admin.createUser}
          />
        )}
        {admin.editModal && (
          <ResetPasswordModal
            user={admin.editModal} saving={admin.saving}
            onClose={() => admin.setEditModal(null)}
            onSubmit={pwd => admin.resetPassword(admin.editModal!.id, pwd)}
          />
        )}
        {admin.rolesModal && (
          <AssignRoleModal
            user={admin.rolesModal} roles={admin.roles} saving={admin.saving}
            onClose={() => admin.setRolesModal(null)}
            onSubmit={roleId => admin.assignRole(admin.rolesModal!.id, roleId)}
          />
        )}
        {admin.servicioModal && (
          <AssignServicioModal
            user={admin.servicioModal} saving={admin.saving}
            onClose={() => admin.setServicioModal(null)}
            onSubmit={servicioId => admin.assignServicio(admin.servicioModal!.id, servicioId)}
          />
        )}
        {userPermsModal && (
          <UserPermissionsModal
            user={userPermsModal.user}
            allPerms={admin.permissions}
            userPerms={userPermsModal.perms}
            saving={userPermsSaving}
            onToggle={handleUserPermToggle}
            onClose={() => setUserPermsModal(null)}
          />
        )}
      </div>
    </Layout>
  );
}
