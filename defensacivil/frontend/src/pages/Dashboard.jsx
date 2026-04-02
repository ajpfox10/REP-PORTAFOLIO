import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { incidentsApi } from '../api/incidents.api';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      background:'#fff', borderRadius:'var(--radius)', padding:'1.25rem',
      boxShadow:'var(--shadow)', borderLeft:`4px solid ${color}`,
      display:'flex', alignItems:'center', gap:'1rem',
    }}>
      <span style={{ fontSize:'2rem' }}>{icon}</span>
      <div>
        <div style={{ fontSize:'2rem', fontWeight:700, color, lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:'0.8rem', color:'#64748b', marginTop:'0.25rem' }}>{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats]       = useState(null);
  const [recent, setRecent]     = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      incidentsApi.getDashboard(),
      incidentsApi.getAll({ limit: 10, page: 1 }),
    ]).then(([s, r]) => {
      setStats(s.data);
      setRecent(r.data.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color:'#64748b' }}>Cargando...</p>;

  return (
    <div>
      <h1 style={{ fontSize:'1.5rem', fontWeight:700, marginBottom:'1.5rem' }}>Dashboard</h1>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:'1rem', marginBottom:'2rem' }}>
        <StatCard label="Incidentes hoy"     value={stats?.today}    icon="🚨" color="#dc2626" />
        <StatCard label="Abiertos"           value={stats?.open}     icon="⚠️" color="#d97706" />
        <StatCard label="Críticos activos"   value={stats?.critical} icon="🔴" color="#7c3aed" />
        <StatCard label="Este mes"           value={stats?.month}    icon="📅" color="#1d4ed8" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'1.5rem' }}>
        {/* Recent incidents */}
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'hidden' }}>
          <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--color-border)', fontWeight:600 }}>
            Últimos Incidentes
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Número', 'Tipo', 'Estado', 'Prioridad', 'Fecha'].map(h => (
                  <th key={h} style={{ padding:'0.625rem 0.875rem', textAlign:'left', color:'#64748b', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map(inc => (
                <tr key={inc.uuid} style={{ borderTop:'1px solid var(--color-border)' }}>
                  <td style={{ padding:'0.625rem 0.875rem' }}>
                    <Link to={`/incidents/${inc.uuid}`} style={{ color:'#1d4ed8', fontWeight:500 }}>
                      {inc.incident_number}
                    </Link>
                  </td>
                  <td style={{ padding:'0.625rem 0.875rem' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:'0.375rem' }}>
                      {inc.type_icon && <span>{inc.type_icon}</span>}
                      {inc.type_name}
                    </span>
                  </td>
                  <td style={{ padding:'0.625rem 0.875rem' }}><StatusBadge status={inc.status} /></td>
                  <td style={{ padding:'0.625rem 0.875rem' }}><PriorityBadge priority={inc.priority} /></td>
                  <td style={{ padding:'0.625rem 0.875rem', color:'#64748b' }}>
                    {format(new Date(inc.started_at), 'dd/MM HH:mm', { locale: es })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'0.75rem 1.25rem', borderTop:'1px solid var(--color-border)' }}>
            <Link to="/incidents" style={{ color:'#1d4ed8', fontSize:'0.875rem' }}>Ver todos →</Link>
          </div>
        </div>

        {/* By type */}
        <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)' }}>
          <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--color-border)', fontWeight:600 }}>
            Por Tipo
          </div>
          <div style={{ padding:'1rem' }}>
            {stats?.byType?.map(t => (
              <div key={t.name} style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.75rem' }}>
                <div style={{
                  width:12, height:12, borderRadius:'50%', background: t.color_hex, flexShrink:0,
                }} />
                <span style={{ flex:1, fontSize:'0.8125rem' }}>{t.name}</span>
                <span style={{ fontWeight:600, color:'#1e293b' }}>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
