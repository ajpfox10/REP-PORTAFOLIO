// src/pages/TableViewPage/components/CellModal.tsx
import React from 'react';
import { useToast } from '../../../ui/toast';
import { CellModalState } from '../types';

interface CellModalProps {
  modalState: CellModalState;
  onClose: () => void;
}

export function CellModal({ modalState, onClose }: CellModalProps) {
  const toast = useToast();

  if (!modalState) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(modalState.value);
      toast.success('Copiado', 'Se copió el contenido al portapapeles');
    } catch {
      toast.error('No se pudo copiar', 'El navegador no permitió copiar.');
    }
  };

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row tv-modal-head">
          <div>
            <div className="muted tv-muted-xs">Fila {modalState.rowIndex + 1}</div>
            <h3 className="tv-modal-title">{modalState.col}</h3>
          </div>
          <button className="btn" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="sep" />

        <textarea className="textarea" readOnly value={modalState.value} />

        <div className="row tv-modal-actions">
          <button className="btn" type="button" onClick={handleCopy}>
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}