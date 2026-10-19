import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ListChecks, PlusCircle, Map, Phone, Truck, Waves, Building2, Users, ScrollText,
} from 'lucide-react';
import useAuthStore from '../../store/authStore';
import DefensaCivilLogo from '../common/DefensaCivilLogo';

const ALL = ['admin', 'medium', 'read', 'telefonista', 'chofer'];

const SECTIONS = [
  {
    title: 'Operación',
    links: [
      { to: '/dashboard',     label: 'Tablero',          icon: LayoutDashboard, roles: ALL },
      { to: '/incidents',     label: 'Incidentes',       icon: ListChecks,      roles: ALL, end: true },
      { to: '/incidents/new', label: 'Nuevo incidente',  icon: PlusCircle,      roles: ['admin', 'medium', 'telefonista'] },
      { to: '/mapa',          label: 'Mapa',             icon: Map,             roles: ALL },
      { to: '/inundaciones',  label: 'Inundaciones',     icon: Waves,           roles: ALL },
    ],
  },
  {
    title: 'Puestos',
    links: [
      { to: '/telefonista', label: 'Central telefónica', icon: Phone, roles: ['admin', 'telefonista'] },
      { to: '/chofer',      label: 'Móvil en calle',     icon: Truck, roles: ['admin', 'chofer'] },
    ],
  },
  {
    title: 'Recursos',
    links: [
      { to: '/infraestructura', label: 'Infraestructura', icon: Building2, roles: ALL },
    ],
  },
  {
    title: 'Administración',
    links: [
      { to: '/usuarios',  label: 'Usuarios',  icon: Users,      roles: ['admin'] },
      { to: '/auditoria', label: 'Auditoría', icon: ScrollText, roles: ['admin'] },
    ],
  },
];

export default function Sidebar({ open, onNavigate }) {
  const role = useAuthStore(s => s.user?.role);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Menú principal">
      <div className="sidebar-brand">
        <DefensaCivilLogo size={34} />
        <div>
          <strong>Defensa Civil</strong>
          <span>Gestión de emergencias</span>
        </div>
      </div>
      <nav>
        {SECTIONS.map(section => {
          const links = section.links.filter(l => l.roles.includes(role));
          if (!links.length) return null;
          return (
            <div key={section.title}>
              <div className="nav-section">{section.title}</div>
              {links.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nav-link" onClick={onNavigate}>
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">Sistema de reporte de incidentes</div>
    </aside>
  );
}
