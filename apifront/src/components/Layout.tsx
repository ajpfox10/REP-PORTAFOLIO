// src/components/Layout.tsx
import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout({ title, children, showBack }: {
  title: string;
  children: React.ReactNode;
  showBack?: boolean;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { session, logout, hasPerm } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const canWrite = hasPerm('personal:write') || hasPerm('crud:*:*');
  const isAdmin  = hasPerm('usuarios:write') || hasPerm('crud:*:*');
  const isFluid  = title === 'Gestión';
  const isActive = (p: string) => loc.pathname === p || loc.pathname.startsWith(p + '/');

  const isSaludLaboral =
    (hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read')) &&
    !hasPerm('crud:*:*');

  const canSeeSaludLaboral =
    hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read');

  const canSeeEmbarazadas = hasPerm('crud:embarazadas:read');
  const canSeeResidentesRotacion = hasPerm('crud:residentes_rotacion:read') || hasPerm('crud:*:*');

  const navLink = (to: string, label: string) => (
    <Link
      className={`btn${isActive(to) ? ' active' : ''}`}
      to={to}
      style={{ fontSize: '0.82rem', padding: '7px 12px' }}
    >
      {label}
    </Link>
  );

  return (
    <div className={isFluid ? 'container-fluid' : 'container'}>
      <div className="topbar card" style={{ marginBottom: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div className="row" style={{ gap: '0.6rem' }}>
            {showBack
              ? <button className="btn" onClick={() => nav(-1)} type="button" style={{ fontSize: '0.82rem' }}>← Volver</button>
              : <Link className="badge" to="/app">Inicio</Link>
            }
            <div>
              <div className="h1">{title}</div>
              {session && (
                <div className="muted" style={{ marginTop: 2, fontSize: '0.75rem' }}>
                  {session.user?.email ?? ''}
                </div>
              )}
            </div>
          </div>

          <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap' }}>
            {isSaludLaboral ? (
              <>
                {canSeeSaludLaboral && navLink('/app/salud-laboral', '🏥 Salud Laboral')}
                {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
              </>
            ) : (
              <>
                {navLink('/app/gestion', '📋 Gestión')}
                {navLink('/app/redaccion', '✍️ Redacción')}
                {navLink('/app/consultas', '💬 Consultas')}
                {navLink('/app/pedidos', '📨 Pedidos')}
                {navLink('/app/documentos', '📂 Docs')}
                {navLink('/app/reportes', '🎂 Reportes')}
                {navLink('/app/citaciones', '⚠️ Citaciones')}

                <div style={{ position: 'relative' }}>
                  <button
                    className="btn"
                    onClick={() => setMenuOpen(o => !o)}
                    style={{
                      fontSize: '0.82rem',
                      padding: '7px 12px',
                      background: menuOpen ? 'rgba(255,255,255,0.12)' : undefined
                    }}
                    type="button"
                  >
                    ⊞ Más {menuOpen ? '▲' : '▼'}
                  </button>

                  {menuOpen && (
                    <div
                      onClick={() => setMenuOpen(false)}
                      style={{
                        position: 'absolute',
                        top: '110%',
                        right: 0,
                        zIndex: 1000,
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 12,
                        padding: 8,
                        minWidth: 220,
                        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', padding: '4px 8px', letterSpacing: '0.07em' }}>
                        Análisis
                      </div>
                      {navLink('/app/estadisticas', '📊 Estadísticas')}
                      {navLink('/app/asistencia', '🗓️ Asistencia')}
                      {navLink('/app/organigrama', '🏗️ Organigrama')}
                      {navLink('/app/alertas', '🔔 Alertas')}
                      {navLink('/app/atencion', '🏛️ Atención al Público')}
                      {navLink('/app/agentes-servicios', '🏥 Agentes por Servicio')}

                      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', padding: '4px 8px', letterSpacing: '0.07em' }}>
                        Herramientas
                      </div>
                      {navLink('/app/buscador', '🔍 Buscador')}
                      {navLink('/app/comparador', '⚖️ Comparador')}
                      {navLink('/app/legajo', '📋 Legajo')}
                      {navLink('/app/tables', '⊞ Tablas')}
                      {navLink('/app/info', 'ℹ Info')}
                      {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
                      {navLink('/app/escaneo', '🖨 Escaneo')}
                      {canSeeResidentesRotacion && navLink('/app/residentes-rotacion', '🔄 Residentes Rotación')}

                      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

                      {(canSeeSaludLaboral || canSeeEmbarazadas) && (
                        <>
                          <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', padding: '4px 8px', letterSpacing: '0.07em' }}>
                            Salud laboral
                          </div>
                          {canSeeSaludLaboral && navLink('/app/salud-laboral', '🏥 Salud Laboral')}
                          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                        </>
                      )}

                      {canWrite && navLink('/app/carga-agente', '➕ Alta Agentes')}
                      {isAdmin && navLink('/app/admin', '⚙ Admin')}
                    </div>
                  )}
                </div>
              </>
            )}

            <button
              className="btn danger"
              onClick={() => logout()}
              type="button"
              style={{ fontSize: '0.82rem', padding: '7px 12px' }}
            >
              Salir
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  );
}