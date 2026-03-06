// src/pages/GestionPage/components/modals/PedidoModal.tsx
import React from 'react';

interface Props {
  open: boolean;
  data: any;
  cleanDni: string;
  onChange: (data: any) => void;
  onClose: () => void;
  onSubmit: () => void;
  getActor: () => string;
}

export function PedidoModal({
  open,
  data,
  cleanDni,
  onChange,
  onClose,
  onSubmit,
  getActor
}: Props) {
  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal gp-pedido-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row gp-modal-head">
          <div>
            <div className="muted gp-muted-xs">Pedidos · DNI {cleanDni}</div>
            <h3 className="gp-h3-0">Cargar pedido</h3>
          </div>
          <div className="row gp-row-wrap">
            <button className="btn" type="button" onClick={onClose} disabled={data.saving}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="sep" />

        <div className="gp-pedido-form">
          <div className="row gp-row-between-wrap gp-pedido-form-row">
            <label className="gp-pedido-field">
              <div className="muted">Lugar</div>
              <input
                className="input"
                value={data.lugar}
                onChange={(e) => onChange({ ...data, lugar: e.target.value })}
                placeholder="Ej: RRHH / Mesa de entradas"
              />
            </label>

            <label className="gp-pedido-field">
              <div className="muted">Estado inicial</div>
              <select
                className="input"
                value={data.estado}
                onChange={(e) => onChange({ ...data, estado: e.target.value })}
              >
                <option value="pendiente">Pendiente</option>
                <option value="hecho">Hecho</option>
              </select>
            </label>
          </div>

          <div className="sep" />

          <div className="gp-pedido-types">
            <div className="row gp-row-between-center">
              <b>Tipos de pedido</b>
              <span className="badge">Tildá uno o varios</span>
            </div>

            <div className="gp-pedido-checkgrid">
              {Object.keys(data.tipos).map((k) => (
                <label key={k} className="gp-check">
                  <input
                    type="checkbox"
                    checked={!!data.tipos[k]}
                    onChange={(e) =>
                      onChange({
                        ...data,
                        tipos: { ...data.tipos, [k]: e.target.checked },
                      })
                    }
                  />
                  <span>{k}</span>
                </label>
              ))}
            </div>

            <label className="gp-pedido-custom">
              <div className="muted">Características (opcional)</div>
              <input
                className="input"
                value={data.caracteristicas}
                onChange={(e) => onChange({ ...data, caracteristicas: e.target.value })}
                placeholder="Ej: con sello, con funciones, periodo 2020-2024…"
              />
            </label>

            <label className="gp-pedido-custom">
              <div className="muted">Otro (opcional)</div>
              <input
                className="input"
                value={data.custom}
                onChange={(e) => onChange({ ...data, custom: e.target.value })}
                placeholder="Escribí un tipo personalizado"
              />
            </label>
          </div>

          <div className="row gp-row-between-wrap gp-pedido-actions">
            <div className="muted">
              Se guarda con usuario: <span className="badge">{getActor()}</span>
            </div>
            <div className="row gp-row-wrap">
              <button className="btn" type="button" onClick={onClose} disabled={data.saving}>
                Cancelar
              </button>
              <button className="btn primary" type="button" onClick={onSubmit} disabled={data.saving}>
                {data.saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}