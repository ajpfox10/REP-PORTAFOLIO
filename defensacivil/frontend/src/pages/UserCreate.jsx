import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { usersApi } from '../api/users.api';
import Button from '../components/common/Button';

const ROLES = [
  { value:'admin',  label:'Administrador — acceso completo' },
  { value:'medium', label:'Operador — crear y editar propios' },
  { value:'read',   label:'Lector — solo visualización' },
];

const inp = { padding:'0.5rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem', background:'#fff', width:'100%' };
const fld = { display:'flex', flexDirection:'column', gap:'0.375rem', marginBottom:'1rem' };
const lbl = { fontSize:'0.875rem', fontWeight:500, color:'#374151' };

export default function UserCreate() {
  const navigate = useNavigate();
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { role:'read' } });

  const onSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try { await usersApi.create(data); navigate('/usuarios'); }
    catch (err) { setError(err.response?.data?.error || 'Error al crear usuario'); setLoading(false); }
  };

  return (
    <div style={{ maxWidth:540, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}>←</button>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Nuevo Usuario</h1>
      </div>

      {error && <div style={{ background:'#fee2e2', color:'#dc2626', padding:'0.75rem', borderRadius:'var(--radius)', marginBottom:'1rem' }}>{error}</div>}

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem' }}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={fld}>
            <label style={lbl}>Nombre Completo *</label>
            <input style={inp} {...register('full_name', { required:'Requerido' })} />
            {errors.full_name && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.full_name.message}</span>}
          </div>
          <div style={fld}>
            <label style={lbl}>Usuario *</label>
            <input style={inp} {...register('username', { required:'Requerido', minLength:{value:3,message:'Mínimo 3 caracteres'} })} />
            {errors.username && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.username.message}</span>}
          </div>
          <div style={fld}>
            <label style={lbl}>Email *</label>
            <input type="email" style={inp} {...register('email', { required:'Requerido' })} />
            {errors.email && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.email.message}</span>}
          </div>
          <div style={fld}>
            <label style={lbl}>Contraseña *</label>
            <input type="password" style={inp} {...register('password', { required:'Requerido', minLength:{value:8,message:'Mínimo 8 caracteres'} })} />
            {errors.password && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{errors.password.message}</span>}
            <span style={{ fontSize:'0.75rem', color:'#94a3b8' }}>Mínimo 8 caracteres, mayúsculas, minúsculas y números</span>
          </div>
          <div style={fld}>
            <label style={lbl}>Rol *</label>
            <select style={inp} {...register('role')}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', marginTop:'0.5rem' }}>
            <Button variant="secondary" type="button" onClick={() => navigate(-1)}>Cancelar</Button>
            <Button type="submit" isLoading={loading}>Crear Usuario</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
