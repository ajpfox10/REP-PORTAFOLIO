import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#f1f5f9', gap:'1rem' }}>
      <div style={{ fontSize:'5rem' }}>🚧</div>
      <h1 style={{ fontSize:'2rem', fontWeight:700, color:'#1e293b' }}>404 — Página no encontrada</h1>
      <p style={{ color:'#64748b' }}>La ruta solicitada no existe.</p>
      <Link to="/dashboard" style={{ background:'#1d4ed8', color:'#fff', padding:'0.625rem 1.5rem', borderRadius:'var(--radius)', fontWeight:500 }}>
        Ir al Dashboard
      </Link>
    </div>
  );
}
