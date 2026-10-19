import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title = 'Confirmar', message, confirmLabel = 'Confirmar', isLoading, danger = true }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} isLoading={isLoading}>{confirmLabel}</Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{message}</p>
    </Modal>
  );
}
