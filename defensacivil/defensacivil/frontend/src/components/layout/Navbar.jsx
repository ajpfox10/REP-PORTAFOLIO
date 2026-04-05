import useAuthStore from '../../store/authStore';
import { RoleBadge } from '../common/Badge';
import DefensaCivilLogo from '../common/DefensaCivilLogo';

export default function Navbar({ onMenuClick }) {
  const { user, logout } = useAuthStore();

  return (
    <header style={{
      height:56, background:'#1d4ed8', color:'#fff',
      display:'flex', alignItems:'center', padding:'0 1rem',
      gap:'1rem', flexShrink:0, boxShadow:'0 2px 4px rgba(0,0,0,0.15)',
    }}>
      <button
        onClick={onMenuClick}
        style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', fontSize:'1.25rem', padding:'0.25rem' }}
        title="Menú"
      >
        ☰
      </button>

      <div style={{ display:'flex', alignItems:'center', gap:'0.625rem', flex:1 }}>
        <DefensaCivilLogo size={34} />
        <div>
          <div style={{ fontWeight:700, fontSize:'0.9rem', lineHeight:1.2 }}>Defensa Civil Argentina</div>
          <div style={{ fontSize:'0.7rem', opacity:0.75, lineHeight:1 }}>Sistema de Reporte de Incidentes</div>
        </div>
      </div>

      {user && (
        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
          <RoleBadge role={user.role} />
          <span style={{ fontSize:'0.875rem', opacity:0.9 }}>{user.full_name}</span>
          <button
            onClick={logout}
            style={{
              background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
              color:'#fff', borderRadius:'var(--radius)', cursor:'pointer',
              padding:'0.25rem 0.75rem', fontSize:'0.8125rem', fontWeight:500,
            }}
          >
            Salir
          </button>
        </div>
      )}
    </header>
  );
}
