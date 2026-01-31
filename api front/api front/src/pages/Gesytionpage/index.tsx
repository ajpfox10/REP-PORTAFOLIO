// src/pages/GestionPage/index.tsx
import React, { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../../utils/export';
import { trackAction } from '../../logging/track';
import { loadSession } from '../../auth/session';

// Hooks específicos
import { useAgenteSearch } from './hooks/useAgenteSearch';
import { useModules, type ModuleKey } from './hooks/useModules';
import { usePedidos } from './hooks/usePedidos';
import { useDocumentos } from './hooks/useDocumentos';
import { useCellModal } from './hooks/useCellModal';
import { useDebounce } from './hooks/useDebounce';

// Componentes
// Nota: en esta feature la carpeta quedó como /components/components
import { AgenteSearchForm } from './components/components/AgenteSearchForm';
import { AgenteInfoCard } from './components/components/AgenteInfoCard';
import { ModuleGrid } from './components/components/ModuleGrid';
import { ModuleDetailView } from './components/components/ModuleDetailView';
import { MatchesList } from './components/components/MatchesList';
import { FotoCredencialCard } from './components/components/FotoCredencialCard';
import { PedidoModal } from './components/modals/PedidoModal';
import { CellModal } from './components/modals/CellModal';
import { DocViewerModal } from './components/modals/DocViewerModal';
import { GestionDocumentPreview } from './components/GestionDocumentPreview';

import './styles/GestionPage.css';

export function GestionPage() {
  const toast = useToast();
  
  // Hooks
  const agenteSearch = useAgenteSearch(toast);
  const debouncedDni = useDebounce(agenteSearch.dni, 500);
  const { modules, loadModule, closeModule, setSelectedIndex, setTablePage, setTablePageSize, getSelectedRow } = 
    useModules(agenteSearch.cleanDni, toast);
  const pedidos = usePedidos(agenteSearch.cleanDni, modules.pedidos, toast, () => 
    loadModule('pedidos', { forceReload: true }));
  const documentos = useDocumentos(agenteSearch.cleanDni, toast);
  const cellModal = useCellModal(toast);
  
  // Estado para compatibilidad
  const [matches, setMatches] = useState<any[]>([]);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // Sincronización
  useEffect(() => { setRow(agenteSearch.row); }, [agenteSearch.row]);
  useEffect(() => { setLoading(agenteSearch.loading); }, [agenteSearch.loading]);
  
  useEffect(() => {
    if (debouncedDni && debouncedDni.replace(/\D/g, "").length >= 7) {
      agenteSearch.onSearch();
    }
  }, [debouncedDni]);
  
  // Funciones de compatibilidad
  const onSearch = () => agenteSearch.onSearch();
  
  const onSearchByName = async () => {
    const q = agenteSearch.fullName.trim();
    if (!q) {
      toast.error("Búsqueda inválida", "Ingresá apellido y/o nombre");
      return;
    }
  
    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      Object.keys(modules).forEach(key => closeModule(key as ModuleKey));
      documentos.revokeLastObjectUrl();
      
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=20&page=1`);
      setMatches(res.data || []);
      toast.ok("Búsqueda lista");
    } catch (e: any) {
      toast.error("No se pudo buscar", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  };
  
  const loadByDni = (dni: string) => {
    agenteSearch.setDni(dni);
    setTimeout(() => agenteSearch.onSearch(), 10);
  };
  
  const getActor = () => {
    const s = loadSession();
    const u: any = s?.user || {};
    return u?.username || u?.user || u?.name || u?.email || u?.id || 'anon';
  };
  
  // Helpers
  const getModuleTitle = (key: ModuleKey) => {
    if (key === 'pedidos') return 'Pedidos';
    if (key === 'documentos') return 'Documentos';
    return 'Consultas';
  };
  
  const getModuleCols = (key: ModuleKey, rows: any[]) => {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const preferred: Record<ModuleKey, string[]> = {
      consultas: ["id", "dni", "motivo_consulta", "explicacion"],
      pedidos: ["id", "dni"],
      documentos: ["id", "dni", "ruta", "nombre", "numero", "tipo", "tamano", "fecha", "descripcion_archivo", "nombre_archivo_original"],
    };
    const pref = preferred[key] || [];
    const out: string[] = [];
    for (const p of pref) if (cols.includes(p)) out.push(p);
    for (const c of cols) if (!out.includes(c)) out.push(c);
    return out;
  };
  
  const renderExportActions = (key: ModuleKey) => {
    const st = modules[key];
    const title = `${getModuleTitle(key)} (DNI ${agenteSearch.cleanDni})`;
    const file = `${key}_dni_${agenteSearch.cleanDni}`;
    
    return (
      <div className="row gp-export-actions">
        <button className="btn" onClick={() => printTable(title, st.rows)} disabled={!st.rows.length}>Imprimir</button>
        <button className="btn" onClick={() => exportToExcel(`${file}.xlsx`, st.rows)} disabled={!st.rows.length}>Excel</button>
        <button className="btn" onClick={() => exportToPdf(title, st.rows)} disabled={!st.rows.length}>PDF</button>
        <button className="btn" onClick={() => exportToWord(title, st.rows)} disabled={!st.rows.length}>Word</button>
      </div>
    );
  };
  
  // Render
  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">
        <div className="gp-topgrid">
          {/* Izquierda */}
          <div className="gp-col gp-left">
            <AgenteSearchForm
              dni={agenteSearch.dni}
              fullName={agenteSearch.fullName}
              loading={loading}
              onDniChange={(e) => agenteSearch.setDni(e.target.value)}
              onFullNameChange={(e) => agenteSearch.setFullName(e.target.value)}
              onSearch={onSearch}
              onSearchByName={onSearchByName}
            />
            
            {loading && <div className="card gp-card-14">Cargando…</div>}
            
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
            
            <MatchesList matches={matches} onSelect={loadByDni} />
          </div>
          
          {/* Derecha */}
          <div className="gp-col gp-right-panel">
            <FotoCredencialCard hasAgente={!!row?.dni} fotoUrl={documentos.fotoUrl} />
          </div>
        </div>
        
        {/* Stack de módulos */}
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
                  pageRows={pageRows}
                  start={start}
                  curPage={curPage}
                  totalPages={totalPages}
                  pageSize={pageSize}
                  cleanDni={agenteSearch.cleanDni}
                  onClose={() => closeModule(k)}
                  onSetSelectedIndex={(idx) => setSelectedIndex(k, idx)}
                  onSetTablePage={(page) => setTablePage(k, page)}
                  onSetTablePageSize={(size) => setTablePageSize(k, size)}
                  onCellClick={(col, value, rowIndex) => cellModal.openCellModal(k, col, value, rowIndex)}
                  onOpenDoc={(route, row) => documentos.openDocViewer(route, row)}
                  onExport={() => renderExportActions(k)}
                  onPedidoAction={k === 'pedidos' ? {
                    onOpenPedidoModal: pedidos.openPedidoModal,
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
      
      {/* Modales */}
      <PedidoModal
        open={pedidos.pedidoModal.open}
        data={pedidos.pedidoModal}
        cleanDni={agenteSearch.cleanDni}
        onChange={pedidos.setPedidoModal}
        onClose={pedidos.closePedidoModal}
        onSubmit={pedidos.createPedidosFromModal}
        getActor={getActor}
      />
      
      <CellModal
        open={!!cellModal.cellModal}
        data={cellModal.cellModal}
        onClose={cellModal.closeCellModal}
        onCopy={cellModal.copyToClipboard}
      />
      
      <DocViewerModal
        open={documentos.docViewer.open}
        data={documentos.docViewer}
        onClose={documentos.closeDocViewer}
        previewComponent={GestionDocumentPreview}
      />
    </Layout>
  );
}