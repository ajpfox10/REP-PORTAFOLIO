import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren, Activity, AlertTriangle, CalendarDays, Users, Home, Plus, ArrowRight } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import useAuthStore from '../store/authStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { PageHeader, Card, EmptyState, Loading, Alert } from '../components/common/ui';
import Button from '../components/common/Button';
import DailyBars from '../components/charts/DailyBars';
import { TypeChip } from '../lib/icons';
import { STATUSES, STATUS_LABELS, ACTIVE_STATUSES } from '../lib/constants';
import { fmtAgo, fmtNumber, apiError } from '../lib/format';

function Stat({ label, value, icon: Icon, foot, tone }) {
  return (
    <div className={`card stat${tone ? ` ${tone}` : ''}`}>
      <div className="stat-top">{label}<span className="stat-icon"><Icon size={17} /></span></div>
      <div className="stat-value">{fmtNumber(value)}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export default function Dashboard() {
  const canCreate = useAuthStore(s => s.hasRole('admin', 'medium', 'telefonista'));
  const [stats, setStats] = useState(null);
  const [active, setActive] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([incidentsApi.getDashboard(), incidentsApi.getMapPoints({})])
      .then(([s, points]) => {
        setStats(s.data);
        setActive(points.data.filter(p => ACTIVE_STATUSES.includes(p.status)));
      })
      .catch(err => setError(apiError(err, 'No se pudo cargar el tablero')));
  }, []);

  if (error) return <div className="page"><Alert type="error">{error}</Alert></div>;
  if (!stats) return <div className="page"><Loading /></div>;

  const statusCounts = Object.fromEntries(stats.byStatus.map(s => [s.status, s.count]));
  const totalStatus = stats.byStatus.reduce((a, s) => a + s.count, 0);
  const maxType = Math.max(1, ...stats.byType.map(t => t.count));
  const last14 = stats.byDay.reduce((a, d) => a + d.count, 0);
  const priorityOrder = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
  const urgent = [...active].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || new Date(b.started_at) - new Date(a.started_at)).slice(0, 7);

  return (
    <div className="page">
      <PageHeader
        title="Tablero"
        subtitle="Situación general de los incidentes"
        actions={canCreate && <Button icon={Plus} to="/incidents/new">Nuevo incidente</Button>}
      />

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat label="Incidentes hoy" value={stats.today} icon={Siren} foot={`${last14} en los últimos 14 días`} />
        <Stat label="Activos" value={stats.open} icon={Activity} foot="Sin cerrar ni cancelar" />
        <Stat label="Críticos activos" value={stats.critical} icon={AlertTriangle} tone={stats.critical ? 'alert-critical' : ''} foot="Prioridad crítica abierta" />
        <Stat label="Este mes" value={stats.month} icon={CalendarDays} />
        <Stat label="Personas afectadas" value={stats.affected} icon={Users} foot="En incidentes activos" />
        <Stat label="Evacuados" value={stats.evacuated} icon={Home} foot="En incidentes activos" />
      </div>

      <div className="grid grid-dash">
        <div className="stack">
          <Card title="Incidentes por día" hint="Últimos 14 días">
            <DailyBars data={stats.byDay} />
          </Card>

          <Card
            title="Activos que requieren atención"
            hint="Ordenados por prioridad"
            bodyClass={null}
            actions={<Link to="/incidents" className="row" style={{ fontSize: 13, gap: 4 }}>Ver todos <ArrowRight size={14} /></Link>}
          >
            {urgent.length === 0 ? (
              <EmptyState title="Sin incidentes activos">No hay emergencias abiertas en este momento.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {urgent.map(p => (
                      <tr key={p.uuid}>
                        <td style={{ width: 40 }}><TypeChip icon={p.type_icon} color={p.color_hex} small /></td>
                        <td className="title-cell">
                          <Link to={`/incidents/${p.uuid}`}><strong>{p.title}</strong></Link>
                          <span>{p.incident_number} · {p.type_name}</span>
                        </td>
                        <td className="nowrap"><PriorityBadge priority={p.priority} /></td>
                        <td className="nowrap"><StatusBadge status={p.status} /></td>
                        <td className="nowrap muted" style={{ fontSize: 12.5 }}>{fmtAgo(p.started_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Por estado" hint={`${totalStatus} incidentes registrados`}>
            <div className="status-strip" role="img" aria-label="Distribución por estado">
              {STATUSES.filter(s => statusCounts[s]).map(s => (
                <span key={s} className={`st-${s}`} style={{ flex: statusCounts[s] }} title={`${STATUS_LABELS[s]}: ${statusCounts[s]}`} />
              ))}
            </div>
            <div className="legend">
              {STATUSES.map(s => (
                <span key={s} className={`st-${s}`}><i />{STATUS_LABELS[s]} <strong className="tabular">{statusCounts[s] || 0}</strong></span>
              ))}
            </div>
          </Card>

          <Card title="Por tipo" hint="Todos los incidentes">
            {stats.byType.length === 0 ? <EmptyState title="Sin datos" /> : stats.byType.map(t => (
              <div className="hbar" key={t.id}>
                <span className="hbar-label"><TypeChip icon={t.icon} color={t.color_hex} small /><span className="truncate">{t.name}</span></span>
                <span className="hbar-value">{t.count}</span>
                <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(t.count / maxType) * 100}%` }} /></div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
