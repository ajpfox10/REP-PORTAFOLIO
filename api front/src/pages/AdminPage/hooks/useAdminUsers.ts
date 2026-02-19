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

  // Form state
  const [form, setForm] = useState<CreateUserPayload>({
    email: '', nombre: '', password: '', estado: 'activo', roleId: null
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Carga usuarios + sus roles en paralelo
      const [usersRes, rolesRes] = await Promise.all([
        apiFetch<any>('/usuarios?limit=200&page=1'),
        apiFetch<any>('/roles?limit=100&page=1'),
      ]);

      const userList: any[] = usersRes?.data || [];
      const roleList: Role[] = (rolesRes?.data || []).map((r: any) => ({
        id: Number(r.id),
        nombre: String(r.nombre || r.name || r.rol || ''),
        descripcion: r.descripcion || '',
      }));

      // Cargar roles de cada usuario via usuarios_roles
      const usersWithRoles: UserRow[] = await Promise.all(
        userList.map(async (u: any) => {
          let roleId = null;
          let roleName = null;
          try {
            const urRes = await apiFetch<any>(`/usuarios_roles?usuario_id=${u.id}&limit=1&page=1`);
            const ur = urRes?.data?.[0];
            if (ur?.rol_id) {
              roleId = Number(ur.rol_id);
              const found = roleList.find(r => r.id === roleId);
              roleName = found?.nombre ?? null;
            }
          } catch {}
          return {
            id: Number(u.id),
            email: String(u.email || ''),
            nombre: u.nombre || null,
            estado: String(u.estado || 'activo'),
            created_at: u.created_at || '',
            roleId,
            roleName,
          };
        })
      );

      setUsers(usersWithRoles);
      setRoles(roleList);
    } catch (e: any) {
      toast.error('Error cargando usuarios', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPermissions = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/permisos?limit=250&page=1');
      setPermissions(
        (res?.data || []).map((p: any) => ({
          id: Number(p.id),
          clave: String(p.clave || ''),
          descripcion: p.descripcion || '',
        }))
      );
    } catch {}
  }, []);

  useEffect(() => {
    loadUsers();
    loadPermissions();
  }, []);

  // Crear usuario
  const createUser = useCallback(async () => {
    if (!form.email || !form.password || !form.nombre) {
      toast.error('Completá todos los campos requeridos');
      return;
    }
    setSaving(true);
    try {
      // 1. Crear usuario
      const createRes = await apiFetch<any>('/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          nombre: form.nombre,
          password: form.password,
          estado: form.estado,
        }),
      });

      const newUserId = createRes?.data?.id ?? createRes?.data?.insertId;
      if (!newUserId) throw new Error('No se recibió ID del usuario creado');

      // 2. Asignar rol si se eligió uno
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

  // Actualizar rol de usuario existente
  const updateUserRole = useCallback(async (userId: number, newRoleId: number | null) => {
    setSaving(true);
    try {
      // Revocar roles anteriores (soft delete)
      await apiFetch<any>(`/usuarios_roles?usuario_id=${userId}&limit=50&page=1`)
        .then(async (res: any) => {
          for (const ur of (res?.data || [])) {
            await apiFetch<any>(`/usuarios_roles/${ur.id}`, { method: 'DELETE' }).catch(() => {});
          }
        }).catch(() => {});

      // Asignar nuevo rol
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

  // Cambiar estado del usuario (activo/inactivo)
  const toggleUserState = useCallback(async (user: UserRow) => {
    const newEstado = user.estado === 'activo' ? 'inactivo' : 'activo';
    setSaving(true);
    try {
      await apiFetch<any>(`/usuarios/${user.id}`, {
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

  // Resetear contraseña
  const resetPassword = useCallback(async (userId: number, newPassword: string) => {
    if (!newPassword || newPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSaving(true);
    try {
      await apiFetch<any>(`/usuarios/${userId}`, {
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
    users,
    roles,
    permissions,
    loading,
    saving,
    createModal,
    editModal,
    rolesModal,
    form,
    setForm,
    setCreateModal,
    setEditModal,
    setRolesModal,
    loadUsers,
    createUser,
    updateUserRole,
    toggleUserState,
    resetPassword,
  };
}
