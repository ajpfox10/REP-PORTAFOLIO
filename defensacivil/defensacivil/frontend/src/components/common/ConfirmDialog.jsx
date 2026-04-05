import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, isLoading }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Confirmar'} width={400}>
      <p style={{ color:'var(--color-text-muted)', marginBottom:'1.5rem' }}>{message}</p>
      <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>Cancelar</Button>
        <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>Confirmar</Button>
      </div>
    </Modal>
  );
}
