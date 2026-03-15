// src/pages/DashboardPage/DashboardPage.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useDashboard } from './hooks/useDashboard';
import { useAuth } from '../../auth/AuthProvider';
import { EmbarazadasAlertaBanner } from '../EmbarazadasPage';
import './styles/DashboardPage.css';

function Tile({ to, title, desc, disabled, accent }: {
  to: string; title: string; desc: string; disabled?: boolean; accent?: string;
}) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  const style = accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : {};
  if (disabled) return <div className={cls} aria-disabled="true" style={style}><h3>{title}</h3><p>{desc}</p></div>;
  return (
    <Link className={cls} to={to} style={style}>
      <h3>{title}</h3>
      <p>{desc}</p>
    </Link>
  );
}

function StatTile({ to, title, desc, stat, disabled }: {
  to: string; title: string; desc: string; stat?: string; disabled?: boolean;
}) {
  const cls = `tile ${disabled ? 'disabled' : ''}`;
  const content = (
    <>
      <div className="row dash-stat-head">
        <h3 className="dash-stat-title">{title}</h3>
        {stat ? <span className="badge">{stat}</span> : null}
      </div>
      <p>{desc}</p>
    </>
  );
  if (disabled) return <div className={cls} aria-disabled="true">{content}</div>;
  return <Link className={cls} to={to}>{content}</Link>;
}

export function DashboardPage() {
  const { pedidosTotal, canDocs, canTables, canGestion, canPedidos } = useDashboard();
  const { hasPerm } = useAuth();

  const canSeeSaludLaboral =
    hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read');

  const canSeeEmbarazadas = hasPerm('crud:embarazadas:read');
  const canSeeResidentesRotacion = hasPerm('crud:residentes_rotacion:read') || hasPerm('crud:*:*');

  const isSaludLaboral =
    canSeeSaludLaboral &&
    !hasPerm('crud:*:*');

  const isJefeServicio =
    hasPerm('app:jefe_servicio:access') &&
    !hasPerm('crud:*:*');

  const shouldShowEmbarazadasBanner = !isSaludLaboral && !isJefeServicio;

  if (isSaludLaboral) {
    return (
      <Layout title="Panel">
        <div style={{ marginBottom: 6 }}>
          <div
            className="muted"
            style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}
          >
            Salud Laboral
          </div>
          <div className="grid">
            {canSeeSaludLaboral && (
              <Tile
                to="/app/salud-laboral"
                title="🏥 Salud Laboral"
                desc="Reconocimientos médicos y exámenes anuales del personal."
                accent="#14b8a6"
              />
            )}
            <Tile
              to="/app/mi-cuenta"
              title="👤 Mi cuenta"
              desc="Perfil, permisos y cambio de contraseña."
              accent="#0ea5e9"
            />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Panel">
      {shouldShowEmbarazadasBanner && <EmbarazadasAlertaBanner />}

      <div style={{ marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Módulos principales
        </div>
        <div className="grid">
          <Tile to="/app/gestion" title="📋 Gestión" desc="Buscar agente por DNI o nombre. Ver todos sus datos, documentos y pedidos." disabled={!canGestion} accent="#2563eb" />
          <Tile to="/app/redaccion" title="✍️ Redacción" desc="Generar certificados, IOMA y documentos para un agente." accent="#7c3aed" />
          <Tile to="/app/reportes" title="🎂 Reportes" desc="Cumpleaños, antigüedad, consultas dinámicas sobre las tablas." accent="#f97316" />
          <Tile to="/app/consultas" title="💬 Consultas" desc="Historial de consultas del sistema." accent="#10b981" />
          <StatTile to="/app/pedidos" title="📨 Pedidos" desc="Ver pedidos y exportar." stat={pedidosTotal === null ? '—' : `${pedidosTotal}`} disabled={!canPedidos} />
          <Tile to="/app/documentos" title="📂 Documentos" desc="Listado y visor de documentos PDF." disabled={!canDocs} accent="#22d3ee" />
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Análisis y estadísticas
        </div>
        <div className="grid">
          <Tile to="/app/estadisticas" title="📊 Estadísticas" desc="Agentes por sector, servicio, categoría, ingresos por año, cumpleaños del mes y más." accent="#ec4899" />
          <Tile to="/app/asistencia" title="🗓️ Asistencia" desc="Comparación de novedades entre Ministerio y SIAP. Detecta coincidencias y diferencias por DNI." accent="#6366f1" />
          <Tile to="/app/organigrama" title="🏗️ Organigrama" desc="Distribución visual del personal por jefatura, sector, servicio y dependencia." accent="#f59e0b" />
          <Tile to="/app/alertas" title="🔔 Alertas" desc="Cumpleaños próximos, antigüedad 20 años, ingresos y bajas recientes, datos incompletos." accent="#ef4444" />
          <Tile to="/app/atencion" title="🏛️ Atención al Público" desc="Recepción de agentes, motivo de consulta y emisión de ticket de atención." accent="#0f766e" />
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Herramientas
        </div>
        <div className="grid">
          <Tile to="/app/buscador" title="🔍 Buscador Global" desc="Buscá por DNI o apellido en todas las secciones con historial de búsquedas." accent="#06b6d4" />
          <Tile to="/app/comparador" title="⚖️ Comparador" desc="Comparar dos agentes lado a lado. Las diferencias se marcan automáticamente." accent="#8b5cf6" />
          <Tile to="/app/legajo" title="📋 Legajo Completo" desc="Vista unificada e imprimible de todos los datos de un agente: personal, laboral, servicios y documentos." accent="#a3e635" />
          <Tile to="/app/tables" title="⊞ Tablas" desc="Explorar todas las tablas del sistema." disabled={!canTables} accent="#64748b" />
          <Tile to="/app/info" title="ℹ️ Información" desc="Notas de acceso, configuración y ayuda." accent="#475569" />
          <Tile to="/app/mi-cuenta" title="👤 Mi cuenta" desc="Perfil, permisos y cambio de contraseña." accent="#0ea5e9" />
          <Tile to="/app/escaneo" title="🖨️ Escaneo" desc="Escaneo de documentos, dispositivos, bandejas y cola de trabajos en tiempo real." accent="#0891b2" />
          <Tile to="/app/admin" title="🛠️ Administración" desc="Gestión administrativa del sistema, usuarios y solicitudes de acceso." accent="#dc2626" />
          <Tile to="/app/carga-agente" title="🧾 Carga de Agente" desc="Alta manual de agentes y carga inicial de datos en el sistema." accent="#84cc16" />
        </div>
      </div>

      {(canSeeSaludLaboral || canSeeEmbarazadas || canSeeResidentesRotacion) && (
        <div style={{ marginTop: 24, marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Salud Laboral
          </div>
          <div className="grid">
            {canSeeSaludLaboral && (
              <Tile to="/app/salud-laboral" title="🏥 Salud Laboral" desc="Reconocimientos médicos y exámenes anuales del personal." accent="#14b8a6" />
            )}
            {canSeeEmbarazadas && (
              <Tile to="/app/embarazadas" title="🤰 Embarazadas" desc="Registro de agentes embarazadas, FPP y alertas de licencia." accent="#f472b6" />
            )}
            {canSeeResidentesRotacion && (
              <Tile to="/app/residentes-rotacion" title="🔄 Residentes Rotación" desc="Registro de rotaciones de residentes por servicio y período." accent="#a78bfa" />
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}