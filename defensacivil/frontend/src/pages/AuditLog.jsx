import { useEffect, useState, useCallback } from 'react';
import api from '../api/axios';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Button from '../components/common/Button';

const ACTIONS = ['LOGIN','LOGOUT','CREATE_INCIDENT','UPDATE_INCIDENT','DELETE_INCIDENT','STATUS_CHANGE','CREATE_USER','UPDATE_USER','RESET_PASSWORD','TOGGLE_USER'];

export default function AuditLog() {
  const [entries,    setEntries]    = useState([]);
  const [pagination, setPagination] = useState({ page:1, pages:1, total:0 });
  const [loading,    setLoading]    = useState(true);
  const [filters,    setFilters]    = useState({ action:'', dateFrom:'', dateTo:'', page:1 });

  const sel = { padding:'0.5rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.8125rem', background:'#fff' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([,v]) => v));
      const { data } = await api.get('/audit', { params });
      setEntries(data.data);
      setPagination({ page: data.page, pages: data.pages, total: data.total });
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: key==='page' ? val : 1 }));

  const ACTION_LABELS = {
    LOGIN:'Inicio sesión', LOGOUT:'Cierre sesión',
    CREATE_INCIDENT:'Crear incidente', UPDATE_INCIDENT:'Actualizar incidente',
    DELETE_INCIDENT:'Eliminar incidente', STATUS_CHANGE:'Cambio estado',
    CREATE_USER:'Crear usuario', UPDATE_USER:'Actualizar usuario',
    RESET_PASSWORD:'Resetear contraseña', TOGGLE_USER:'Cambiar estado usuario',
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Registro de Auditoría</h1>
        <span style={{ fontSize:'0.875rem', color:'#64748b' }}>{pagination.total} registros</span>
      </div>

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'0.75rem 1rem', marginBottom:'1rem', display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'center' }}>
        <select style={sel} value={filters.action} onChange={e => setFilter('action', e.target.value)}>
          <option value="">Todas las acciones</option>
          {ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
        </select>
        <input type="date" style={sel} value={filters.dateFrom} onChange={e => setFilter('dateFrom', e.target.value)} />
        <input type="date" style={sel} value={filters.dateTo}   onChange={e => setFilter('dateTo',   e.target.value)} />
        <Button size="sm" variant="secondary" onClick={() => setFilters({ action:'', dateFrom:'', dateTo:'', page:1 })}>Limpiar</Button>
      </div>

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8125rem' }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Fecha/Hora','Usuario','Acción','Entidad','IP'].map(h => (
                  <th key={h} style={{ padding:'0.75rem 1rem', textAlign:'left', color:'#64748b', fontWeight:500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign:'center', padding:'2rem', color:'#64748b' }}>Cargando...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign:'center', padding:'2rem', color:'#64748b' }}>Sin registros</td></tr>
              ) : entries.map(e => (
                <tr key={e.id} style={{ borderTop:'1px solid var(--color-border)' }}>
                  <td style={{ padding:'0.625rem 1rem', whiteSpace:'nowrap', color:'#64748b' }}>
                    {format(new Date(e.created_at), 'dd/MM/yy HH:mm:ss', { locale:es })}
                  </td>
                  <td style={{ padding:'0.625rem 1rem', fontWeight:500 }}>{e.username || '—'}</td>
                  <td style={{ padding:'0.625rem 1rem' }}>
                    <span style={{ fontSize:'0.75rem', padding:'0.125rem 0.5rem', background:'#f1f5f9', borderRadius:'9999px' }}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td style={{ padding:'0.625rem 1rem', color:'#64748b' }}>
                    {e.entity_type && <span>{e.entity_type} {e.entity_id ? `/ ${e.entity_id.slice(0,8)}...` : ''}</span>}
                  </td>
                  <td style={{ padding:'0.625rem 1rem', color:'#94a3b8', fontFamily:'monospace', fontSize:'0.75rem' }}>{e.ip_address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.pages > 1 && (
          <div style={{ padding:'0.75rem 1rem', borderTop:'1px solid var(--color-border)', display:'flex', alignItems:'center', gap:'0.5rem', justifyContent:'center' }}>
            <Button size="sm" variant="secondary" disabled={pagination.page<=1} onClick={() => setFilter('page', pagination.page-1)}>← Anterior</Button>
            <span style={{ fontSize:'0.875rem', color:'#64748b' }}>Pág {pagination.page}/{pagination.pages}</span>
            <Button size="sm" variant="secondary" disabled={pagination.page>=pagination.pages} onClick={() => setFilter('page', pagination.page+1)}>Siguiente →</Button>
          </div>
        )}
      </div>
    </div>
  );
}
