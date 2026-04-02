export default function LoadingScreen() {
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height:'100vh', background:'#f1f5f9', gap:'1rem',
    }}>
      <div style={{
        width:48, height:48, border:'4px solid #e2e8f0',
        borderTop:'4px solid #1d4ed8', borderRadius:'50%',
        animation:'spin 0.8s linear infinite',
      }} />
      <p style={{ color:'#64748b', fontSize:'0.875rem' }}>Cargando...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
