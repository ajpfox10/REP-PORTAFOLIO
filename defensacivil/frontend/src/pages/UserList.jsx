import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Search, UserX, UserCheck } from 'lucide-react';
import { usersApi } from '../api/users.api';
import useAuthStore from '../store/authStore';
import { RoleBadge } from '../components/common/Badge';
import { PageHeader, Card, Loading, EmptyState } from '../components/common/ui';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { ROLES, ROLE_LABELS } from '../lib/constants';
import { fmtAgo, initials, apiError } from '../lib/format';

export default function UserList() {
  const me = useAuthStore(s => s.user);
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [toggle, setToggle] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => usersApi.getAll().then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users || []).filter(u => (!role || u.role === role) && (!q || [u.username, u.full_name, u.email].some(f => f.toLowerCase().includes(q))));
  }, [users, search, role]);

  const confirmToggle = async () => {
    setBusy(true);
    try {
      await usersApi.toggleActive(toggle.uuid);
      toast.success(toggle.is_active ? `${toggle.full_name} fue desactivado` : `${toggle.full_name} fue activado`);
      setToggle(null);
      load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Usuarios" subtitle="Personal con acceso al sistema y su rol." actions={<Button icon={Plus} to="/usuarios/nuevo">Nuevo usuario</Button>} />
      <Card bodyClass={null}>
        <div className="toolbar">
          <div className="input-group"><Search size={16} /><input className="input" placeholder="Buscar por nombre, usuario o email" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar" /></div>
          <select className="select" value={role} onChange={e => setRole(e.target.value)} aria-label="Rol">
            <option value="">Todos los roles</option>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        {!users ? <Loading /> : shown.length === 0 ? <EmptyState title="Sin resultados" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th /></tr></thead>
              <tbody>
                {shown.map(u => (
                  <tr key={u.uuid} style={{ opacity: u.is_active ? 1 : 0.6 }}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                        <span className="avatar">{initials(u.full_name)}</span>
                        <div className="title-cell" style={{ minWidth: 0 }}>
                          <strong>{u.full_name}{u.uuid === me?.uuid && <span className="muted" style={{ fontWeight: 400 }}> (vos)</span>}</strong>
                          <span>{u.username} · {u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td><RoleBadge role={u.role} /></td>
                    <td><span className={`badge ${u.is_active ? 'st-CERRADO' : 'st-CANCELADO'}`}><span className="dot" />{u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="muted nowrap">{u.last_login ? fmtAgo(u.last_login) : 'Nunca'}</td>
                    <td className="nowrap" style={{ textAlign: 'right' }}>
                      <Button variant="ghost" size="sm" icon={Pencil} to={`/usuarios/${u.uuid}/editar`}>Editar</Button>
                      {u.uuid !== me?.uuid && (
                        <Button variant="ghost" size="sm" icon={u.is_active ? UserX : UserCheck} onClick={() => setToggle(u)}>{u.is_active ? 'Desactivar' : 'Activar'}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!toggle}
        onClose={() => setToggle(null)}
        onConfirm={confirmToggle}
        isLoading={busy}
        danger={!!toggle?.is_active}
        title={toggle?.is_active ? 'Desactivar usuario' : 'Activar usuario'}
        confirmLabel={toggle?.is_active ? 'Desactivar' : 'Activar'}
        message={toggle?.is_active
          ? `${toggle?.full_name} pierde el acceso de inmediato y se cierran sus sesiones abiertas.`
          : `${toggle?.full_name} va a poder volver a ingresar.`}
      />
    </div>
  );
}
