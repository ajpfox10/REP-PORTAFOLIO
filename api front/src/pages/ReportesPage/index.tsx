// src/pages/ReportesPage/index.tsx
import React, { useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, printTable } from '../../utils/export';

// ─── Tab type ─────────────────────────────────────────────────────────────────
type TabKey = 'cumpleanos' | 'consultas';

// ─── Cumpleaños tab ───────────────────────────────────────────────────────────
function CumpleanosTab() {
  const toast = useToast();
  const [mode, setMode] = useState<'dia' | 'mes' | 'rango'>('dia');
  const [fecha, setFecha] = useState('');
  const [mes, setMes] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Antigüedad 20 años (por MES) ──
  // El negocio pide: "cumplen 20 años en ESE MES" (no en un día exacto)
  // Usamos input type="month" → "YYYY-MM".
  const [mesAntig, setMesAntig] = useState('');
  const [rowsAntig, setRowsAntig] = useState<any[]>([]);
  const [loadingAntig, setLoadingAntig] = useState(false);

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const buscar = useCallback(async () => {
    setLoading(true);
    setRows([]);
    try {
      let params = '';
      if (mode === 'dia' && fecha) {
        const [, m, d] = fecha.split('-');
        // FIX: enviar enteros sin padding (backend espera 1, no "01")
        params = `mes=${parseInt(m, 10)}&dia=${parseInt(d, 10)}`;
      } else if (mode === 'mes' && mes) {
        params = `mes=${mes}`;
      } else if (mode === 'rango' && desde && hasta) {
        params = `desde=${desde}&hasta=${hasta}`;
      } else {
        toast.error('Completá los campos de búsqueda');
        setLoading(false);
        return;
      }
      const res = await apiFetch<any>(`/personal/cumpleanos?${params}`);
      const data = res?.data || [];
      setRows(data);
      if (!data.length) toast.error('Sin resultados', 'No hay agentes que cumplan años en esa fecha');
      else toast.ok(`${data.length} resultado(s)`);
    } catch (e: any) {
      // Fallback: query manual sobre personal
      try {
        let where = '';
        if (mode === 'dia' && fecha) {
          const [, m, d] = fecha.split('-');
          where = `MONTH(fecha_nacimiento)=${Number(m)} AND DAY(fecha_nacimiento)=${Number(d)}`;
        } else if (mode === 'mes' && mes) {
          where = `MONTH(fecha_nacimiento)=${Number(mes)}`;
        }
        const m = mode === 'dia' && fecha ? fecha.split('-')[1] : mes;
        const d = mode === 'dia' && fecha ? fecha.split('-')[2] : '';
        let q = `/personal?limit=500&page=1`;
        if (m) q += `&fecha_nacimiento_month=${parseInt(m, 10)}`;
        if (d) q += `&fecha_nacimiento_day=${parseInt(d, 10)}`;
        const res = await apiFetch<any>(q);
        const data = res?.data || [];
        setRows(data);
        if (!data.length) toast.error('Sin resultados');
        else toast.ok(`${data.length} resultado(s)`);
      } catch {
        toast.error('Error al buscar', e?.message || 'Error');
      }
    } finally {
      setLoading(false);
    }
  }, [mode, fecha, mes, desde, hasta, toast]);

  // Buscar quién cumple 20 años de antigüedad en un MES dado
  const buscarAntigüedad = useCallback(async () => {
    if (!mesAntig) {
      toast.error('Seleccioná un mes');
      return;
    }
    setLoadingAntig(true);
    setRowsAntig([]);
    try {
      const [year, m] = mesAntig.split('-');
      const anioIngreso = Number(year) - 20;
      const mesNum = parseInt(m, 10);

      // Si el backend tuviera endpoint dedicado lo intentamos,
      // pero SIEMPRE hay fallback porque el SQL/back NO se toca.
      const params = `mes=${mesNum}&anio=${anioIngreso}&anios=20`;
      let data: any[] = [];
      try {
        const res = await apiFetch<any>(`/personal/antiguedad?${params}`);
        data = res?.data || [];
      } catch {
        // Fallback: buscar sobre /agentes filtrando fecha_ingreso
        const res = await apiFetch<any>(`/agentes?limit=5000&page=1`);
        const todos = res?.data || [];
        data = todos.filter((a: any) => {
          if (!a.fecha_ingreso) return false;
          const fi = new Date(a.fecha_ingreso);
          return (
            fi.getFullYear() === anioIngreso &&
            fi.getMonth() + 1 === mesNum
          );
        });
      }
      setRowsAntig(data);
      if (!data.length) toast.error('Sin resultados', 'Nadie cumple 20 años de antigüedad ese mes');
      else toast.ok(`${data.length} agente(s) con 20 años de antigüedad en el mes`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error al buscar');
    } finally {
      setLoadingAntig(false);
    }
  }, [mesAntig, toast]);

  const cols = ['dni','apellido','nombre','fecha_nacimiento','email','telefono'];
  const colsAntig = ['dni','apellido','nombre','fecha_ingreso','email','telefono'];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ── Cumpleaños ── */}
      <div className="card">
        <div style={{ marginBottom: 8 }}><strong>🎂 Cumpleaños</strong></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Modo</div>
            <select className="input" value={mode} onChange={e => setMode(e.target.value as any)}
              style={{ minWidth: 140 }}>
              <option value="dia">Día exacto</option>
              <option value="mes">Mes completo</option>
              <option value="rango">Rango de fechas</option>
            </select>
          </div>

          {mode === 'dia' && (
            <div>
              <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Fecha (día/mes)</div>
              <input className="input" type="date" value={fecha}
                onChange={e => setFecha(e.target.value)} />
            </div>
          )}

          {mode === 'mes' && (
            <div>
              <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Mes</div>
              <select className="input" value={mes} onChange={e => setMes(e.target.value)}
                style={{ minWidth: 160 }}>
                <option value="">— Seleccionar —</option>
                {/* FIX: sin padStart — backend espera 1, no "01" */}
                {MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
              </select>
            </div>
          )}

          {mode === 'rango' && (
            <>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Desde</div>
                <input className="input" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Hasta</div>
                <input className="input" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
              </div>
            </>
          )}

          <button className="btn" style={{ background: '#2563eb', color: '#fff', height: 36 }}
            disabled={loading} onClick={buscar}>
            {loading ? '⏳ Buscando…' : '🔍 Buscar'}
          </button>

          {rows.length > 0 && (
            <>
              <button className="btn" onClick={() => printTable('Cumpleaños', rows)}>🖨 Imprimir</button>
              <button className="btn" onClick={() => exportToExcel('cumpleanos.xlsx', rows)}>📊 Excel</button>
            </>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div style={{ marginBottom: 8 }}>
            <strong>{rows.length}</strong> agente(s) cumplen años
            {mode === 'dia' && fecha ? ` el ${fecha.split('-').reverse().join('/')}` : ''}
            {mode === 'mes' && mes ? ` en ${MESES[Number(mes)-1]}` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  {cols.map(c => <th key={c} style={{ padding: '6px 10px', textAlign: 'left' }}>{c.toUpperCase()}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    {cols.map(c => (
                      <td key={c} style={{ padding: '5px 10px', fontSize: '0.82rem' }}>
                        {c === 'fecha_nacimiento' && r[c]
                          ? new Date(r[c]).toLocaleDateString('es-AR')
                          : String(r[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Antigüedad 20 años ── */}
      <div className="card">
        <div style={{ marginBottom: 8 }}><strong>🏅 Antigüedad — 20 años en ese mes</strong></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Mes / Año</div>
            <input className="input" type="month" value={mesAntig}
              onChange={e => setMesAntig(e.target.value)} />
          </div>
          <button className="btn" style={{ background: '#7c3aed', color: '#fff', height: 36 }}
            disabled={loadingAntig} onClick={buscarAntigüedad}>
            {loadingAntig ? '⏳ Buscando…' : '🔍 Buscar antigüedad'}
          </button>
          {rowsAntig.length > 0 && (
            <>
              <button className="btn" onClick={() => printTable('Antigüedad 20 años', rowsAntig)}>🖨 Imprimir</button>
              <button className="btn" onClick={() => exportToExcel('antiguedad_20.xlsx', rowsAntig)}>📊 Excel</button>
            </>
          )}
        </div>
      </div>

      {rowsAntig.length > 0 && (
        <div className="card">
          <div style={{ marginBottom: 8 }}>
            <strong>{rowsAntig.length}</strong> agente(s) cumplen 20 años de antigüedad
            {mesAntig ? ` en ${MESES[Number(mesAntig.split('-')[1]) - 1]} ${mesAntig.split('-')[0]}` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
              <thead>
                <tr>
                  {colsAntig.map(c => <th key={c} style={{ padding: '6px 10px', textAlign: 'left' }}>{c.toUpperCase()}</th>)}
                </tr>
              </thead>
              <tbody>
                {rowsAntig.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    {colsAntig.map(c => (
                      <td key={c} style={{ padding: '5px 10px', fontSize: '0.82rem' }}>
                        {c === 'fecha_ingreso' && r[c]
                          ? new Date(r[c]).toLocaleDateString('es-AR')
                          : String(r[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Consultas dinámicas tab ───────────────────────────────────────────────────
// Importante: el BACK/SQL NO se tocan.
// Por eso el Front se alinea a lo que el backend EXPONE con GET /tables.
// - No inventamos nombres (plural inventado ❌). Usamos exactamente el nombre del backend.
// - Si una tabla no está en /tables, NO aparece en el selector.
// - Columnas: se intentan inferir consultando 1 fila. Si no hay filas, se deja editable.

// Tablas frecuentes (solo aparecen si existen en /tables)
const PRESET_TABLES: Array<{ key: string; label: string; cols?: string[] }> = [
  { key: 'personal', label: 'Personal (datos personales)', cols: ['dni','apellido','nombre','fecha_nacimiento','cuil','email','telefono','domicilio','localidad_id','observaciones','created_at'] },
  { key: 'agentes', label: 'Agentes (datos laborales)', cols: ['id','dni','estado_empleo','fecha_ingreso','fecha_baja','ley_id','planta_id','categoria_id','ocupacion_id','regimen_horario_id','jefatura_id','sector_id','salario_mensual'] },
  { key: 'agentes_servicios', label: 'Agentes - Servicios / Dependencias', cols: ['id','dni','dependencia_id','servicio_nombre','jefe_nombre','fecha_desde','fecha_hasta','motivo','observaciones'] },
  // FIX: en el back la tabla es "sexo" (no plural incorrecto).
  { key: 'sexo', label: 'Sexo (catálogo)', cols: ['id','nombre'] },
  { key: 'agentexdni1', label: 'Vista completa agente (agentexdni1)' },
  { key: 'agentehistorial', label: 'Historial de agentes' },
  { key: 'consultas', label: 'Consultas' },
  { key: 'pedidos', label: 'Pedidos' },
];
type FilterOp = 'contains' | 'eq' | 'starts' | 'notempty';
interface Filter { col: string; op: FilterOp; val: string; }

function ConsultasTab() {
  const toast = useToast();
  const [tableKey, setTableKey] = useState('personal');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(200);

  // Tablas permitidas por el backend (source of truth)
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  // Columnas inferidas por tabla (consulta 1 fila)
  const [inferredCols, setInferredCols] = useState<Record<string, string[]>>({});

  // Cargar tablas desde GET /tables
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingTables(true);
      try {
        const res = await apiFetch<any>('/tables');
        const list: string[] = (res?.data || []).slice().sort();
        if (!mounted) return;
        setAvailableTables(list);

        // Si la tabla actual no existe, caer a la primera disponible
        if (list.length && !list.includes(tableKey)) {
          setTableKey(list.includes('personal') ? 'personal' : list[0]);
        }
      } catch (e: any) {
        toast.error('Error', e?.message || 'No se pudieron obtener las tablas');
      } finally {
        if (mounted) setLoadingTables(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Construir defs: presets que existan + resto de tablas del back
  const presetKeys = new Set(PRESET_TABLES.map(t => t.key));
  const presetDefs = PRESET_TABLES.filter(t => availableTables.includes(t.key));
  const otherDefs = availableTables
    .filter(t => !presetKeys.has(t))
    .map(t => ({ key: t, label: t }));

  const tableDefs = [...presetDefs, ...otherDefs];

  const tableDef = tableDefs.find(t => t.key === tableKey) || tableDefs[0] || { key: tableKey, label: tableKey };
  const allCols =
    inferredCols[tableKey] ||
    (tableDef as any).cols ||
    (rows[0] ? Object.keys(rows[0]) : []);
  const visCols = selectedCols.length ? selectedCols : allCols;

  const toggleCol = (col: string) => {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  // Inferir columnas (si no hay preset y todavía no inferimos)
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!tableKey) return;
      if (!availableTables.includes(tableKey)) return;
      if (inferredCols[tableKey]) return;
      // Si hay preset con cols, no hace falta inferir
      const preset = PRESET_TABLES.find(t => t.key === tableKey);
      if ((preset as any)?.cols?.length) return;

      try {
        const res = await apiFetch<any>(`/${tableKey}?limit=1&page=1`);
        const first = (res?.data && Array.isArray(res.data) && res.data[0]) ? res.data[0] : null;
        if (!first) return;
        const cols = Object.keys(first);
        if (mounted && cols.length) {
          setInferredCols(prev => ({ ...prev, [tableKey]: cols }));
        }
      } catch {
        // Si falla, no pasa nada: el usuario puede escribir filtros/cols manualmente
      }
    })();
    return () => { mounted = false; };
  }, [tableKey, availableTables, inferredCols]);

  const addFilter = () => setFilters(prev => [...prev, { col: (allCols[0] || ''), op: 'contains', val: '' }]);
  const removeFilter = (i: number) => setFilters(prev => prev.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, field: keyof Filter, val: string) => {
    setFilters(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };

  const buscar = useCallback(async () => {
    setLoading(true);
    setRows([]);
    try {
      // Build query params
      const params: string[] = [`limit=${limit}`, 'page=1'];
      
      for (const f of filters) {
        if (!f.col || !f.val.trim() && f.op !== 'notempty') continue;
        if (f.op === 'contains') params.push(`${f.col}_contains=${encodeURIComponent(f.val)}`);
        else if (f.op === 'eq') params.push(`${f.col}=${encodeURIComponent(f.val)}`);
        else if (f.op === 'starts') params.push(`${f.col}_starts=${encodeURIComponent(f.val)}`);
        else if (f.op === 'notempty') params.push(`${f.col}_notempty=1`);
      }

      const res = await apiFetch<any>(`/${tableKey}?${params.join('&')}`);
      const data = res?.data || [];
      setRows(data);
      if (!data.length) toast.error('Sin resultados');
      else toast.ok(`${data.length} resultado(s)`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error al consultar');
    } finally {
      setLoading(false);
    }
  }, [tableKey, filters, limit, toast]);

  const exportRows = () => {
    const exportData = rows.map(r => {
      const obj: any = {};
      visCols.forEach(c => { obj[c] = r[c] ?? ''; });
      return obj;
    });
    exportToExcel(`consulta_${tableKey}.xlsx`, exportData);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Selección de tabla */}
      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 250px' }}>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Tabla / Vista</div>
            <select className="input" value={tableKey}
              onChange={e => { setTableKey(e.target.value); setSelectedCols([]); setFilters([]); setRows([]); }}>
              {loadingTables && <option value="">Cargando tablas...</option>}
              {!loadingTables && tableDefs.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Límite</div>
            <select className="input" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              {[50,100,200,500,1000].map(n => <option key={n} value={n}>{n} filas</option>)}
            </select>
          </div>
        </div>

        {/* Columnas visibles */}
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 6 }}>
            Columnas a mostrar (todas = {allCols.length})
            <button className="btn" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '1px 8px' }}
              onClick={() => setSelectedCols([])}>Reset</button>
          </div>
          {allCols.length === 0 && (
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 6 }}>
              No se pudieron inferir columnas (tabla vacía o sin permiso). Podés igual filtrar escribiendo el nombre de columna.
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allCols.map(col => (
              <label key={col} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                background: visCols.includes(col) ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '2px 8px', fontSize: '0.76rem' }}>
                <input type="checkbox" checked={visCols.includes(col)} onChange={() => toggleCol(col)}
                  style={{ width: 12, height: 12 }} />
                {col}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.88rem' }}>🔍 Filtros</strong>
          <button className="btn" onClick={addFilter} style={{ fontSize: '0.78rem' }}>+ Agregar filtro</button>
        </div>
        {filters.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {allCols.length ? (
              <select className="input" value={f.col} onChange={e => updateFilter(i, 'col', e.target.value)}
                style={{ minWidth: 140, fontSize: '0.82rem' }}>
                {allCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input className="input" value={f.col} onChange={e => updateFilter(i, 'col', e.target.value)}
                placeholder="columna" style={{ minWidth: 140, fontSize: '0.82rem' }} />
            )}
            <select className="input" value={f.op} onChange={e => updateFilter(i, 'op', e.target.value)}
              style={{ minWidth: 130, fontSize: '0.82rem' }}>
              <option value="contains">contiene</option>
              <option value="eq">igual a</option>
              <option value="starts">empieza con</option>
              <option value="notempty">no vacío</option>
            </select>
            {f.op !== 'notempty' && (
              <input className="input" value={f.val} onChange={e => updateFilter(i, 'val', e.target.value)}
                placeholder="valor…" style={{ minWidth: 140, fontSize: '0.82rem' }} />
            )}
            <button className="btn" onClick={() => removeFilter(i)} title="Eliminar filtro"
              style={{ color: '#f87171', fontSize: '0.8rem', padding: '2px 8px' }}>✕</button>
          </div>
        ))}
        {!filters.length && <div className="muted" style={{ fontSize: '0.8rem' }}>Sin filtros — muestra todos los registros</div>}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" style={{ background: '#2563eb', color: '#fff' }}
          disabled={loading} onClick={buscar}>
          {loading ? '⏳ Consultando…' : '▶ Ejecutar consulta'}
        </button>
        {rows.length > 0 && (
          <>
            <button className="btn" onClick={() => printTable(`Consulta ${tableKey}`, rows)}>🖨 Imprimir</button>
            <button className="btn" onClick={exportRows}>📊 Excel</button>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
              {rows.length} registro(s)
            </span>
          </>
        )}
      </div>

      {/* Resultados */}
      {rows.length > 0 && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {visCols.map(c => (
                    <th key={c} style={{ padding: '6px 10px', textAlign: 'left', whiteSpace: 'nowrap',
                      borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: '0.72rem', color: '#94a3b8' }}>
                      {c.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {visCols.map(c => (
                      <td key={c} style={{ padding: '4px 10px', maxWidth: 300, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={String(r[c] ?? '')}>
                        {r[c] == null ? <span className="muted">—</span> : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ReportesPage() {
  const [tab, setTab] = useState<TabKey>('cumpleanos');

  return (
    <Layout title="Reportes" showBack>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button
          className={`btn${tab === 'cumpleanos' ? ' active' : ''}`}
          onClick={() => setTab('cumpleanos')}
        >
          🎂 Cumpleaños
        </button>
        <button
          className={`btn${tab === 'consultas' ? ' active' : ''}`}
          onClick={() => setTab('consultas')}
        >
          📊 Consultas dinámicas
        </button>
      </div>

      {tab === 'cumpleanos' && <CumpleanosTab />}
      {tab === 'consultas' && <ConsultasTab />}
    </Layout>
  );
}
