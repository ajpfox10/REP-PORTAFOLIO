// src/pages/GestionPage/components/ModuleGrid.tsx
import React from 'react';
import type { ModuleKey } from '../hooks/useModules';

interface Props {
  modules: Record<ModuleKey, any>;
  cleanDni: string;
  onToggleModule: (key: ModuleKey) => void;
  onOpenPedidoModal: () => void;
  onCloseModule: (key: ModuleKey) => void;
}

export function ModuleGrid({
  modules,
  cleanDni,
  onToggleModule,
  onOpenPedidoModal,
  onCloseModule
}: Props) {
  return (
    <div className="card gp-card-14">
      <div className="row gp-row-between-baseline">
        <div>
          <h3 className="gp-h3-top0-bot6">Gestión por DNI</h3>
          <div className="muted">Enter primero. Después habilitamos los módulos, sin humo ni duplicados.</div>
        </div>
        <div className="badge">DNI {cleanDni}</div>
      </div>

      <div className="sep" />

      <div className="grid gp-mod-grid">
        {/* CONSULTAS */}
        <div className="card gp-card-12">
          <div className="row gp-row-between-center">
            <b>Consultas</b>
            <span className="badge">/consultas</span>
          </div>
          <p className="muted gp-mt-6">Atenciones, motivo y explicación.</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={() => modules.consultas.open 
                ? onCloseModule("consultas") 
                : onToggleModule("consultas")
              }
              disabled={modules.consultas.loading}
            >
              {modules.consultas.loading ? "Cargando…" : modules.consultas.open ? "Cerrar" : "Ver"}
            </button>
            {modules.consultas.open && <span className="badge">Activo</span>}
          </div>
        </div>

        {/* PEDIDOS */}
        <div className="card gp-card-12">
          <div className="row gp-row-between-center">
            <b>Pedidos</b>
            <span className="badge">/pedidos</span>
          </div>
          <p className="muted gp-mt-6">Pedidos, estado, lugar y fecha.</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={() => modules.pedidos.open 
                ? onCloseModule("pedidos") 
                : onToggleModule("pedidos")
              }
              disabled={modules.pedidos.loading}
            >
              {modules.pedidos.loading ? "Cargando…" : modules.pedidos.open ? "Cerrar" : "Ver"}
            </button>
            {modules.pedidos.open && <span className="badge">Activo</span>}
          </div>
        </div>

        {/* DOCUMENTOS */}
        <div className="card gp-card-12">
          <div className="row gp-row-between-center">
            <b>Documentos</b>
            <span className="badge">/tblarchivos</span>
          </div>
          <p className="muted gp-mt-6">Documentos, resoluciones y más (por DNI).</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={() => modules.documentos.open 
                ? onCloseModule("documentos") 
                : onToggleModule("documentos")
              }
              disabled={modules.documentos.loading}
            >
              {modules.documentos.loading ? "Cargando…" : modules.documentos.open ? "Cerrar" : "Ver"}
            </button>
            {modules.documentos.open && <span className="badge">Activo</span>}
          </div>
        </div>

        {/* CARGA DE PEDIDOS */}
        <div className="card gp-card-12">
          <div className="row gp-row-between-center">
            <b>Carga</b>
            <span className="badge">Pedidos</span>
          </div>
          <p className="muted gp-mt-6">Cargar, marcar o dar de baja pedidos (por DNI).</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={onOpenPedidoModal}
              disabled={modules.pedidos.loading}
            >
              {modules.pedidos.loading ? 'Cargando…' : 'Cargar pedido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}