import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import useAuthStore from '../store/authStore';
import Button from '../components/common/Button';
import DefensaCivilLogo from '../components/common/DefensaCivilLogo';

export default function Login() {
  const { login, error } = useAuthStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/dashboard';
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm();

  const onSubmit = async ({ username, password }) => {
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (ok) navigate(from, { replace: true });
  };

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #0f766e 100%)',
      padding:'1rem',
    }}>
      <div style={{
        background:'#fff', borderRadius:'1rem', padding:'2.5rem',
        width:'100%', maxWidth:420, boxShadow:'0 25px 50px rgba(0,0,0,0.25)',
      }}>
        <div style={{ textAlign:'center', marginBottom:'2rem' }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:'0.75rem' }}>
            <DefensaCivilLogo size={90} />
          </div>
          <h1 style={{ fontSize:'1.5rem', fontWeight:700, color:'#1e293b', marginBottom:'0.25rem' }}>
            Defensa Civil Argentina
          </h1>
          <p style={{ color:'#64748b', fontSize:'0.875rem' }}>Sistema de Reporte de Incidentes</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ marginBottom:'1rem' }}>
            <label style={labelStyle}>Usuario</label>
            <input
              {...register('username', { required: 'El usuario es requerido' })}
              placeholder="nombre_usuario"
              style={inputStyle(errors.username)}
              autoComplete="username"
            />
            {errors.username && <span style={errStyle}>{errors.username.message}</span>}
          </div>

          <div style={{ marginBottom:'1.5rem' }}>
            <label style={labelStyle}>Contraseña</label>
            <div style={{ position:'relative' }}>
              <input
                {...register('password', { required: 'La contraseña es requerida' })}
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                style={{ ...inputStyle(errors.password), paddingRight:'2.5rem' }}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={{
                  position:'absolute', right:'0.75rem', top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', color:'#94a3b8',
                }}
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
            {errors.password && <span style={errStyle}>{errors.password.message}</span>}
          </div>

          {error && (
            <div style={{
              background:'#fee2e2', color:'#dc2626', padding:'0.75rem', borderRadius:'var(--radius)',
              fontSize:'0.875rem', marginBottom:'1rem',
            }}>
              {error}
            </div>
          )}

          <Button type="submit" isLoading={loading} style={{ width:'100%', justifyContent:'center' }}>
            Iniciar Sesión
          </Button>
        </form>

        <p style={{ textAlign:'center', marginTop:'1.5rem', fontSize:'0.75rem', color:'#94a3b8' }}>
          Acceso solo para personal autorizado
        </p>
      </div>
    </div>
  );
}

const labelStyle = { display:'block', fontSize:'0.875rem', fontWeight:500, marginBottom:'0.375rem', color:'#374151' };
const inputStyle = (err) => ({
  width:'100%', padding:'0.625rem 0.875rem', border:`1px solid ${err ? '#dc2626' : '#d1d5db'}`,
  borderRadius:'var(--radius)', fontSize:'0.875rem', outline:'none',
  transition:'border-color 0.15s', background:'#fff',
});
const errStyle = { color:'#dc2626', fontSize:'0.75rem', marginTop:'0.25rem', display:'block' };
