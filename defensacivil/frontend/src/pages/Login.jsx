import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, User, Lock, MapPinned, Radio, ShieldCheck } from 'lucide-react';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import { Field, Alert } from '../components/common/ui';
import DefensaCivilLogo from '../components/common/DefensaCivilLogo';

// Usuarios de demostración del seed (todos con la contraseña Admin2503!)
const DEMO = [
  ['admin', 'Administrador'],
  ['operador1', 'Operador'],
  ['telefonista1', 'Telefonista'],
  ['chofer1', 'Chofer'],
  ['lector1', 'Lector'],
];
const showDemo = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_USERS === 'true';

export default function Login() {
  const { login, error } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/dashboard';
  const [showPw, setShowPw] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async ({ username, password }) => {
    if (await login(username.trim(), password)) navigate(from, { replace: true });
  };

  return (
    <div className="login">
      <section className="login-hero">
        <div className="row" style={{ gap: 12 }}>
          <DefensaCivilLogo size={40} />
          <div>
            <strong style={{ fontSize: 16 }}>Defensa Civil</strong>
            <div style={{ color: '#b8c6de', fontSize: 13 }}>Gestión de emergencias</div>
          </div>
        </div>
        <div>
          <h1>Cada llamada, cada móvil y cada incidente en un solo lugar.</h1>
          <p>La central registra la emergencia en el mapa, el móvil informa desde el lugar y el tablero muestra la situación en tiempo real.</p>
          <ul>
            <li><Radio size={18} /> Central telefónica con ubicación en el mapa</li>
            <li><MapPinned size={18} /> Seguimiento de estado y ubicación desde la calle</li>
            <li><ShieldCheck size={18} /> Roles, auditoría y sesiones seguras</li>
          </ul>
        </div>
        <div style={{ color: '#7f90ad', fontSize: 12 }}>Acceso exclusivo para personal autorizado</div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <h2>Ingresar</h2>
          <p className="muted" style={{ marginTop: 4, marginBottom: 24 }}>Usá tu usuario y contraseña del sistema.</p>

          <div className="stack" style={{ gap: 14 }}>
            {error && <Alert type="error">{error}</Alert>}

            <Field label="Usuario" htmlFor="username" error={errors.username?.message}>
              <div className="input-group">
                <User size={16} />
                <input id="username" className={`input${errors.username ? ' invalid' : ''}`} autoComplete="username" autoFocus
                  {...register('username', { required: 'Ingresá tu usuario' })} />
              </div>
            </Field>

            <Field label="Contraseña" htmlFor="password" error={errors.password?.message}>
              <div className="input-group">
                <Lock size={16} />
                <input id="password" type={showPw ? 'text' : 'password'} className={`input${errors.password ? ' invalid' : ''}`}
                  autoComplete="current-password" style={{ paddingRight: 42 }}
                  {...register('password', { required: 'Ingresá tu contraseña' })} />
                <button type="button" className="btn btn-ghost btn-icon btn-sm input-action" onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            <Button type="submit" size="lg" block isLoading={isSubmitting}>Ingresar</Button>
          </div>

          {showDemo && (
            <div className="demo-users">
              Usuarios de demostración (contraseña <span className="mono">Admin2503!</span>):
              <div className="row">
                {DEMO.map(([username, label]) => (
                  <button type="button" key={username} onClick={() => { setValue('username', username); setValue('password', 'Admin2503!'); }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
