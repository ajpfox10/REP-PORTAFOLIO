import { MapPinOff } from 'lucide-react';
import Button from '../components/common/Button';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="empty">
        <div className="empty-icon"><MapPinOff size={22} /></div>
        <h3>Página no encontrada</h3>
        <p style={{ marginBottom: 16 }}>La dirección que buscás no existe o fue movida.</p>
        <Button to="/dashboard">Ir al tablero</Button>
      </div>
    </div>
  );
}
