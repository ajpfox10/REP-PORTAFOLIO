import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore   from '../store/geoStore';
import useAuthStore  from '../store/authStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import Button        from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { format }   from 'date-fns';
import { es }       from 'date-fns/locale';

const STATUSES   = ['RECIBIDO','EN_CAMINO','EN_ESCENA','CONTROLADO','CERRADO','CANCELADO'];
const PRIORITIES = ['BAJA','MEDIA','ALTA','CRITICA'];

export default function IncidentList() {
  const navigate         = useNavigate();
  const { incidentTypes, provinces, partidos, fetchProvinces, fetchIncidentTypes, fetchPartidos } = useGeoStore();
  const canWrite         = useAuthStore(s => s.canWrite());
  const isAdmin          = useAuthStore(s => s.isAdmin());

  const [incidents, setIncidents] = useState([]);
  const [pagination, setPagination] = useState({ page:1, pages:1, total:0 });
  const [loading, setLoading]     = useState(true);
  const [toDelete, setToDelete]   = useState(null);
  const [deleting, setDeleting]   = useState(false);

  const [filters, setFilters] = useState({
    status:'', priority:'', incident_type_id:'', province_id:'', partido_id:'',
    dateFrom:'', dateTo:'', search:'', page:1,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([,v]) => v));
      const { data } = await incidentsApi.getAll(params);
      setIncidents(data.data);
      setPagination({ page: data.page, pages: data.pages, total: data.total });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchProvinces(); fetchIncidentTypes(); }, []);
  useEffect(() => {
    if (filters.province_id) fetchPartidos(filters.province_id);
  }, [filters.province_id]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: key === 'page' ? val : 1 }));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await incidentsApi.delete(toDelete);
      setToDelete(null);
      load();
    } finally { setDeleting(false); }
  };

  const sel = { padding:'0.5rem', borderRadius:'var(--radius)', border:'1px solid #d1d5db', fontSize:'0.8125rem', background:'#fff' };
  const inp = { ...sel, minWidth:140 };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Incidentes</h1>
        {canWrite && (
          <Button onClick={() => navigate('/incidents/new')}>➕ Nuevo Incidente</Button>
        )}
      </div>

      {/* Filters */}
      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1rem', marginBottom:'1rem', display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'center' }}>
        <input placeholder="Buscar..." value={filters.search} onChange={e => setFilter('search', e.target.value)} style={{ ...inp, flexGrow:1, minWidth:180 }} />
        <select style={sel} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">Estado</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <select style={sel} value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>
          <option value="">Prioridad</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select style={sel} value={filters.incident_type_id} onChange={e => setFilter('incident_type_id', e.target.value)}>
          <option value="">Tipo</option>
          {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select style={sel} value={filters.province_id} onChange={e => setFilter('province_id', e.target.value)}>
          <option value="">Provincia</option>
          {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {filters.province_id && (
          <select style={sel} value={filters.partido_id} onChange={e => setFilter('partido_id', e.target.value)}>
            <option value="">Partido/Municipio</option>
            {(partidos[filters.province_id] || []).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <input type="date" style={sel} value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} />
        <input type="date" style={sel} value={filters.dateTo}   onChange={e => setFilter('dateTo',   e.target.value)} />
        <Button variant="secondary" size="sm" onClick={() => setFilters({ status:'', priority:'', incident_type_id:'', province_id:'', partido_id:'', dateFrom:'', dateTo:'', search:'', page:1 })}>
          Limpiar
        </Button>
      </div>

      {/* Table */}
      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'hidden' }}>
        <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--color-border)', color:'#64748b', fontSize:'0.875rem' }}>
          {pagination.total} resultado{pagination.total !== 1 ? 's' : ''}
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.875rem' }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Número','Tipo','Título','Estado','Prioridad','Provincia','Fecha','Acciones'].map(h => (
                  <th key={h} style={{ padding:'0.75rem 1rem', textAlign:'left', color:'#64748b', fontWeight:500, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#64748b' }}>Cargando...</td></tr>
              ) : incidents.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#64748b' }}>Sin resultados</td></tr>
              ) : incidents.map(inc => (
                <tr key={inc.uuid} style={{ borderTop:'1px solid var(--color-border)', cursor:'pointer' }}
                  onClick={() => navigate(`/incidents/${inc.uuid}`)}>
                  <td style={{ padding:'0.75rem 1rem', color:'#1d4ed8', fontWeight:600, whiteSpace:'nowrap' }}>{inc.incident_number}</td>
                  <td style={{ padding:'0.75rem 1rem', whiteSpace:'nowrap' }}>{inc.type_name}</td>
                  <td style={{ padding:'0.75rem 1rem', maxWidth:220 }}>
                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inc.title}</div>
                  </td>
                  <td style={{ padding:'0.75rem 1rem' }}><StatusBadge status={inc.status} /></td>
                  <td style={{ padding:'0.75rem 1rem' }}><PriorityBadge priority={inc.priority} /></td>
                  <td style={{ padding:'0.75rem 1rem', color:'#64748b', whiteSpace:'nowrap' }}>{inc.province_name || '-'}</td>
                  <td style={{ padding:'0.75rem 1rem', color:'#64748b', whiteSpace:'nowrap' }}>
                    {format(new Date(inc.started_at), 'dd/MM/yy HH:mm', { locale:es })}
                  </td>
                  <td style={{ padding:'0.75rem 1rem' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display:'flex', gap:'0.375rem' }}>
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/incidents/${inc.uuid}`)}>Ver</Button>
                      {canWrite && <Button size="sm" variant="ghost" onClick={() => navigate(`/incidents/${inc.uuid}/edit`)}>Editar</Button>}
                      {isAdmin && <Button size="sm" variant="danger" onClick={() => setToDelete(inc.uuid)}>Borrar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div style={{ padding:'0.75rem 1rem', borderTop:'1px solid var(--color-border)', display:'flex', alignItems:'center', gap:'0.5rem', justifyContent:'center' }}>
            <Button size="sm" variant="secondary" disabled={pagination.page <= 1} onClick={() => setFilter('page', pagination.page - 1)}>← Anterior</Button>
            <span style={{ fontSize:'0.875rem', color:'#64748b' }}>Página {pagination.page} de {pagination.pages}</span>
            <Button size="sm" variant="secondary" disabled={pagination.page >= pagination.pages} onClick={() => setFilter('page', pagination.page + 1)}>Siguiente →</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete}
        isLoading={deleting} title="Eliminar Incidente"
        message="¿Está seguro que desea eliminar este incidente? Esta acción no se puede deshacer."
      />
    </div>
  );
}
