import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { usersApi } from '../api/users.api';
import { RoleBadge } from '../components/common/Badge';
import Button from '../components/common/Button';

const ROLES = ['admin','medium','read'];
const inp = { padding:'0.5rem 0.75rem', border:'1px solid #d1d5db', borderRadius:'var(--radius)', fontSize:'0.875rem', background:'#fff', width:'100%' };
const fld = { display:'flex', flexDirection:'column', gap:'0.375rem', marginBottom:'1rem' };
const lbl = { fontSize:'0.875rem', fontWeight:500, color:'#374151' };

export default function UserEdit() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [user,    setUser]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwOk,    setPwOk]    = useState(false);
  const [newPw,   setNewPw]   = useState('');

  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    usersApi.getOne(uuid).then(r => { setUser(r.data); reset({ full_name: r.data.full_name, email: r.data.email, role: r.data.role }); });
  }, [uuid]);

  const onSubmit = async (data) => {
    setLoading(true); setError(null);
    try { await usersApi.update(uuid, data); navigate('/usuarios'); }
    catch (err) { setError(err.response?.data?.error || 'Error'); setLoading(false); }
  };

  const handlePwReset = async () => {
    if (!newPw || newPw.length < 8) { setPwError('Mínimo 8 caracteres'); return; }
    setPwError(null);
    try { await usersApi.resetPassword(uuid, { newPassword: newPw }); setPwOk(true); setNewPw(''); }
    catch (err) { setPwError(err.response?.data?.error || 'Error'); }
  };

  if (!user) return <p style={{ color:'#64748b' }}>Cargando...</p>;

  return (
    <div style={{ maxWidth:540, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.25rem', color:'#64748b' }}>←</button>
        <h1 style={{ fontSize:'1.5rem', fontWeight:700 }}>Editar Usuario: {user.username}</h1>
      </div>

      {error && <div style={{ background:'#fee2e2', color:'#dc2626', padding:'0.75rem', borderRadius:'var(--radius)', marginBottom:'1rem' }}>{error}</div>}

      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem', marginBottom:'1.5rem' }}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={fld}><label style={lbl}>Nombre Completo</label><input style={inp} {...register('full_name')} /></div>
          <div style={fld}><label style={lbl}>Email</label><input type="email" style={inp} {...register('email')} /></div>
          <div style={fld}>
            <label style={lbl}>Rol</label>
            <select style={inp} {...register('role')}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
            <Button variant="secondary" type="button" onClick={() => navigate(-1)}>Cancelar</Button>
            <Button type="submit" isLoading={loading}>Guardar Cambios</Button>
          </div>
        </form>
      </div>

      {/* Password reset */}
      <div style={{ background:'#fff', borderRadius:'var(--radius)', boxShadow:'var(--shadow)', padding:'1.5rem' }}>
        <h2 style={{ fontSize:'1rem', fontWeight:600, marginBottom:'1rem' }}>Restablecer Contraseña</h2>
        {pwOk && <div style={{ color:'#16a34a', marginBottom:'0.75rem', fontSize:'0.875rem' }}>✓ Contraseña restablecida exitosamente</div>}
        <div style={{ display:'flex', gap:'0.75rem', alignItems:'flex-end' }}>
          <div style={{ ...fld, flex:1, marginBottom:0 }}>
            <label style={lbl}>Nueva Contraseña</label>
            <input type="password" style={inp} value={newPw} onChange={e => { setNewPw(e.target.value); setPwError(null); setPwOk(false); }} />
            {pwError && <span style={{ color:'#dc2626', fontSize:'0.75rem' }}>{pwError}</span>}
          </div>
          <Button variant="secondary" onClick={handlePwReset}>Restablecer</Button>
        </div>
      </div>
    </div>
  );
}
