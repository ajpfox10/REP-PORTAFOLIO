import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import useGeoStore from '../../store/geoStore';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { fetchProvinces, fetchIncidentTypes } = useGeoStore();

  useEffect(() => {
    fetchProvinces();
    fetchIncidentTypes();
  }, [fetchProvinces, fetchIncidentTypes]);

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <Navbar onMenuClick={() => setSidebarOpen(o => !o)} />
        <main style={{ flex:1, overflowY:'auto', padding:'1.5rem', background:'var(--color-bg)' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
