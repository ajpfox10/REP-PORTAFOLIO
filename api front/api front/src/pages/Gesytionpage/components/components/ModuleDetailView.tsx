// src/pages/GestionPage/components/ModuleDetailView.tsx
import React from 'react';
import type { ModuleKey } from '../hooks/useModules';

interface Props {
  moduleKey: ModuleKey;
  moduleState: any;
  moduleTitle: string;
  moduleCols: string[];
  selectedRow: any;
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
  onPedidoAction?: {
    onOpenPedidoModal: () => void;
    onMarcarPendiente: () => void;
    onMarcarHecho: () => void;
    onBaja: () => void;
    hasRows: boolean;
  };
}

export function ModuleDetailView({
  moduleKey,
  moduleState,
  moduleTitle,
  moduleCols,
  selectedRow,
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
  onPedidoAction
}: Props) {
  return (
    <div className="card gp-card-14 gp-module-stack-card">
      <div className="sep" />

      <div className="row gp-row-between-wrap">
        {onExport()}
        <div className="row gp-row-wrap">
          <div className="badge">{moduleState.loading ? "Cargando…" : `Filas: ${moduleState.rows.length}`}</div>
          {moduleState.scanned && (
            <div className="badge">
              Scan: {moduleState.scanned.pages}/{moduleState.scanned.totalPages} pág (total API {moduleState.scanned.total})
            </div>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="gp-module-body">
        {/* Navegación */}
        <div className="gp-nav">
          <div className="row gp-row-between-center">
            <b>{moduleTitle}</b>
            <span className="badge">Navegación</span>
          </div>

          <div className="gp-nav-list" role="list">
            {moduleState.rows.map((r: any, idx: number) => {
              const isActive = idx === moduleState.selectedIndex;
              const label = moduleKey === "consultas"
                ? `${r?.id ?? idx + 1}. ${String(r?.motivo_consulta ?? "(sin motivo)").slice(0, 48)}`
                : moduleKey === 'documentos'
                  ? `${r?.id ?? idx + 1}. ${String(r?.nombre ?? r?.nombre_archivo_original ?? "(sin nombre)").slice(0, 48)}`
                  : `${r?.id ?? idx + 1}. ${String(r?.estado ?? "(sin estado)").slice(0, 48)}`;
              
              return (
                <button
                  key={`${r?.id ?? idx}`}
                  type="button"
                  className={`gp-nav-item ${isActive ? "is-active" : ""}`}
                  onClick={() => onSetSelectedIndex(idx)}
                >
                  {label}
                </button>
              );
            })}
            
            {!moduleState.rows.length && !moduleState.loading && (
              <div className="muted gp-mt-10">Sin registros para este DNI.</div>
            )}
          </div>
        </div>

        {/* Detalle */}
        <div className="gp-detail">
          <div className="row gp-row-between-center">
            <b>Detalle</b>
            <span className="badge">Fila {moduleState.rows.length ? moduleState.selectedIndex + 1 : 0}</span>
          </div>

          {renderDetailContent(moduleKey, selectedRow, onOpenDoc)}
        </div>
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
            Mostrando {moduleState.rows.length ? `${start + 1}-${Math.min(start + pageSize, moduleState.rows.length)}` : '0'} de {moduleState.rows.length}
          </span>
        </div>
        <div className="row gp-row-wrap">
          <label className="muted gp-pager-label">
            Filas
            <select
              className="input gp-pager-select"
              value={pageSize}
              onChange={(e) => onSetTablePageSize(Number(e.target.value))}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          <button className="btn" type="button" disabled={curPage <= 1} onClick={() => onSetTablePage(curPage - 1)}>
            ◀
          </button>
          <button className="btn" type="button" disabled={curPage >= totalPages} onClick={() => onSetTablePage(curPage + 1)}>
            ▶
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="gp-tablewrap">
        <table className="table">
          <thead>
            <tr>
              {moduleCols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, idxLocal) => {
              const idx = start + idxLocal;
              return (
                <tr key={idx} className={idx === moduleState.selectedIndex ? "gp-row-active" : ""}>
                  {moduleCols.map((c) => (
                    <td
                      key={c}
                      className="cell"
                      title="Click para ampliar"
                      onClick={() => {
                        onSetSelectedIndex(idx);
                        onCellClick(c, String(r?.[c] ?? ""), idx);
                      }}
                      onDoubleClick={() => {
                        if (moduleKey === 'documentos' && c === 'ruta') {
                          onOpenDoc(String(r?.[c] ?? ''), r);
                        }
                      }}
                    >
                      {String(r?.[c] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row gp-row-between-gap10 gp-accordion-foot">
        <div>
          <div className="row gp-row-baseline-gap10">
            <h3 className="gp-h3-0">{moduleTitle}</h3>
            <span className="badge">Exportación</span>
          </div>
          <p className="muted gp-mt-6">
            Tip: click en una celda abre el emergente. Para navegar rápido, usá la lista de la izquierda.
          </p>
        </div>
        {onExport()}
      </div>
    </div>
  );
}

// Helper para renderizar contenido del detalle
function renderDetailContent(moduleKey: ModuleKey, selectedRow: any, onOpenDoc: (route: string, row: any) => void) {
  if (!selectedRow) {
    return <p className="muted gp-mt-10">Seleccioná un registro a la izquierda.</p>;
  }

  switch (moduleKey) {
    case "consultas":
      return (
        <div className="gp-detail-grid">
          <div className="gp-field">
            <div className="gp-field-label">Motivo</div>
            <div className="gp-field-value">{String(selectedRow?.motivo_consulta ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Explicación</div>
            <div className="gp-field-value">{String(selectedRow?.explicacion ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Atendido por</div>
            <div className="gp-field-value">{String(selectedRow?.atendido_por ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Hora atención</div>
            <div className="gp-field-value">{String(selectedRow?.hora_atencion ?? "-")}</div>
          </div>
        </div>
      );

    case "documentos":
      return (
        <div className="gp-detail-grid">
          <div className="gp-field">
            <div className="gp-field-label">Nombre</div>
            <div className="gp-field-value">{String(selectedRow?.nombre ?? selectedRow?.nombre_archivo_original ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Tipo</div>
            <div className="gp-field-value">{String(selectedRow?.tipo ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Número</div>
            <div className="gp-field-value">{String(selectedRow?.numero ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Fecha</div>
            <div className="gp-field-value">{String(selectedRow?.fecha ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Descripción</div>
            <div className="gp-field-value">{String(selectedRow?.descripcion_archivo ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Ruta</div>
            <div className="gp-field-value">
              <div className="row gp-row-wrap">
                <span className="badge" title={String(selectedRow?.ruta ?? '')}>
                  {String(selectedRow?.ruta ?? "-")}
                </span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => onOpenDoc(String(selectedRow?.ruta ?? ''), selectedRow)}
                  disabled={!selectedRow?.ruta}
                >
                  Abrir
                </button>
              </div>
            </div>
          </div>
        </div>
      );

    default: // pedidos
      return (
        <div className="gp-detail-grid">
          <div className="gp-field">
            <div className="gp-field-label">Estado</div>
            <div className="gp-field-value">{String(selectedRow?.estado ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Lugar</div>
            <div className="gp-field-value">{String(selectedRow?.lugar ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Fecha</div>
            <div className="gp-field-value">{String(selectedRow?.fecha ?? "-")}</div>
          </div>
          <div className="gp-field">
            <div className="gp-field-label">Observación</div>
            <div className="gp-field-value">{String(selectedRow?.observacion ?? "-")}</div>
          </div>
        </div>
      );
  }
}