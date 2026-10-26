// src/pages/GestionPage/components/ModuleGrid.tsx
import React from 'react';
import type { ModuleKey } from '../../hooks/useModules';

interface Props {
  modules: Record<ModuleKey, any>;
  cleanDni: string;
  onToggleModule: (key: ModuleKey) => void;
  onOpenPedidoModal: () => void;
  onCloseModule: (key: ModuleKey) => void;
  onOpenCitaciones?: () => void;
  citacionesActivas?: number;
  /** Abre el modal unificado Documentos (tblarchivos) + Expedientes. */
  onOpenDocumentos?: () => void;
  archivosCount?: number;
  expedientesCount?: number;
  /** Solo admin (la consulta exige crud:*:*); sin handler no se muestra la card. */
  onOpenLicenciasMedicas?: () => void;
  licenciasMedicas?: { noOtorgadas: number; debenReclamar: number } | null;
}

export function ModuleGrid({
  modules,
  cleanDni,
  onToggleModule,
  onOpenPedidoModal,
  onCloseModule,
  onOpenCitaciones,
  citacionesActivas = 0,
  onOpenDocumentos,
  archivosCount = 0,
  expedientesCount = 0,
  onOpenLicenciasMedicas,
  licenciasMedicas = null,
}: Props) {
  const debenReclamar = licenciasMedicas?.debenReclamar ?? 0;
  const noOtorgadas = licenciasMedicas?.noOtorgadas ?? 0;
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
          <p className="muted gp-mt-6">Pedidos, estado, lugar y fecha. Cargar, marcar o dar de baja.</p>
          <div className="row gp-row-between-center">
            <div className="row" style={{ gap: 8 }}>
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
              <button
                className="btn"
                type="button"
                onClick={onOpenPedidoModal}
                disabled={modules.pedidos.loading}
              >
                Cargar pedido
              </button>
            </div>
            {modules.pedidos.open && <span className="badge">Activo</span>}
          </div>
        </div>

        {/* CITACIONES */}
        <div className="card gp-card-12" style={{ borderTop: citacionesActivas > 0 ? '2px solid #ef4444' : undefined }}>
          <div className="row gp-row-between-center">
            <b>Citaciones</b>
            {citacionesActivas > 0
              ? <span className="badge" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {citacionesActivas} activa{citacionesActivas > 1 ? 's' : ''}
                </span>
              : <span className="badge">/citaciones</span>
            }
          </div>
          <p className="muted gp-mt-6">Registrar, ver y cerrar citaciones del agente.</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={onOpenCitaciones}
              style={citacionesActivas > 0 ? { borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' } : undefined}
            >
              ⚠️ Citaciones
            </button>
          </div>
        </div>

        {/* DOCUMENTOS + EXPEDIENTES */}
        <div className="card gp-card-12">
          <div className="row gp-row-between-center">
            <b>Documentos y Expedientes</b>
            {archivosCount + expedientesCount > 0
              ? <span className="badge" style={{ background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)' }}>
                  {archivosCount} archivo{archivosCount !== 1 ? 's' : ''} · {expedientesCount} exp.
                </span>
              : <span className="badge">/tblarchivos · /expedientes</span>
            }
          </div>
          <p className="muted gp-mt-6">Documentos, resoluciones y expedientes del agente. Ver, cargar y editar.</p>
          <div className="row gp-row-between-center">
            <button
              className="btn"
              type="button"
              onClick={onOpenDocumentos}
              style={archivosCount + expedientesCount > 0 ? { borderColor: 'rgba(124,58,237,0.4)', color: '#c4b5fd' } : undefined}
            >
              🗂️ Documentos y Expedientes
            </button>
          </div>
        </div>

        {/* LICENCIAS MÉDICAS NO OTORGADAS */}
        {onOpenLicenciasMedicas && (
          <div className="card gp-card-12" style={{ borderTop: debenReclamar > 0 ? '2px solid #ef4444' : undefined }}>
            <div className="row gp-row-between-center">
              <b>Licencias médicas</b>
              {debenReclamar > 0
                ? <span className="badge" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                    {debenReclamar} a reclamar
                  </span>
                : noOtorgadas > 0
                ? <span className="badge" style={{ background: 'rgba(234,179,8,0.18)', color: '#fde68a', border: '1px solid rgba(234,179,8,0.3)' }}>
                    {noOtorgadas} no otorgada{noOtorgadas > 1 ? 's' : ''}
                  </span>
                : <span className="badge">{licenciasMedicas ? 'Sin pendientes' : '—'}</span>
              }
            </div>
            <p className="muted gp-mt-6">No otorgadas del año: reclamos, notas y detalle día por día.</p>
            <div className="row gp-row-between-center">
              <button
                className="btn"
                type="button"
                onClick={onOpenLicenciasMedicas}
                style={debenReclamar > 0 ? { borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' } : undefined}
              >
                🩺 Licencias médicas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
