// src/pages/GestionPage/index.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../../utils/export';
import { loadSession } from '../../auth/session';

import { useAgenteSearch } from './hooks/useAgenteSearch';
import { useModules, type ModuleKey } from './hooks/useModules';
import { usePedidos } from './hooks/usePedidos';
import { useDocumentos } from './hooks/useDocumentos';
import { useCellModal } from './hooks/useCellModal';
import { useDebounce } from './hooks/useDebounce';

import { AgenteSearchForm } from './components/components/AgenteSearchForm';
import { AgenteInfoCard } from './components/components/AgenteInfoCard';
import { ModuleGrid } from './components/components/ModuleGrid';
import ModuleDetailView from './components/components/ModuleDetailView';
import { MatchesList } from './components/components/MatchesList';
import { FotoCredencialCard } from './components/components/FotoCredencialCard';
import { PedidoModal } from './components/modals/PedidoModal';
import { CellModal } from './components/modals/CellModal';
import { DocViewerModal } from './components/modals/DocViewerModal';
import { GestionDocumentPreview } from './components/components/GestionDocumentPreview';

import './styles/GestionPage.css';

// ─── Panel edición inline ──────────────────────────────────────────────────────
function AgenteEditPanel({ row, onSaved }: { row: any; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { if (row) setForm({ ...row }); }, [row?.dni]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {};
      ['apellido','nombre','cuil','fecha_nacimiento','email','telefono',
       'domicilio','nacionalidad','observaciones'].forEach(k => {
        payload[k] = form[k] ?? null;
      });
      await apiFetch<any>(`/personal/${row.dni}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.ok('Agente actualizado');
      onSaved();
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  return (
    <div className="card gp-card-14" style={{ marginTop: 8 }}>
      <div className="row gp-row-between-center" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: '0.88rem' }}>✏️ Editar datos personales</strong>
        <button className="btn" type="button"
          style={{ padding: '2px 10px', fontSize: '0.8rem' }}
          onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲' : '▼ Más'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {[
          ['APELLIDO','apellido',false],
          ['NOMBRE','nombre',false],
          ['CUIL','cuil',false],
          ['EMAIL','email',false],
        ].map(([lbl, key]) => (
          <div key={key as string}>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 }}>{lbl as string}</div>
            <input className="input" value={form[key as string] || ''}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.84rem' }}
              onChange={e => set(key as string, (key === 'apellido' || key === 'nombre')
                ? e.target.value.toUpperCase() : e.target.value)} />
          </div>
        ))}
        {expanded && (
          <>
            {[['TELÉFONO','telefono'],['NAC.','fecha_nacimiento'],['DOMICILIO','domicilio'],['OBSERV.','observaciones']].map(([lbl, key]) => (
              <div key={key}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 2 }}>{lbl}</div>
                <input className="input" value={form[key] || ''}
                  type={key === 'fecha_nacimiento' ? 'date' : 'text'}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.84rem' }}
                  onChange={e => set(key, e.target.value)} />
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn" type="button" disabled={saving} onClick={save}
          style={{ background: '#2563eb', color: '#fff', borderColor: '#1d4ed8' }}>
          {saving ? '⏳ Guardando…' : '💾 Guardar'}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export function GestionPage() {
  const toast = useToast();
  const { hasPerm } = useAuth();
  // Solo admins con permisos específicos pueden editar agentes
  const canEdit = hasPerm('personal:write') || hasPerm('crud:*:*') || hasPerm('crud:personal:update');

  // Hooks — useAgenteSearch y useModules usan useToast() internamente
  const agenteSearch = useAgenteSearch();
  const debouncedDni = useDebounce(agenteSearch.dni, 500);

  // useModules solo necesita cleanDni (usa useToast internamente)
  const { modules, loadModule, closeModule, setSelectedIndex, setTablePage, setTablePageSize, getSelectedRow } =
    useModules(agenteSearch.cleanDni);

  const pedidos = usePedidos(agenteSearch.cleanDni, modules.pedidos);
  const documentos = useDocumentos(agenteSearch.cleanDni);
  const cellModal = useCellModal(toast);

  const [matches, setMatches] = useState<any[]>([]);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setRow(agenteSearch.row); }, [agenteSearch.row]);
  useEffect(() => { setLoading(agenteSearch.loading); }, [agenteSearch.loading]);

  // Cargar foto cuando hay agente
  useEffect(() => {
    const dni = agenteSearch.cleanDni;
    if (!dni) { documentos.revokeLastObjectUrl?.(); return; }
    documentos.fetchFotoPrivada?.(dni).catch(() => {});
  }, [agenteSearch.cleanDni]);

  // Auto-search por DNI al tipear
  useEffect(() => {
    const d = String(debouncedDni || '');
    if (d && d.replace(/\D/g, '').length >= 7) {
      agenteSearch.onSearch();
    }
  }, [debouncedDni]);

  const onSearch = () => agenteSearch.onSearch();

  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) { toast.error('Ingresá apellido y/o nombre'); return; }
    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
      documentos.revokeLastObjectUrl?.();
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=30&page=1`);
      const lista = res?.data || [];
      setMatches(lista);
      if (!lista.length) toast.error('Sin resultados', `No hay agentes que coincidan con "${q}"`);
      else toast.ok(`${lista.length} resultado(s)`, 'Clic para cargar agente');
    } catch (e: any) {
      toast.error('Error al buscar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  // Al seleccionar desde lista de coincidencias
  const loadByDni = useCallback((dni: string) => {
    const clean = String(dni).replace(/\D/g, '');
    agenteSearch.setDni(clean);
    setMatches([]);
    // Cerrar módulos del agente anterior y recargar
    Object.keys(modules).forEach(k => closeModule(k as ModuleKey));
    setTimeout(() => agenteSearch.onSearch(), 20);
  }, [agenteSearch, modules, closeModule]);

  // Reload agente + módulos abiertos (después de editar)
  const onAgenteEdited = useCallback(() => {
    agenteSearch.onSearch();
    // Recargar todos los módulos que estén abiertos
    const openModules = (Object.keys(modules) as ModuleKey[]).filter(k => modules[k].open);
    openModules.forEach(k => loadModule(k, { forceReload: true }));
  }, [agenteSearch, modules, loadModule]);

  const getModuleTitle = (k: ModuleKey) =>
    k === 'pedidos' ? 'Pedidos' : k === 'documentos' ? 'Documentos' : 'Consultas';

  const getModuleCols = (key: ModuleKey, rows: any[]) => {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const preferred: Record<ModuleKey, string[]> = {
      consultas: ['id','dni','motivo_consulta','explicacion','created_at'],
      pedidos: ['id','dni','pedido','estado','lugar','fecha','observacion','created_at'],
      documentos: ['id','nombre','tipo','numero','fecha','descripcion_archivo','nombre_archivo_original'],
    };
    const pref = preferred[key] || [];
    const out: string[] = [];
    for (const p of pref) if (cols.includes(p)) out.push(p);
    for (const c of cols) if (!out.includes(c) && !['ruta','deleted_at'].includes(c)) out.push(c);
    return out;
  };

  const renderExportActions = (key: ModuleKey) => {
    const st = modules[key];
    const title = `${getModuleTitle(key)} (DNI ${agenteSearch.cleanDni})`;
    const file = `${key}_dni_${agenteSearch.cleanDni}`;
    return (
      <div className="row gp-export-actions">
        <button className="btn" onClick={() => printTable(title, st.rows)} disabled={!st.rows.length}>🖨 Imprimir</button>
        {key === 'pedidos' && (
          <button className="btn" onClick={() => documentos.openCertificadoIoma?.()} disabled={!agenteSearch.cleanDni}>
            Cert. IOMA
          </button>
        )}
        <button className="btn" onClick={() => exportToExcel(`${file}.xlsx`, st.rows)} disabled={!st.rows.length}>Excel</button>
        <button className="btn" onClick={() => exportToPdf(`${file}.pdf`, st.rows)} disabled={!st.rows.length}>PDF</button>
        <button className="btn" onClick={() => exportToWord(`${file}.docx`, st.rows)} disabled={!st.rows.length}>Word</button>
      </div>
    );
  };

  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">

        {/* ── GRID SUPERIOR: izquierda + derecha (foto) ── */}
        <div className="gp-topgrid">

          {/* IZQUIERDA */}
          <div className="gp-col gp-left">
            <AgenteSearchForm
              dni={agenteSearch.dni}
              fullName={agenteSearch.fullName}
              loading={loading}
              onDniChange={e => agenteSearch.setDni(String(e.target.value))}
              onFullNameChange={e => agenteSearch.setFullName(e.target.value)}
              onSearch={onSearch}
              onSearchByName={onSearchByName}
            />

            {loading && <div className="card gp-card-14">🔄 Cargando…</div>}

            {matches.length > 0 && (
              <MatchesList matches={matches} onSelect={loadByDni} />
            )}

            <AgenteInfoCard row={row} />

            {row?.dni && (
              <ModuleGrid
                modules={modules}
                cleanDni={agenteSearch.cleanDni}
                onToggleModule={loadModule}
                onOpenPedidoModal={pedidos.openPedidoModal}
                onCloseModule={closeModule}
              />
            )}
          </div>

          {/* DERECHA: foto + edición — sticky */}
          <div className="gp-col gp-right-panel">
            <FotoCredencialCard
              hasAgente={!!row?.dni}
              fotoUrl={documentos.fotoUrl}
            />
            {canEdit && row?.dni && (
              <AgenteEditPanel row={row} onSaved={onAgenteEdited} />
            )}
          </div>
        </div>

        {/* ── MÓDULOS ABIERTOS ── */}
        <div className="gp-bottomstack">
          {(['consultas', 'pedidos', 'documentos'] as ModuleKey[])
            .filter(k => modules[k].open)
            .map(k => {
              const st = modules[k];
              const moduleCols = getModuleCols(k, st.rows);
              const pageSize = st.tablePageSize || 50;
              const totalPages = Math.max(1, Math.ceil(st.rows.length / pageSize));
              const curPage = Math.min(Math.max(st.tablePage || 1, 1), totalPages);
              const start = (curPage - 1) * pageSize;
              const pageRows = st.rows.slice(start, start + pageSize);

              return (
                <ModuleDetailView
                  key={k}
                  moduleKey={k}
                  moduleState={st}
                  moduleTitle={getModuleTitle(k)}
                  moduleCols={moduleCols}
                  selectedRow={getSelectedRow(k)}
                  selectedRowIdx={st.selectedIndex}
                  pageRows={pageRows}
                  start={start}
                  curPage={curPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  cleanDni={agenteSearch.cleanDni}
                  onClose={() => closeModule(k)}
                  onSetSelectedIndex={idx => setSelectedIndex(k, idx)}
                  onSetTablePage={page => setTablePage(k, page)}
                  onSetTablePageSize={size => setTablePageSize(k, size)}
                  onCellClick={(col, value, rowIndex) => cellModal.openCellModal(k, col, value, rowIndex)}
                  onOpenDoc={(route, row) => documentos.openDocViewer(route, row)}
                  onExport={() => renderExportActions(k)}
                  onRowSelect={idx => setSelectedIndex(k, idx)}
                  onPedidoAction={k === 'pedidos' ? {
                    onOpenPedidoModal: pedidos.openPedidoModal,
                    onIoma: pedidos.generarIomaSelected,
                    onCertificadoIoma: () => documentos.openCertificadoIoma?.(),
                    onMarcarPendiente: () => pedidos.marcarPedidoEstado('pendiente'),
                    onMarcarHecho: () => pedidos.marcarPedidoEstado('hecho'),
                    onBaja: pedidos.bajaPedidoSelected,
                    hasRows: !!st.rows.length
                  } : undefined}
                />
              );
            })}
        </div>
      </div>

      <PedidoModal
        open={pedidos.pedidoModal.open}
        data={pedidos.pedidoModal}
        cleanDni={agenteSearch.cleanDni}
        onChange={pedidos.setPedidoModal}
        onClose={pedidos.closePedidoModal}
        onSubmit={pedidos.createPedidosFromModal}
        getActor={() => {
          const s = loadSession();
          const u: any = s?.user || {};
          return u?.email || u?.id || 'anon';
        }}
      />
      <CellModal open={!!cellModal.cellModal} data={cellModal.cellModal}
        onClose={cellModal.closeCellModal} onCopy={cellModal.copyToClipboard} />
      <DocViewerModal open={documentos.docViewer.open} data={documentos.docViewer}
        onClose={documentos.closeDocViewer} previewComponent={GestionDocumentPreview} />
    </Layout>
  );
}
