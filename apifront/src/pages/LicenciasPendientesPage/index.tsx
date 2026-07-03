// src/pages/LicenciasPendientesPage/index.tsx
// Página: Licencias Pendientes
// - Muestra días pendientes de licencia por agente (ANUAL, ANUAL COMPLEMENTARIA, etc.)
// - Fuente: Tiempo Acumulado.xls leído por el backend
// - Filtros: servicio, búsqueda por apellido (igual que Gestión)
// - Exporta a Excel
// - Solo visible para crud:*:*

import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel } from '../../utils/export';
import './styles/LicenciasPendientes.css';

const PAGE_SIZE = 50;

interface LicenciaRow {
  apellido_nombre: string;
  tipo_doc: string;
  dni: number;
  legajo: string;
  tipo_licencia: string;
  cant_dias: number;
  pasa: string;
  estructura_servicio: string;
  regimen: string;
  planta: string;
  servicio_id: number | null;
  servicio_nombre: string;
}

export function LicenciasPendientesContent() {
  const toast = useToast();

  // Filtros
  const [filtroDni,      setFiltroDni]      = useState('');
  const [filtroNombre,   setFiltroNombre]   = useState('');
  const [filtroServicio, setFiltroServicio] = useState('');
  const [filtroEstado,   setFiltroEstado]   = useState<'todos'|'con_dias'|'sin_dias'>('todos');

  // Maestros
  const [servicios,        setServicios]        = useState<any[]>([]);
  const [loadingMaestros,  setLoadingMaestros]  = useState(true);

  // Tabla
  const [rows,    setRows]    = useState<LicenciaRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);

  // Búsqueda por nombre (matches)
  const [matches,    setMatches]    = useState<any[]>([]);
  const [loadingNom, setLoadingNom] = useState(false);

  // Export
  const [exporting, setExporting] = useState(false);

  // ── Cargar servicios ───────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<any>('/servicios?limit=500')
      .then(r => setServicios(Array.isArray(r?.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoadingMaestros(false));
  }, []);

  // ── Cargar tabla ──────────────────────────────────────────────────────────
  const cargarTabla = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('page',  String(pageNum));
      if (filtroDni.trim())   params.set('dni',         filtroDni.trim());
      if (filtroServicio)     params.set('servicio_id', filtroServicio);
      if (filtroEstado !== 'todos') params.set('estado', filtroEstado);

      const res = await apiFetch<any>(`/licencias/resumen?${params.toString()}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
      setTotal(res?.meta?.total ?? 0);
      setPage(pageNum);
    } catch (e: any) {
      toast.error('Error al cargar licencias', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [filtroDni, filtroServicio, filtroEstado]);

  useEffect(() => { cargarTabla(1); }, [cargarTabla]);

  // ── Buscar por nombre ─────────────────────────────────────────────────────
  const buscarPorNombre = useCallback(async () => {
    const q = filtroNombre.trim();
    if (!q) return;
    setLoadingNom(true);
    setMatches([]);
    try {
      const res = await searchPersonal(q);
      setMatches(res);
      if (!res.length) toast.error('Sin resultados', `No se encontró "${q}"`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'Error');
    } finally {
      setLoadingNom(false);
    }
  }, [filtroNombre]);

  const seleccionarMatch = useCallback((m: any) => {
    setFiltroDni(String(m.dni));
    setFiltroNombre('');
    setMatches([]);
  }, []);

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportar = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '5000');
      params.set('page',  '1');
      if (filtroDni.trim())   params.set('dni',         filtroDni.trim());
      if (filtroServicio)     params.set('servicio_id', filtroServicio);
      if (filtroEstado !== 'todos') params.set('estado', filtroEstado);

      const res = await apiFetch<any>(`/licencias/resumen?${params.toString()}`);
      const data: LicenciaRow[] = Array.isArray(res?.data) ? res.data : [];

      if (!data.length) { toast.error('Sin datos para exportar'); return; }

      const exportRows = data.map(r => ({
        'Apellido y Nombre': r.apellido_nombre,
        'DNI':               r.dni,
        'Legajo':            r.legajo,
        'Tipo de Licencia':  r.tipo_licencia,
        'Días Pendientes':   r.cant_dias,
        'Pasa':              r.pasa,
        'Servicio':          r.servicio_nombre,
        'Régimen':           r.regimen,
        'Planta':            r.planta,
      }));

      exportToExcel('licencias_pendientes', exportRows);
      toast.ok('Exportado', `${exportRows.length} registros`);
    } catch (e: any) {
      toast.error('Error al exportar', e?.message || 'Error');
    } finally {
      setExporting(false);
    }
  }, [filtroDni, filtroServicio, filtroEstado]);

  const limpiar = () => {
    setFiltroDni('');
    setFiltroNombre('');
    setFiltroServicio('');
    setFiltroEstado('todos');
    setMatches([]);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Para agrupar visualmente: ocultamos DNI/Agente/Servicio en filas consecutivas
  // del mismo agente
  const rowsConGrupo = rows.map((r, i) => ({
    ...r,
    isNewAgent: i === 0 || rows[i - 1].dni !== r.dni,
  }));

  return (
    <>
      <div className="lp-layout">

        {/* ── FILTROS ── */}
        <div className="card lp-filters-card">
          <div className="lp-filters-title">🔍 Filtros</div>
          <div className="lp-filters-grid">

            {/* Búsqueda por apellido */}
            <div className="lp-field">
              <label htmlFor="lp-f-nombre" className="lp-label">Apellido / Nombre</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  id="lp-f-nombre"
                  name="filtroNombre"
                  className="input"
                  value={filtroNombre}
                  onChange={e => setFiltroNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                  placeholder="Buscar por apellido"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  onClick={buscarPorNombre}
                  disabled={loadingNom || !filtroNombre.trim()}
                  type="button"
                >
                  {loadingNom ? '…' : '🔍'}
                </button>
              </div>
            </div>

            {/* DNI */}
            <div className="lp-field">
              <label htmlFor="lp-f-dni" className="lp-label">DNI</label>
              <input
                id="lp-f-dni"
                name="filtroDni"
                className="input"
                value={filtroDni}
                onChange={e => setFiltroDni(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && cargarTabla(1)}
                placeholder="Número de DNI"
              />
            </div>

            {/* Servicio */}
            <div className="lp-field">
              <label htmlFor="lp-f-srv" className="lp-label">Servicio</label>
              <select
                id="lp-f-srv"
                name="filtroServicio"
                className="input"
                value={filtroServicio}
                onChange={e => setFiltroServicio(e.target.value)}
                disabled={loadingMaestros}
              >
                <option value="">Todos los servicios</option>
                {servicios.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nombre || `Servicio #${s.id}`}</option>
                ))}
              </select>
            </div>

            {/* Estado días */}
            <div className="lp-field">
              <div className="lp-label">Días pendientes</div>
              <div className="lp-estado-btns">
                {(['todos', 'con_dias', 'sin_dias'] as const).map(e => (
                  <button
                    key={e}
                    type="button"
                    className={`lp-estado-btn${filtroEstado === e ? ' active' : ''}`}
                    onClick={() => setFiltroEstado(e)}
                  >
                    {e === 'todos' ? '📋 Todos' : e === 'con_dias' ? '🟢 Con días' : '⭕ Sin días'}
                  </button>
                ))}
              </div>
            </div>

            {/* Acciones */}
            <div className="lp-field lp-field-action">
              <button
                className="btn lp-btn-buscar"
                onClick={() => cargarTabla(1)}
                disabled={loading}
                type="button"
              >
                {loading ? '🔄 Buscando…' : '🔍 Buscar'}
              </button>
              <button className="btn" onClick={limpiar} type="button">✕ Limpiar</button>
            </div>
          </div>

          {/* Matches por nombre */}
          {matches.length > 0 && (
            <div className="lp-matches">
              <div className="lp-label lp-mt-8">
                Resultados ({matches.length}) — hacé clic para filtrar:
              </div>
              <div className="lp-matches-list">
                {matches.map((m: any) => (
                  <button
                    key={m.dni}
                    className="lp-match-item"
                    onClick={() => seleccionarMatch(m)}
                    type="button"
                  >
                    <b>{m.apellido}, {m.nombre}</b>
                    <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── TABLA ── */}
        <div className="card lp-table-card">
          <div className="lp-table-header">
            <div className="lp-table-title">
              📋 Licencias
              {!loading && <span className="lp-total-badge">{total} registros</span>}
            </div>
            <div className="lp-table-actions">
              <button
                className="btn lp-btn-export"
                onClick={exportar}
                disabled={exporting || loading || total === 0}
                type="button"
              >
                {exporting ? '⏳ Exportando…' : '📥 Exportar Excel'}
              </button>
              <div className="lp-table-pag">
                <button
                  className="btn"
                  onClick={() => cargarTabla(page - 1)}
                  disabled={page <= 1 || loading}
                  type="button"
                >
                  ‹ Anterior
                </button>
                <span className="lp-pag-info">Pág. {page} / {totalPages}</span>
                <button
                  className="btn"
                  onClick={() => cargarTabla(page + 1)}
                  disabled={page >= totalPages || loading}
                  type="button"
                >
                  Siguiente ›
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="lp-loading">🔄 Cargando licencias…</div>
          ) : rows.length === 0 ? (
            <div className="lp-empty">Sin registros para los filtros seleccionados</div>
          ) : (
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>DNI</th>
                    <th>Legajo</th>
                    <th>Servicio</th>
                    <th>Tipo de Licencia</th>
                    <th>Días Pendientes</th>
                    <th>Pasa</th>
                    <th>Régimen</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsConGrupo.map((row, i) => (
                    <tr
                      key={`${row.dni}-${row.tipo_licencia}-${i}`}
                      className={row.isNewAgent ? 'lp-row-new-agent' : 'lp-row-cont'}
                    >
                      <td style={{ fontWeight: row.isNewAgent ? 600 : 400, color: row.isNewAgent ? '#e2e8f0' : 'transparent' }}>
                        {row.apellido_nombre}
                      </td>
                      <td style={{ color: row.isNewAgent ? '#94a3b8' : 'transparent' }}>
                        {row.dni}
                      </td>
                      <td style={{ color: row.isNewAgent ? '#64748b' : 'transparent' }}>
                        {row.legajo !== '-' ? row.legajo : '—'}
                      </td>
                      <td style={{ color: row.isNewAgent ? '#94a3b8' : 'transparent', fontSize: '0.78rem' }}>
                        {row.servicio_nombre}
                      </td>
                      <td style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
                        {row.tipo_licencia}
                      </td>
                      <td>
                        <span className={row.cant_dias > 0 ? 'lp-dias-ok' : 'lp-dias-cero'}>
                          {row.cant_dias}
                        </span>
                      </td>
                      <td style={{ color: '#64748b', fontSize: '0.78rem' }}>
                        {row.pasa}
                      </td>
                      <td style={{ color: '#64748b', fontSize: '0.78rem' }}>
                        {row.regimen}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && totalPages > 1 && (
            <div className="lp-pag-bottom">
              <button className="btn" onClick={() => cargarTabla(page - 1)} disabled={page <= 1} type="button">
                ‹ Anterior
              </button>
              <span className="lp-pag-info">Pág. {page} / {totalPages}</span>
              <button className="btn" onClick={() => cargarTabla(page + 1)} disabled={page >= totalPages} type="button">
                Siguiente ›
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function LicenciasPendientesPage() {
  return (
    <Layout title="Licencias Pendientes" showBack>
      <LicenciasPendientesContent />
    </Layout>
  );
}
