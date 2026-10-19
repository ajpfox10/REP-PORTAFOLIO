import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, X, SearchX } from 'lucide-react';
import { incidentsApi } from '../api/incidents.api';
import useGeoStore from '../store/geoStore';
import useAuthStore from '../store/authStore';
import { StatusBadge, PriorityBadge } from '../components/common/Badge';
import { PageHeader, Card, EmptyState, Loading, Pagination, Alert } from '../components/common/ui';
import Button from '../components/common/Button';
import { TypeChip } from '../lib/icons';
import { STATUSES, STATUS_LABELS, PRIORITIES, PRIORITY_LABELS } from '../lib/constants';
import { fmtShort, apiError } from '../lib/format';

const FILTER_KEYS = ['search', 'status', 'priority', 'incident_type_id', 'province_id', 'dateFrom', 'dateTo', 'page'];

export default function IncidentList() {
  const navigate = useNavigate();
  const { incidentTypes, provinces } = useGeoStore();
  const role = useAuthStore(s => s.user?.role);
  const canCreate = ['admin', 'medium', 'telefonista'].includes(role);

  // Los filtros viven en la URL: se pueden compartir y sobreviven al volver atrás
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) || '']));
  const [search, setSearch] = useState(filters.search);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const setFilter = useCallback((key, value) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Búsqueda con una pequeña espera para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => { if (search !== filters.search) setFilter('search', search.trim()); }, 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = params.toString();
  useEffect(() => {
    let cancelled = false;
    setError(null);
    incidentsApi.getAll(Object.fromEntries(new URLSearchParams(query)))
      .then(r => { if (!cancelled) setResult(r.data); })
      .catch(err => { if (!cancelled) setError(apiError(err)); });
    return () => { cancelled = true; };
  }, [query]);

  const hasFilters = FILTER_KEYS.some(k => k !== 'page' && filters[k]);

  return (
    <div className="page">
      <PageHeader
        title="Incidentes"
        subtitle={role === 'medium' ? 'Incidentes que registraste' : 'Todos los incidentes registrados'}
        actions={canCreate && <Button icon={Plus} to="/incidents/new">Nuevo incidente</Button>}
      />

      <Card bodyClass={null}>
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} />
            <input className="input" placeholder="Buscar por número, título o dirección" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar" />
          </div>
          <select className="select" value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select className="select" value={filters.priority} onChange={e => setFilter('priority', e.target.value)} aria-label="Prioridad">
            <option value="">Toda prioridad</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
          <select className="select" value={filters.incident_type_id} onChange={e => setFilter('incident_type_id', e.target.value)} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {incidentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" value={filters.province_id} onChange={e => setFilter('province_id', e.target.value)} aria-label="Provincia">
            <option value="">Todas las provincias</option>
            {provinces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" className="input" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={e => setFilter('dateFrom', e.target.value)} aria-label="Desde" />
          <input type="date" className="input" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={e => setFilter('dateTo', e.target.value)} aria-label="Hasta" />
          {hasFilters && <Button variant="ghost" size="sm" icon={X} onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Limpiar</Button>}
        </div>

        {error && <div style={{ padding: '0 16px 16px' }}><Alert type="error">{error}</Alert></div>}
        {!result && !error && <Loading />}
        {result && result.data.length === 0 && (
          <EmptyState icon={SearchX} title="No hay incidentes">{hasFilters ? 'Probá con otros filtros.' : 'Todavía no se registró ningún incidente.'}</EmptyState>
        )}

        {result && result.data.length > 0 && (
          <>
            <div className="table-wrap table-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Incidente</th><th>Tipo</th><th>Prioridad</th><th>Estado</th><th>Ubicación</th><th>Inicio</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map(inc => (
                    <tr key={inc.uuid} className="clickable" onClick={() => navigate(`/incidents/${inc.uuid}`)}>
                      <td className="title-cell">
                        <Link to={`/incidents/${inc.uuid}`} onClick={e => e.stopPropagation()}><strong className="truncate">{inc.title}</strong></Link>
                        <span className="mono">{inc.incident_number}</span>
                      </td>
                      <td className="nowrap"><TypeChip icon={inc.type_icon} color={inc.color_hex} name={inc.type_name} small /></td>
                      <td><PriorityBadge priority={inc.priority} /></td>
                      <td><StatusBadge status={inc.status} /></td>
                      <td className="muted" style={{ maxWidth: 220 }}><div className="truncate">{[inc.partido_name, inc.province_name].filter(Boolean).join(', ') || '—'}</div></td>
                      <td className="nowrap muted tabular">{fmtShort(inc.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-list">
              {result.data.map(inc => (
                <Link key={inc.uuid} to={`/incidents/${inc.uuid}`} className="card-list-item">
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <TypeChip icon={inc.type_icon} color={inc.color_hex} name={inc.type_name} small />
                    <span className="muted tabular" style={{ fontSize: 12 }}>{fmtShort(inc.started_at)}</span>
                  </div>
                  <strong style={{ display: 'block', margin: '8px 0 6px', color: 'var(--text)' }}>{inc.title}</strong>
                  <div className="row"><StatusBadge status={inc.status} /><PriorityBadge priority={inc.priority} /><span className="mono muted" style={{ fontSize: 12 }}>{inc.incident_number}</span></div>
                </Link>
              ))}
            </div>

            <Pagination page={result.page} pages={result.pages} total={result.total} noun={result.total === 1 ? 'incidente' : 'incidentes'} onPage={p => setFilter('page', String(p))} />
          </>
        )}
      </Card>
    </div>
  );
}
