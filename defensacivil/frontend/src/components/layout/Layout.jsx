import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import useGeoStore from '../../store/geoStore';

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { fetchProvinces, fetchIncidentTypes } = useGeoStore();
  const location = useLocation();

  useEffect(() => {
    fetchProvinces();
    fetchIncidentTypes();
  }, [fetchProvinces, fetchIncidentTypes]);

  // En el celular el menú se cierra al navegar
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`sidebar-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="main-col">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="main" id="contenido">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
