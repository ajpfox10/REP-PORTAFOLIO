import { NavLink } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

const ALL_ROLES = ['admin', 'medium', 'read', 'telefonista', 'chofer'];

const LINKS = [
  { to:'/dashboard',   label:'Dashboard',          icon:'📊', roles: ALL_ROLES },
  { to:'/incidents',   label:'Incidentes',          icon:'🚨', roles: ALL_ROLES },
  { to:'/incidents/new', label:'Nuevo Incidente',   icon:'➕', roles:['admin','medium','telefonista'] },
  { to:'/mapa',        label:'Mapa',                icon:'🗺️', roles: ALL_ROLES },
  // ── Páginas específicas por rol ──────────────────────────────────────────
  { to:'/telefonista', label:'Central Telefonista', icon:'📞', roles:['admin','telefonista'] },
  { to:'/chofer',      label:'Panel Chofer',         icon:'🚗', roles:['admin','chofer'] },
  // ── Admin ────────────────────────────────────────────────────────────────
  { to:'/usuarios',    label:'Usuarios',             icon:'👥', roles:['admin'] },
  { to:'/auditoria',   label:'Auditoría',            icon:'📋', roles:['admin'] },
];

export default function Sidebar({ isOpen }) {
  const { user } = useAuthStore();
  const role = user?.role;

  const linkStyle = ({ isActive }) => ({
    display:'flex', alignItems:'center', gap:'0.75rem',
    padding:'0.625rem 1rem', borderRadius:'var(--radius)',
    fontSize:'0.875rem', fontWeight: isActive ? 600 : 400,
    background: isActive ? '#eff6ff' : 'transparent',
    color: isActive ? '#1d4ed8' : '#475569',
    transition:'all 0.15s',
    textDecoration:'none',
  });

  return (
    <aside style={{
      width: isOpen ? 220 : 0,
      background:'#fff', borderRight:'1px solid var(--color-border)',
      display:'flex', flexDirection:'column',
      transition:'width 0.2s', overflow:'hidden', flexShrink:0,
    }}>
      <nav style={{ padding:'0.75rem', flex:1 }}>
        {LINKS
          .filter(l => !l.roles || l.roles.includes(role))
          .map(link => (
            <NavLink key={link.to} to={link.to} style={linkStyle} end={link.to === '/dashboard'}>
              <span>{link.icon}</span>
              <span style={{ whiteSpace:'nowrap' }}>{link.label}</span>
            </NavLink>
          ))
        }
      </nav>
      <div style={{ padding:'0.75rem 1rem', borderTop:'1px solid var(--color-border)', fontSize:'0.7rem', color:'#94a3b8' }}>
        Defensa Civil v1.0
      </div>
    </aside>
  );
}
