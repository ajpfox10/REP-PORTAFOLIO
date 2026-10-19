import DefensaCivilLogo from './DefensaCivilLogo';

export default function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <DefensaCivilLogo size={56} />
      <span className="loading-center" style={{ padding: 0 }}><span className="spinner" /> Cargando…</span>
    </div>
  );
}
