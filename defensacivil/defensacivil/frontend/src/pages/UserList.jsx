import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '../api/users.api';
import { RoleBadge } from '../components/common/Badge';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function UserList() {
  const navigate = useNavigate();
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState(null);

  const load = () => usersApi.getAll().then(r => { setUsers(r.data); setLoading(false); });
  useEffect(() => { load(); }, []);

  const toggle = async (uuid) => {
    setToggling(uuid);
    try { await usersApi.toggleActive(uuid); load(); }
    finally { setToggling(null); }
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Usuarios</h1>
        <Button onClick={() => navigate('/usuarios/nuevo')}>➕ Nuevo Usuario</Button>
      </div>

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
          <thead>
            <tr style={{ background:'#f8fafc' }}>
              {['Usuario','Nombre','Email','Rol','Estado','Último Login','Acciones'].map(h => (
                <th key={h} style={{ padding:'0.75rem 1rem', textAlign:'left', color:'#64748b', fontWeight:500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#64748b' }}>Cargando...</td></tr>
            ) : users.map(u => (
              <tr key={u.uuid} style={{ borderTop:'1px solid var(--color-border)' }}>
                <td style={{ padding:'0.75rem 1rem', fontWeight:600 }}>{u.username}</td>
                <td style={{ padding:'0.75rem 1rem' }}>{u.full_name}</td>
                <td style={{ padding:'0.75rem 1rem', color:'#64748b' }}>{u.email}</td>
                <td style={{ padding:'0.75rem 1rem' }}><RoleBadge role={u.role} /></td>
                <td style={{ padding:'0.75rem 1rem' }}>
                  <span style={{ color: u.is_active ? '#16a34a' : '#dc2626', fontWeight:500, fontSize:'0.8125rem' }}>
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style={{ padding:'0.75rem 1rem', color:'#64748b', fontSize:'0.8125rem' }}>
                  {u.last_login ? format(new Date(u.last_login), 'dd/MM/yy HH:mm', { locale:es }) : 'Nunca'}
                </td>
                <td style={{ padding:'0.75rem 1rem' }}>
                  <div style={{ display:'flex', gap:'0.375rem' }}>
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/usuarios/${u.uuid}/editar`)}>Editar</Button>
                    <Button
                      size="sm"
                      variant={u.is_active ? 'danger' : 'success'}
                      isLoading={toggling === u.uuid}
                      onClick={() => toggle(u.uuid)}
                    >
                      {u.is_active ? 'Desactivar' : 'Activar'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
