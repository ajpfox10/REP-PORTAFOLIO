// src/pages/AdminPage/hooks/useAdminUsers.ts
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';

export type Role = { id: number; nombre: string; descripcion?: string };
export type Permission = { id: number; clave: string; descripcion?: string };
export type UserRow = {
  id: number;
  email: string;
  nombre: string | null;
  estado: string;
  created_at: string;
  roleId?: number | null;
  roleName?: string | null;
};

export type CreateUserPayload = {
  email: string;
  nombre: string;
  password: string;
  estado: 'activo' | 'inactivo';
  roleId: number | null;
};

export function useAdminUsers() {
  const toast = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<UserRow | null>(null);
  const [rolesModal, setRolesModal] = useState<UserRow | null>(null);
  const [servicioModal, setServicioModal] = useState<UserRow | null>(null);

  // Form state
  const [form, setForm] = useState<CreateUserPayload>({
    email: '', nombre: '', password: '', estado: 'activo', roleId: null
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, permsRes] = await Promise.all([
        apiFetch<any>('/usuarios?limit=200&page=1'),
        apiFetch<any>('/roles?limit=100&page=1'),
        apiFetch<any>('/permisos?limit=500&page=1'),
      ]);

      const userList: any[] = usersRes?.data || [];
      const roleList: Role[] = (rolesRes?.data || []).map((r: any) => ({
        id: Number(r.id),
        nombre: String(r.nombre || r.name || r.rol || ''),
        descripcion: r.descripcion || '',
      }));

      setRoles(roleList);
      setPermissions((permsRes?.data || []).map((p: any) => ({
        id: Number(p.id),
        clave: String(p.clave || ''),
        descripcion: p.descripcion || '',
      })));

      // rol_id ya viene en la respuesta de GET /usuarios (MIN(ur.rol_id))
      const usersWithRoles: UserRow[] = userList.map((u: any) => {
        const roleId = u.rol_id ? Number(u.rol_id) : null;
        return {
          id: Number(u.id),
          email: String(u.email || ''),
          nombre: u.nombre || null,
          estado: String(u.estado || 'activo'),
          created_at: u.created_at || '',
          roleId,
          roleName: roleId ? (roleList.find(r => r.id === roleId)?.nombre ?? null) : null,
        };
      });

      setUsers(usersWithRoles);
    } catch (e: any) {
      toast.error('Error cargando datos', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, []);

  // ─── Permisos de un ROL ──────────────────────────────────────────────────────
  const loadRolePerms = useCallback(async (roleId: number): Promise<number[]> => {
    try {
      const res = await apiFetch<any>(`/roles_permisos?rol_id=${roleId}&limit=500&page=1`);
      return (res?.data || []).map((rp: any) => Number(rp.permiso_id));
    } catch {
      return [];
    }
  }, []);

  const saveRolePerms = useCallback(async (roleId: number, permId: number, grant: boolean) => {
    if (grant) {
      // Agregar permiso al rol
      await apiFetch<any>('/roles_permisos', {
        method: 'POST',
        body: JSON.stringify({ rol_id: roleId, permiso_id: permId }),
      });
    } else {
      // Quitar permiso del rol — buscar el registro y borrarlo
      const res = await apiFetch<any>(`/roles_permisos?rol_id=${roleId}&permiso_id=${permId}&limit=1&page=1`);
      const rp = res?.data?.[0];
      if (rp?.id) {
        await apiFetch<any>(`/roles_permisos/${rp.id}`, { method: 'DELETE' });
      }
    }
  }, []);

  // ─── Permisos DIRECTOS de un USUARIO ────────────────────────────────────────
  const loadUserPerms = useCallback(async (userId: number): Promise<number[]> => {
    try {
      // La tabla puede llamarse usuarios_permisos
      const res = await apiFetch<any>(`/usuarios_permisos?usuario_id=${userId}&limit=500&page=1`);
      return (res?.data || []).map((up: any) => Number(up.permiso_id));
    } catch {
      return [];
    }
  }, []);

  const saveUserPerm = useCallback(async (userId: number, permId: number, grant: boolean) => {
    if (grant) {
      await apiFetch<any>('/usuarios_permisos', {
        method: 'POST',
        body: JSON.stringify({ usuario_id: userId, permiso_id: permId }),
      });
    } else {
      const res = await apiFetch<any>(`/usuarios_permisos?usuario_id=${userId}&permiso_id=${permId}&limit=1&page=1`);
      const up = res?.data?.[0];
      if (up?.id) {
        await apiFetch<any>(`/usuarios_permisos/${up.id}`, { method: 'DELETE' });
      }
    }
  }, []);

  // ─── Crear usuario ───────────────────────────────────────────────────────────
  const createUser = useCallback(async () => {
    if (!form.email || !form.password || !form.nombre) {
      toast.error('Completá todos los campos requeridos');
      return;
    }
    setSaving(true);
    try {
      const createRes = await apiFetch<any>('/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email, nombre: form.nombre,
          password: form.password, estado: form.estado,
        }),
      });

      const newUserId = createRes?.data?.id ?? createRes?.data?.insertId;
      if (!newUserId) throw new Error('No se recibió ID del usuario creado');

      if (form.roleId) {
        await apiFetch<any>('/usuarios_roles', {
          method: 'POST',
          body: JSON.stringify({ usuario_id: Number(newUserId), rol_id: Number(form.roleId) }),
        });
      }

      toast.ok('Usuario creado', form.email);
      setCreateModal(false);
      setForm({ email: '', nombre: '', password: '', estado: 'activo', roleId: null });
      await loadUsers();
    } catch (e: any) {
      toast.error('Error creando usuario', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [form, toast, loadUsers]);

  // ─── Asignar rol ─────────────────────────────────────────────────────────────
  const assignRole = useCallback(async (userId: number, newRoleId: number | null) => {
    setSaving(true);
    try {
      // Revocar roles anteriores
      const existing = await apiFetch<any>(`/usuarios_roles?usuario_id=${userId}&limit=50&page=1`);
      for (const ur of (existing?.data || [])) {
        await apiFetch<any>(`/usuarios_roles/${ur.id}`, { method: 'DELETE' }).catch(() => {});
      }
      if (newRoleId) {
        await apiFetch<any>('/usuarios_roles', {
          method: 'POST',
          body: JSON.stringify({ usuario_id: userId, rol_id: newRoleId }),
        });
      }
      toast.ok('Rol actualizado');
      setRolesModal(null);
      await loadUsers();
    } catch (e: any) {
      toast.error('Error actualizando rol', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [toast, loadUsers]);

  // ─── Asignar servicio (para jefe_servicio) ───────────────────────────────────
  const assignServicio = useCallback(async (userId: number, servicioId: number | null) => {
    setSaving(true);
    try {
      await apiFetch<any>(`/usuarios/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ servicio_id: servicioId }),
      });
      toast.ok('Servicio asignado');
      setServicioModal(null);
      await loadUsers();
    } catch (e: any) {
      toast.error('Error asignando servicio', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [toast, loadUsers]);

  // ─── Toggle estado ───────────────────────────────────────────────────────────
  const toggleEstado = useCallback(async (user: UserRow) => {
    const newEstado = user.estado === 'activo' ? 'inactivo' : 'activo';
    setSaving(true);
    try {
      await apiFetch<any>(`/usuarios/${user.id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: newEstado }),
      });
      toast.ok(`Usuario ${newEstado}`, user.email);
      await loadUsers();
    } catch (e: any) {
      toast.error('Error actualizando estado', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [toast, loadUsers]);

  // ─── Reset password ──────────────────────────────────────────────────────────
  const resetPassword = useCallback(async (userId: number, newPassword: string) => {
    if (!newPassword || newPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSaving(true);
    try {
      await apiFetch<any>(`/usuarios/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword }),
      });
      toast.ok('Contraseña actualizada');
      setEditModal(null);
    } catch (e: any) {
      toast.error('Error al resetear contraseña', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [toast]);

  return {
    users, roles, permissions,
    loading, saving,
    createModal, editModal, rolesModal, servicioModal, form,
    setForm, setCreateModal, setEditModal, setRolesModal, setServicioModal,
    loadUsers, createUser, assignRole, assignServicio, toggleEstado, resetPassword,
    loadRolePerms, saveRolePerms,
    loadUserPerms, saveUserPerm,
    toast,
  };
}
