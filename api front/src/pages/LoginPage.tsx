import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../ui/toast';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/LoginPage.css
import './styles/LoginPage.css';

function normalizeErrMessage(err: any): string {
  if (!err) return 'Error';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;

  // si vino un objeto raro, nunca lo intentes renderizar directo
  try {
    return JSON.stringify(err);
  } catch {
    return 'Error';
  }
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('admin@local.com');
  const [password, setPassword] = useState('admin1234');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.ok('Sesión iniciada');
      nav('/app');
    } catch (err: any) {
      toast.error('No se pudo iniciar sesión', normalizeErrMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card login-card">
        <div className="h1">Iniciar sesión</div>
        <div className="muted login-subtitle">
          Use credenciales de un usuario activo.
        </div>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@local.com"
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <div className="row login-actions">
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
            <button className="btn" type="button" onClick={() => nav('/gate')}>
              Volver
            </button>
          </div>
        </form>

        <div className="sep" />
        <div className="muted">
          Si no tiene usuario, cree uno en la tabla <code>usuarios</code> con <code>estado='activo'</code>.
        </div>
      </div>
    </div>
  );
}
