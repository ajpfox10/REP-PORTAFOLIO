// src/pages/GestionPage/components/components/ModuleDetailView.tsx
import React from 'react';
import type { ModuleKey } from '../../hooks/useModules';

interface Props {
  moduleKey: ModuleKey;
  moduleState: any;
  moduleTitle: string;
  moduleCols: string[];
  selectedRow: any;
  selectedRowIdx: number;
  pageRows: any[];
  start: number;
  curPage: number;
  totalPages: number;
  pageSize: number;
  cleanDni: string;
  onClose: () => void;
  onSetSelectedIndex: (idx: number) => void;
  onSetTablePage: (page: number) => void;
  onSetTablePageSize: (size: number) => void;
  onCellClick: (col: string, value: string, rowIndex: number) => void;
  onOpenDoc: (route: string, row: any) => void;
  onExport: () => React.ReactNode;
  onRowSelect: (idx: number) => void;
  onPedidoAction?: {
    onOpenPedidoModal: () => void;
    onMarcarPendiente: () => void;
    onMarcarHecho: () => void;
    onBaja: () => void;
    onCertificadoIoma: () => void;
    hasRows: boolean;
  };
}

export default function ModuleDetailView({
  moduleKey,
  moduleState,
  moduleTitle,
  moduleCols,
  selectedRow,
  selectedRowIdx,
  pageRows,
  start,
  curPage,
  totalPages,
  pageSize,
  cleanDni,
  onClose,
  onSetSelectedIndex,
  onSetTablePage,
  onSetTablePageSize,
  onCellClick,
  onOpenDoc,
  onExport,
  onRowSelect,
  onPedidoAction
}: Props) {
  const rows = moduleState?.rows ?? moduleState?.data ?? [];
  const loading = moduleState?.loading ?? false;

  return (
    <div className="card gp-card-14 gp-module-stack-card">
      <div className="sep" />

      {/* Botones de exportación */}
      <div className="row gp-row-between-wrap">
        {onExport()}
        <div className="row gp-row-wrap">
          <div className="badge">{loading ? "Cargando…" : `Filas: ${rows.length}`}</div>
          {moduleState?.scanned && (
            <div className="badge">
              Scan: {moduleState.scanned.pages}/{moduleState.scanned.totalPages} pág
            </div>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      {/* 🐉🐉🐉 TABLA SAGRADA - CON ID CORREGIDO 🐉🐉🐉 */}
      <div className="gp-tablewrap">
        <table className="table">
          <thead>
            <tr>
              {moduleCols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row: any, idx: number) => {
              const realIdx = start + idx;
              const isSelected = realIdx === selectedRowIdx;
              
              return (
                <tr 
                  key={realIdx} 
                  className={isSelected ? 'gp-row-active' : ''}
                  onClick={() => {
                    onSetSelectedIndex(realIdx);
                    onRowSelect(realIdx);
                  }}
                >
                  {moduleCols.map((col) => {
                    const value = row?.[col] ?? '';
                    
                    return (
                      <td 
                        key={col}
                        className="cell"
                        onClick={(e) => {
                          e.stopPropagation();
                          
                          // Detectar columna de documento
                          const isDocColumn = 
                            col === 'ruta' || 
                            col === 'route' || 
                            col === 'path' || 
                            col === 'url' ||
                            col.toLowerCase().includes('ruta');
                          
                          if (isDocColumn) {
                            // ✅ LO QUE EL BACKEND QUIERE: EL ID, NO LA RUTA
                            const docId = row?.id ?? row?.documentoId ?? row?.document_id;
                            
                            if (docId) {
                              // ✅ Mandamos el ID numérico
                              onOpenDoc(String(docId), row);
                            } else {
                              // Fallback: mandamos lo que haya en la celda
                              onOpenDoc(String(value), row);
                            }
                          } else {
                            // Columna normal → modal de celda
                            onCellClick(col, String(value), realIdx);
                          }
                        }}
                      >
                        {String(value).substring(0, 120)}
                        {String(value).length > 120 ? '…' : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sep" />

      {/* Detalle de la fila seleccionada */}
      <div className="gp-detail">
        <div className="row gp-row-between-center">
          <b>Detalle</b>
          <span className="badge">Fila {rows.length ? selectedRowIdx + 1 : 0}</span>
        </div>
        {renderDetailContent(moduleKey, selectedRow, onOpenDoc)}
      </div>

      <div className="sep" />

      {/* Acciones de pedidos */}
      {moduleKey === 'pedidos' && onPedidoAction && (
        <div className="row gp-pedidos-actions">
          <div className="row gp-row-wrap">
            <button className="btn" type="button" onClick={onPedidoAction.onOpenPedidoModal}>
              Cargar pedido
            </button>
            <button className="btn" type="button" onClick={onPedidoAction.onMarcarPendiente} disabled={!onPedidoAction.hasRows}>
              Pendiente
            </button>
            <button className="btn" type="button" onClick={onPedidoAction.onMarcarHecho} disabled={!onPedidoAction.hasRows}>
              Hecho
            </button>
            <button className="btn gp-btn-ioma" type="button" onClick={onPedidoAction.onCertificadoIoma}>
              Certificado IOMA
            </button>
          </div>
          <div className="row gp-row-wrap">
            <button className="btn danger" type="button" onClick={onPedidoAction.onBaja} disabled={!onPedidoAction.hasRows}>
              Dar de baja
            </button>
          </div>
        </div>
      )}

      {/* Paginación */}
      <div className="row gp-row-between-wrap gp-table-pager">
        <div className="row gp-row-wrap">
          <span className="badge">Página {curPage}/{totalPages}</span>
          <span className="badge">
            Mostrando {rows.length ? `${start + 1}-${Math.min(start + pageSize, rows.length)}` : '0'} de {rows.length}
          </span>
        </div>

        <div className="row gp-row-wrap">
          <label className="muted gp-pager-label">
            Filas
            <select
              value={pageSize}
              onChange={(e) => onSetTablePageSize(Number(e.target.value))}
              className="gp-select"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          <button 
            className="btn" 
            type="button" 
            onClick={() => onSetTablePage(curPage - 1)} 
            disabled={curPage <= 1}
          >
            ◀
          </button>
          <button 
            className="btn" 
            type="button" 
            onClick={() => onSetTablePage(curPage + 1)} 
            disabled={curPage >= totalPages}
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 🐉 RENDERIZADO DE DETALLE - CORREGIDO CON ID
 */
function renderDetailContent(moduleKey: ModuleKey, selectedRow: any, onOpenDoc: (route: string, row: any) => void) {
  if (!selectedRow) {
    return <div className="muted gp-mt-10">Sin fila seleccionada.</div>;
  }

  // 🎯 VISTA ESPECIAL PARA DOCUMENTOS
  if (moduleKey === "documentos") {
    // ✅ LO QUE EL BACKEND QUIERE: EL ID
    const docId = selectedRow?.id ?? selectedRow?.documentoId ?? selectedRow?.document_id;
    
    return (
      <div className="gp-detail-grid">
        {Object.entries(selectedRow).map(([k, v]) => (
          <div key={k} className="gp-kv">
            <div className="muted gp-k">{k}</div>
            <div className="gp-v">
              {k.toLowerCase().includes('ruta') || 
               k.toLowerCase().includes('route') || 
               k.toLowerCase().includes('path') || 
               k.toLowerCase().includes('url') ? (
                <button 
                  className="btn" 
                  type="button" 
                  onClick={() => onOpenDoc(String(docId ?? v ?? ''), selectedRow)}
                  disabled={!docId && !v}
                >
                  {docId ? `Abrir (ID ${docId})` : 'Abrir'}
                </button>
              ) : (
                <span>{String(v ?? '')}</span>
              )}
            </div>
          </div>
        ))}
        
        {/* Botón principal de abrir documento */}
        {docId && (
          <div className="gp-mt-10">
            <button 
              className="btn primary" 
              type="button" 
              onClick={() => onOpenDoc(String(docId), selectedRow)}
            >
              📄 Abrir documento (ID {docId})
            </button>
          </div>
        )}
      </div>
    );
  }

  // 🎯 VISTA PARA CONSULTAS Y PEDIDOS
  return (
    <div className="gp-detail-grid">
      {Object.entries(selectedRow).map(([k, v]) => (
        <div key={k} className="gp-kv">
          <div className="muted gp-k">{k}</div>
          <div className="gp-v">{String(v ?? '')}</div>
        </div>
      ))}
    </div>
  );
}