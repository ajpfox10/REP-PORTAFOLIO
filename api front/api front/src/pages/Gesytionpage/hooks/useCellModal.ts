// hooks/useCellModal.ts
import { useState } from 'react';
import { useToast } from '../../../ui/toast';

export function useCellModal() {
  const toast = useToast();
  const [cellModal, setCellModal] = useState<{
    module: string;
    col: string;
    value: string;
    rowIndex: number;
  } | null>(null);

  const openCellModal = (
    module: string, 
    col: string, 
    value: any, 
    rowIndex: number
  ) => {
    setCellModal({ 
      module, 
      col, 
      value: String(value ?? ''), 
      rowIndex 
    });
  };

  const closeCellModal = () => {
    setCellModal(null);
  };

  const copyToClipboard = async () => {
    if (!cellModal) return;
    try {
      await navigator.clipboard.writeText(cellModal.value);
      toast.ok("Copiado", "Se copió el contenido al portapapeles");
    } catch {
      toast.error("No se pudo copiar", "El navegador no permitió copiar.");
    }
  };

  return {
    cellModal,
    openCellModal,
    closeCellModal,
    copyToClipboard,
  };
}