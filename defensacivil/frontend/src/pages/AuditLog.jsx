import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ScrollText } from 'lucide-react';
import api from '../api/axios';
import { PageHeader, Card, Loading, EmptyState, Pagination } from '../components/common/ui';
import Button from '../components/common/Button';
import { ACTION_LABELS } from '../lib/constants';
import { fmtDateTime } from '../lib/format';

const EMPTY = { action: '', dateFrom: '', dateTo: '', page: 1 };

function Changes({ entry }) {
  const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  const before = parse(entry.old_values) || {};
  const after = parse(entry.new_values) || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => String(before[k]) !== String(after[k]));
  if (!keys.length) return <span className="muted">—</span>;
  return (
    <span style={{ fontSize: 12.5 }}>
      {keys.map(k => <span key={k} style={{ display: 'block' }}><span className="muted">{k}:</span> {before[k] != null && <><s className="muted">{String(before[k])}</s> → </>}{String(after[k] ?? '—')}</span>)}
    </span>
  );
}

export default function AuditLog() {
  const [filters, setFilters] = useState(EMPTY);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setResult(null);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.get('/audit', { params }).then(r => setResult(r.data));
  }, [filters]);

  const set = (key, value) => setFilters(f => ({ ...f, [key]: value, page: key === 'page' ? value : 1 }));

  return (
    <div className="page">
      <PageHeader title="Auditoría" subtitle="Quién hizo qué y cuándo. Los registros no se pueden modificar." />
      <Card bodyClass={null}>
        <div className="toolbar">
          <select className="select" value={filters.action} onChange={e => set('action', e.target.value)} aria-label="Acción">
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" className="input" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)} aria-label="Desde" />
          <input type="date" className="input" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)} aria-label="Hasta" />
          {(filters.action || filters.dateFrom || filters.dateTo) && <Button variant="ghost" size="sm" icon={X} onClick={() => setFilters(EMPTY)}>Limpiar</Button>}
        </div>
        {!result ? <Loading /> : result.data.length === 0 ? <EmptyState icon={ScrollText} title="Sin registros" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Cambios</th><th>IP</th></tr></thead>
                <tbody>
                  {result.data.map(e => (
                    <tr key={e.id}>
                      <td className="nowrap tabular muted">{fmtDateTime(e.created_at)}</td>
                      <td className="nowrap">{e.full_name || e.username || <span className="muted">—</span>}</td>
                      <td>
                        <span className="badge">{ACTION_LABELS[e.action] || e.action}</span>
                        {e.entity_type === 'incidents' && e.entity_id && e.action !== 'DELETE_INCIDENT' && (
                          <div style={{ fontSize: 12, marginTop: 4 }}><Link to={`/incidents/${e.entity_id}`}>Ver incidente</Link></div>
                        )}
                      </td>
                      <td><Changes entry={e} /></td>
                      <td className="mono muted nowrap">{e.ip_address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={result.page} pages={result.pages} total={result.total} noun="registros" onPage={p => set('page', p)} />
          </>
        )}
      </Card>
    </div>
  );
}
