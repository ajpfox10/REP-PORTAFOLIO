// src/pages/GestionPage/components/modals/CellModal.tsx
import React from 'react';

interface Props {
  open: boolean;
  data: any;
  onClose: () => void;
  onCopy: () => void;
}

export function CellModal({ open, data, onClose, onCopy }: Props) {
  if (!open || !data) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row gp-modal-head">
          <div>
            <div className="muted gp-muted-xs">Fila {data.rowIndex + 1}</div>
            <h3 className="gp-h3-0">{data.col}</h3>
          </div>
          <button className="btn" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="sep" />

        <textarea className="textarea" readOnly value={data.value} />

        <div className="row gp-modal-actions">
          <button className="btn" type="button" onClick={onCopy}>
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}