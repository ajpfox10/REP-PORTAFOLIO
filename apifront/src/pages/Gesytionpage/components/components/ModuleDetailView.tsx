// src/pages/GestionPage/components/components/ModuleDetailView.tsx
import React, { useRef } from 'react';
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
    onIoma?: () => void;
    onMarcarPendiente: () => void;
    onMarcarHecho: () => void;
    onBaja: () => void;
    onCertificadoIoma: () => void;
    hasRows: boolean;
  };
}

// Columnas que son solo ID/navegación — doble click en estas NO abre doc
const ID_COLS = new Set(['id', 'dni', 'documento_id', 'documentoId', 'document_id']);

export default function ModuleDetailView({
  moduleKey, moduleState, moduleCols,
  selectedRow, selectedRowIdx, pageRows, start,
  curPage, totalPages, pageSize,
  onClose, onSetSelectedIndex, onSetTablePage, onSetTablePageSize,
  onCellClick, onOpenDoc, onExport, onRowSelect, onPedidoAction
}: Props) {
  const rows = moduleState?.rows ?? moduleState?.data ?? [];
  const loading = moduleState?.loading ?? false;
  const isDocumentos = moduleKey === 'documentos';

  // Detectar doble click manualmente
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyRef = useRef<string>('');

  const handleCellClick = (rowIdx: number, row: any, col: string, value: any) => {
    const key = `${rowIdx}-${col}`;
    const isIdCol = ID_COLS.has(col);

    if (lastKeyRef.current === key && clickTimerRef.current) {
      // ── DOBLE CLICK ──
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      lastKeyRef.current = '';

      if (isDocumentos && !isIdCol) {
        // Doble click en col que no es id → abrir documento
        const docId = row?.id ?? row?.documentoId ?? row?.document_id;
        if (docId) onOpenDoc(String(docId), row);
      } else if (!isDocumentos) {
        // Consultas/pedidos → abrir modal de celda para copiar
        onCellClick(col, String(value ?? ''), rowIdx);
      }
    } else {
      // ── PRIMER CLICK → seleccionar fila ──
      onSetSelectedIndex(rowIdx);
      onRowSelect(rowIdx);
      lastKeyRef.current = key;
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        lastKeyRef.current = '';
      }, 320);
    }
  };

  return (
    <div className="card gp-card-14 gp-module-stack-card">
      <div className="sep" />

      {/* Toolbar */}
      <div className="row gp-row-between-wrap">
        {onExport()}
        <div className="row gp-row-wrap">
          <div className="badge">{loading ? 'Cargando…' : `${rows.length} filas`}</div>
          {isDocumentos && selectedRow?.id && (
            <button className="btn" type="button"
              onClick={() => onOpenDoc(String(selectedRow.id), selectedRow)}>
              📄 Abrir seleccionado
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>

      {isDocumentos && (
        <div className="muted" style={{ fontSize: '0.75rem', marginTop: 3, marginBottom: 4 }}>
          💡 Click = seleccionar · Doble click (columna nombre/tipo/etc.) = abrir documento
        </div>
      )}

      {/* Tabla */}
      <div className="gp-tablewrap">
        <table className="table">
          <thead>
            <tr>{moduleCols.map(col => <th key={col}>{col}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map((row: any, idx: number) => {
              const realIdx = start + idx;
              const isSelected = realIdx === selectedRowIdx;
              return (
                <tr key={realIdx} className={isSelected ? 'gp-row-active' : ''}
                  style={{ cursor: 'pointer' }}>
                  {moduleCols.map((col, colIdx) => {
                    const value = row?.[col] ?? '';
                    return (
                      <td key={col} className="cell"
                        onClick={() => handleCellClick(realIdx, row, col, value)}>
                        {String(value).substring(0, 110)}
                        {String(value).length > 110 ? '…' : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!pageRows.length && (
              <tr><td colSpan={moduleCols.length || 1}
                style={{ textAlign: 'center', color: '#aaa', padding: '1.5rem' }}>
                {loading ? 'Cargando…' : 'Sin datos'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sep" />

      {/* Detalle fila seleccionada */}
      <div className="gp-detail">
        <div className="row gp-row-between-center">
          <b>Detalle</b>
          {selectedRow && <span className="badge">Fila {selectedRowIdx + 1}</span>}
        </div>
        <DetailPanel moduleKey={moduleKey} selectedRow={selectedRow} onOpenDoc={onOpenDoc} />
      </div>

      <div className="sep" />

      {/* Acciones pedidos */}
      {moduleKey === 'pedidos' && onPedidoAction && (
        <div className="row gp-pedidos-actions">
          <div className="row gp-row-wrap">
            <button className="btn" type="button" onClick={onPedidoAction.onOpenPedidoModal}>Cargar pedido</button>
            <button className="btn" type="button" onClick={onPedidoAction.onMarcarPendiente} disabled={!onPedidoAction.hasRows}>Pendiente</button>
            <button className="btn" type="button" onClick={onPedidoAction.onMarcarHecho} disabled={!onPedidoAction.hasRows}>Hecho</button>
            <button className="btn gp-btn-ioma" type="button" onClick={onPedidoAction.onCertificadoIoma}>Cert. IOMA</button>
          </div>
          <div className="row gp-row-wrap">
            <button className="btn danger" type="button" onClick={onPedidoAction.onBaja} disabled={!onPedidoAction.hasRows}>Dar de baja</button>
          </div>
        </div>
      )}

      {/* Paginación */}
      <div className="row gp-row-between-wrap gp-table-pager">
        <div className="row gp-row-wrap">
          <span className="badge">Pág. {curPage}/{totalPages}</span>
          <span className="badge">
            {rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} de ${rows.length}` : '0'}
          </span>
        </div>
        <div className="row gp-row-wrap">
          <label className="muted gp-pager-label">Filas
            <select value={pageSize} onChange={e => onSetTablePageSize(Number(e.target.value))} className="gp-select">
              {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn" type="button" onClick={() => onSetTablePage(curPage - 1)} disabled={curPage <= 1}>◀</button>
          <button className="btn" type="button" onClick={() => onSetTablePage(curPage + 1)} disabled={curPage >= totalPages}>▶</button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ moduleKey, selectedRow, onOpenDoc }: {
  moduleKey: ModuleKey; selectedRow: any; onOpenDoc: (r: string, row: any) => void;
}) {
  if (!selectedRow) return (
    <div className="muted gp-mt-10" style={{ fontSize: '0.84rem' }}>
      {moduleKey === 'documentos'
        ? 'Seleccioná una fila · Doble click (columna nombre/tipo) para abrir'
        : 'Seleccioná una fila · Doble click en celda para copiar valor'}
    </div>
  );

  const docId = selectedRow?.id ?? selectedRow?.documentoId;

  return (
    <div className="gp-detail-grid">
      {Object.entries(selectedRow).map(([k, v]) => (
        <div key={k} className="gp-kv">
          <div className="muted gp-k">{k}</div>
          <div className="gp-v">{String(v ?? '')}</div>
        </div>
      ))}
      {moduleKey === 'documentos' && docId && (
        <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <button className="btn" type="button" onClick={() => onOpenDoc(String(docId), selectedRow)}>
            📄 Abrir{selectedRow?.nombre ? ` — ${selectedRow.nombre}` : ` #${docId}`}
          </button>
        </div>
      )}
    </div>
  );
}
