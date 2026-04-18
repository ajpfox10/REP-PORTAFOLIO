// src/components/Layout.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  // Cerrar el menú al cambiar de página
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  // Cerrar si se hace click fuera
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.closest('.mas-menu-wrapper')?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const toggleMenu = useCallback(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setMenuOpen(o => !o);
  }, []);

  const canWrite = hasPerm('personal:write') || hasPerm('crud:*:*');
  const isAdmin  = hasPerm('usuarios:write') || hasPerm('crud:*:*');
  const isFluid  = title === 'Gestión';
  const isActive = (p: string) => loc.pathname === p || loc.pathname.startsWith(p + '/');

  const isSamo =
    hasPerm('app:samo:access') &&
    !hasPerm('crud:*:*');

  const isJefeServicio =
    hasPerm('app:jefe_servicio:access') &&
    !hasPerm('crud:*:*') &&
    !hasPerm('app:samo:access');

  const isSaludLaboral =
    (hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read')) &&
    !hasPerm('crud:*:*') &&
    !hasPerm('app:samo:access');

  const canSeeSaludLaboral =
    hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read');

  const canSeeEmbarazadas = hasPerm('crud:embarazadas:read');
  const canSeeResidentesRotacion = hasPerm('crud:residentes_rotacion:read') || hasPerm('crud:*:*');

  const isGestionTurnos =
    hasPerm('app:gestion_turnos:access') && !hasPerm('crud:*:*');

  const isInfectologia =
    (hasPerm('app:infectologia:access') || hasPerm('app:cargainfecto:access')) &&
    !hasPerm('crud:*:*');

  const canSeeExamenIngreso  = hasPerm('app:gestion_turnos:access') || hasPerm('crud:*:*');
  const canSeeInfectologia   = hasPerm('app:infectologia:access') || hasPerm('app:cargainfecto:access') || hasPerm('crud:*:*');

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
      {/* Topbar siempre full-width para que los botones de nav nunca desborden */}
      <div
        className="topbar card"
        style={{
          marginBottom: 0,
          borderRadius: 16,
          padding: '10px 16px',
          boxSizing: 'border-box',
          width: '100%',
          minWidth: 0,
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.4rem',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flexShrink: 0 }}>
            {showBack
              ? <button className="btn" onClick={() => nav(-1)} type="button" style={{ fontSize: '0.82rem', flexShrink: 0 }}>← Volver</button>
              : <Link className="badge" to="/app" style={{ flexShrink: 0 }}>Inicio</Link>
            }
            <div style={{ minWidth: 0 }}>
              <div className="h1" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {session && (
                <div className="muted" style={{ marginTop: 2, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {session.user?.email ?? ''}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', flexShrink: 0 }}>
            {isGestionTurnos ? (
              <>
                {navLink('/app/examen-ingreso', '🩺 Examen de Ingreso')}
                {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
              </>
            ) : isInfectologia ? (
              <>
                {navLink('/app/infectologia', '🩹 Infectología')}
                {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
              </>
            ) : isSamo ? (
              <>
                {navLink('/app/samo', '🏥 SAMO')}
                {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
              </>
            ) : isJefeServicio ? (
              <>
                {navLink('/app/mi-sector', '🏢 Gestión de Sectores')}
                {navLink('/app/samo', '🏥 SAMO')}
                {navLink('/app/mi-cuenta', '👤 Mi cuenta')}
              </>
            ) : isSaludLaboral ? (
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

                <div className="mas-menu-wrapper" style={{ position: 'relative' }}>
                  <button
                    ref={btnRef}
                    className="btn"
                    onClick={toggleMenu}
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
                        position: 'fixed',
                        top: menuPos.top,
                        right: menuPos.right,
                        zIndex: 9999,
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 12,
                        padding: 8,
                        minWidth: 220,
                        maxHeight: 'calc(100vh - 80px)',
                        overflowY: 'auto',
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
                      {navLink('/app/ausencias-fichajes', '🕵️ Ausentes vs Fichajes')}
                      {navLink('/app/sin-fichaje-salida', '🚪 Sin fichaje de salida')}
                      {navLink('/app/organigrama', '🏗️ Organigrama')}
                      {navLink('/app/alertas', '🔔 Alertas')}
                      {navLink('/app/atencion', '🏛️ Atención al Público')}
                      {navLink('/app/agentes-servicios', '🏥 Agentes por Servicio')}
                      {navLink('/app/mi-sector', '🏢 Gestión de Sectores')}
                      {navLink('/app/bajas-estructura', '📉 Bajas por Estructura')}

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

                      {(canSeeExamenIngreso || canSeeInfectologia) && (
                        <>
                          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                          <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', padding: '4px 8px', letterSpacing: '0.07em' }}>
                            RRHH / Infectología
                          </div>
                          {canSeeExamenIngreso  && navLink('/app/examen-ingreso', '🩺 Examen de Ingreso')}
                          {canSeeInfectologia   && navLink('/app/infectologia',   '🩹 Infectología')}
                          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                        </>
                      )}

                      {canWrite && navLink('/app/carga-agente', '➕ Alta Agentes')}
                      {(hasPerm('crud:resoluciones:read') || hasPerm('crud:*:*')) && navLink('/app/resoluciones', '📋 Resoluciones')}
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