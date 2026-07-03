// src/pages/DashboardPage/DashboardPage.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useDashboard } from './hooks/useDashboard';
import { useAuth } from '../../auth/AuthProvider';
import { isAtilioVarelaUser } from '../../auth/userIdentity';
import { useKiosk } from '../../hooks/useKiosk';
import { EmbarazadasAlertaBanner } from '../EmbarazadasPage';
import { ExamenIngresoBanner } from '../ExamenIngresoPage';
import { AccidentesPunzoBanner } from '../AccidentesPunzoPage';
import { JefedeptosAlertaBanner } from '../JefedeptosPage';
import { FicheroBanner } from '../FicheroPage';
import { GuarderiaAlertaBanner } from '../GuarderiaPage';
import { AlertasAgenteDashboardBanner } from '../AlertasAgentePage';
import { ConcursosFuncionesBanner } from '../ConcursosPage/ConcursosFuncionesExamenes';
import { DashboardAlertSlot, useDashboardAlertsConfig } from './components/DashboardAlertSlot';
import type { DashboardAlertKey } from './components/DashboardAlertSlot';
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

function GroupTab({ to, children, tooltip }: {
  to: string;
  children: React.ReactNode;
  tooltip: string;
}) {
  return (
    <Link className="dash-group-tab" to={to} role="tab" data-tooltip={tooltip}>
      <span>{children}</span>
    </Link>
  );
}

function AsistenciaTile() {
  return (
    <div className="tile dash-group-tile" style={{ borderLeftColor: '#6366f1', borderLeftWidth: 3 }}>
      <Link className="dash-group-main" to="/app/asistencia">
        <h3>🗓️ Asistencia</h3>
        <p>Comparación de novedades entre Ministerio y SIAP. Detecta coincidencias y diferencias por DNI.</p>
      </Link>
      <div className="dash-group-tabs" role="tablist" aria-label="Herramientas de asistencia">
        <GroupTab
          to="/app/ausencias-fichajes"
          tooltip="Unificado en Asistencia. Cruza agentes con código 28/inasistencia contra SIAP para ver si debían venir y si ficharon."
        >
          Ausentes vs Fichajes
        </GroupTab>
        <GroupTab
          to="/app/sin-fichaje-salida"
          tooltip="Unificado en Asistencia. Detecta jornadas con entrada biométrica sin salida registrada y cruza horarios/SIAP por UPA."
        >
          Sin fichaje de salida
        </GroupTab>
        <GroupTab
          to="/app/stress-alertas"
          tooltip="Unificado en Asistencia. Alertas post-vacacionales y licencias pendientes, con filtros por agente/servicio y exportación."
        >
          Stress Post-Vacacional
        </GroupTab>
        <GroupTab
          to="/app/reporte-servicio"
          tooltip="Unificado en Asistencia. Resumen mensual por servicio: horas teóricas vs reales, fichajes diarios, feriados y semanas/mes."
        >
          Reporte por Servicio
        </GroupTab>
        <GroupTab
          to="/app/presentes-turno"
          tooltip="Unificado en Asistencia. Por servicio y fecha: esperados según Excel de horarios, quién fichó y quién no, con justificación SIAP/Ministerio."
        >
          Presentes por Turno
        </GroupTab>
      </div>
    </div>
  );
}

function EstructuraTile() {
  return (
    <div className="tile dash-group-tile" style={{ borderLeftColor: '#7c3aed', borderLeftWidth: 3 }}>
      <Link className="dash-group-main" to="/app/estructura">
        <h3>🏗️ Estructura Organizacional</h3>
        <p>Administrá la jerarquía completa: Dependencias, Reparticiones, Servicios y Sectores. CRUD con filtros y exportación a Excel.</p>
      </Link>
      <div className="dash-group-tabs dash-group-tabs-single" role="tablist" aria-label="Herramientas de estructura organizacional">
        <GroupTab
          to="/app/organigrama"
          tooltip="Unificado en Estructura Organizacional. Vista visual del personal por jefatura, dependencia, servicio y sector."
        >
          Organigrama
        </GroupTab>
      </div>
    </div>
  );
}

function LegajoTile() {
  return (
    <div className="tile dash-group-tile" style={{ borderLeftColor: '#a3e635', borderLeftWidth: 3 }}>
      <Link className="dash-group-main" to="/app/legajo">
        <h3>📋 Legajo Completo</h3>
        <p>Vista unificada e imprimible de todos los datos de un agente: personal, laboral, servicios y documentos.</p>
      </Link>
      <div className="dash-group-tabs" role="tablist" aria-label="Herramientas de legajo y búsqueda">
        <GroupTab
          to="/app/buscador"
          tooltip="Unificado en Legajo Completo. Busca por DNI o apellido en todas las secciones y conserva historial."
        >
          Buscador Global
        </GroupTab>
        <GroupTab
          to="/app/comparador"
          tooltip="Unificado en Legajo Completo. Compara dos agentes lado a lado y marca diferencias de datos."
        >
          Comparador
        </GroupTab>
      </div>
    </div>
  );
}

function ResidentesTile({ canOpenResidentes, showRotacion }: {
  canOpenResidentes: boolean;
  showRotacion: boolean;
}) {
  const main = (
    <>
      <h3>🩺 Residentes</h3>
      <p>Residentes: fichaje, horarios, licencias y expedientes por agente y mes.</p>
    </>
  );

  return (
    <div className="tile dash-group-tile" style={{ borderLeftColor: '#a78bfa', borderLeftWidth: 3 }}>
      {canOpenResidentes ? (
        <Link className="dash-group-main" to="/app/residentes">{main}</Link>
      ) : (
        <div className="dash-group-main" aria-disabled="true">{main}</div>
      )}
      {showRotacion && (
        <div className="dash-group-tabs dash-group-tabs-single" role="tablist" aria-label="Herramientas de residentes">
          <GroupTab
            to="/app/residentes-rotacion"
            tooltip="Unificado en Residentes. Carga y consulta rotaciones de residentes por servicio y período; visible solo con permiso de rotación."
          >
            Residentes Rotación
          </GroupTab>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { pedidosTotal, canDocs, canGestion, canPedidos } = useDashboard();
  const { hasPerm, session } = useAuth();
  const { isKiosk, kioskLoading } = useKiosk();
  const alertsConfig = useDashboardAlertsConfig();
  const alert = (key: DashboardAlertKey, banner: React.ReactNode) => (
    alertsConfig ? <DashboardAlertSlot behavior={alertsConfig.alerts[key]}>{banner}</DashboardAlertSlot> : null
  );

  const canSeeSaludLaboral =
    hasPerm('crud:reconocimientos_medicos:read') || hasPerm('crud:examen_anual:read');

  const canSeeEmbarazadas = hasPerm('crud:embarazadas:read');
  const blockedFromResidentesRotacion = isAtilioVarelaUser(session?.user);
  const canSeeResidentesRotacion =
    !blockedFromResidentesRotacion &&
    (hasPerm('crud:residentes_rotacion:read') || hasPerm('crud:*:*'));
  const canSeeResidentes = hasPerm('app:residentes:access') || hasPerm('crud:*:*');
  const canSeeSamo = hasPerm('app:samo:access') || hasPerm('crud:*:*');
  const canSeeAlertasAgente = hasPerm('api:access');

  const isSaludLaboral =
    canSeeSaludLaboral &&
    !hasPerm('crud:*:*') &&
    !hasPerm('app:samo:access') &&
    !hasPerm('app:jefe_servicio:access');

  const isJefeServicio =
    hasPerm('app:jefe_servicio:access') &&
    !hasPerm('crud:*:*');

  const isSamo =
    hasPerm('app:samo:access') &&
    !hasPerm('crud:*:*');

  const isGestionTurnos =
    hasPerm('app:gestion_turnos:access') && !hasPerm('crud:*:*');

  const isInfectologia =
    (hasPerm('app:infectologia:access') || hasPerm('app:cargainfecto:access')) &&
    !hasPerm('crud:*:*');

  const canSeeExamenIngreso = hasPerm('app:gestion_turnos:access') || hasPerm('crud:*:*');
  const canSeeInfectologia  = hasPerm('app:infectologia:access') || hasPerm('app:cargainfecto:access') || hasPerm('crud:*:*');

  const shouldShowEmbarazadasBanner = !isSaludLaboral && !isJefeServicio && !isSamo && !isGestionTurnos && !isInfectologia && !isKiosk;

  // ── Kiosco: PC de atención al público ─────────────────────────────────────
  if (kioskLoading) return null; // evita flash antes de resolver la IP
  if (isKiosk) {
    return (
      <Layout title="Atención al Público">
        <div style={{ marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Módulo activo
          </div>
          <div className="grid">
            <Tile
              to="/app/atencion"
              title="🏛️ Atención al Público"
              desc="Recepción de agentes, motivo de consulta y emisión de ticket de atención."
              accent="#0f766e"
            />
            <Tile
              to="/app/mi-cuenta"
              title="👤 Mi cuenta"
              desc="Perfil y cambio de contraseña."
              accent="#0ea5e9"
            />
          </div>
        </div>
      </Layout>
    );
  }

  if (isJefeServicio) {
    return (
      <Layout title="Panel">
        <div style={{ marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Gestión de Sectores
          </div>
          <div className="grid">
            <Tile
              to="/app/mi-sector"
              title="🏢 Gestión de Sectores"
              desc="Gestión de agentes y servicios de tu sector."
              accent="#6366f1"
            />
            {(canSeeResidentes || canSeeResidentesRotacion) && (
              <ResidentesTile canOpenResidentes={canSeeResidentes} showRotacion={canSeeResidentesRotacion} />
            )}
            {hasPerm('app:samo:access') && (
            <Tile
              to="/app/samo"
              title="🏥 SAMO"
              desc="Gestión y seguimiento de licencias médicas del personal."
              accent="#10b981"
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

  if (isSaludLaboral) {
    return (
      <Layout title="Panel">
        {alert('accidentesPunzo', <AccidentesPunzoBanner />)}
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
              to="/app/infectologia"
              title="🩹 Infectología"
              desc="Registro y seguimiento de accidentes punzo-cortantes del personal."
              accent="#ef4444"
            />
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

  if (isSamo) {
    return (
      <Layout title="Panel — SAMO">
        <div style={{ marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            SAMO
          </div>
          <div className="grid">
            <Tile
              to="/app/samo"
              title="🏥 SAMO"
              desc="Gestión y seguimiento de licencias médicas del personal."
              accent="#14b8a6"
            />
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

  if (isGestionTurnos) {
    return (
      <Layout title="Panel — Gestión de Turnos">
        {alert('examenIngreso', <ExamenIngresoBanner />)}
        <div style={{ marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Módulo activo
          </div>
          <div className="grid">
            <Tile to="/app/examen-ingreso" title="🩺 Examen de Ingreso" desc="Gestión de turnos para examen de ingreso: laboratorio, rayos, cardiología, psicología, fonoaudiología y odontología." accent="#6366f1" />
            <Tile to="/app/mi-cuenta" title="👤 Mi cuenta" desc="Perfil, permisos y cambio de contraseña." accent="#0ea5e9" />
          </div>
        </div>
      </Layout>
    );
  }

  if (isInfectologia) {
    return (
      <Layout title="Panel — Infectología">
        {alert('accidentesPunzo', <AccidentesPunzoBanner />)}
        <div style={{ marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Módulo activo
          </div>
          <div className="grid">
            <Tile to="/app/infectologia" title="🩹 Infectología" desc="Registro y seguimiento de accidentes punzo-cortantes del personal." accent="#ef4444" />
            <Tile to="/app/mi-cuenta" title="👤 Mi cuenta" desc="Perfil, permisos y cambio de contraseña." accent="#0ea5e9" />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Panel">
      {shouldShowEmbarazadasBanner && alert('embarazadas', <EmbarazadasAlertaBanner />)}
      {hasPerm('crud:*:*') && alert('guarderia', <GuarderiaAlertaBanner />)}
      {hasPerm('crud:*:*') && alert('fichero', <FicheroBanner />)}
      {hasPerm('crud:*:*') && alert('examenIngreso', <ExamenIngresoBanner />)}
      {hasPerm('crud:*:*') && alert('accidentesPunzo', <AccidentesPunzoBanner />)}
      {hasPerm('crud:*:*') && alert('jefaturas', <JefedeptosAlertaBanner />)}
      {hasPerm('crud:*:*') && alert('concursos', <ConcursosFuncionesBanner />)}
      {canSeeAlertasAgente && alert('alertasAgente', <AlertasAgenteDashboardBanner />)}

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
          <Tile to="/app/tramites-documentales" title="Trámites documentales" desc="Becarios e interinos: analizar PDFs, detectar agente y revisar documentación." disabled={!canDocs} accent="#0f766e" />
          <Tile to="/app/citaciones" title="⚠️ Citaciones" desc="Registro y seguimiento de citaciones por agente." accent="#ef4444" />
          <Tile to="/app/mi-sector" title="🏢 Gestión de Sectores" desc="Gestión de agentes y servicios por sector." accent="#6366f1" />
          <Tile to="/app/atencion" title="🏛️ Atención al Público" desc="Recepción de agentes, motivo de consulta y emisión de ticket de atención." accent="#0f766e" />
          <Tile to="/app/carga-agente" title="🧾 Carga de Agente" desc="Alta manual de agentes y carga inicial de datos en el sistema." accent="#84cc16" />
          {(canSeeResidentes || canSeeResidentesRotacion) && (
            <ResidentesTile canOpenResidentes={canSeeResidentes} showRotacion={canSeeResidentesRotacion} />
          )}
          {(hasPerm('crud:resoluciones:read') || hasPerm('crud:*:*')) && (
            <Tile to="/app/resoluciones" title="📋 Resoluciones" desc="Resoluciones, expedientes y archivos escaneados por agente." accent="#0d9488" />
          )}
          <Tile to="/app/guarderia" title="🧒 Guardería" desc="Registro de agentes con hijos en edad de guardería, alertas de cumpleaños de 45 días y seguimiento de trámites." accent="#f59e0b" />
          <Tile to="/app/becarios-art" title="🩺 Becarios ART" desc="Alta de becarios en ART. Panel de pendientes y registro de los ya ingresados con usuario de carga y número de página ART." accent="#06b6d4" />
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Análisis y estadísticas
        </div>
        <div className="grid">
          <Tile to="/app/estadisticas" title="📊 Estadísticas" desc="Agentes por sector, servicio, categoría, ingresos por año, cumpleaños del mes y más." accent="#ec4899" />
          <AsistenciaTile />
          {(hasPerm('crud:fc_cert_reemplazos:read') || hasPerm('crud:*:*')) && (
            <Tile to="/app/fc-cert-reemplazos" title="📋 FC / Cert. / Reemplazos" desc="Seguimiento mensual de Francos Compensatorios, Certificación de Servicios y Reemplazos de Guardia." accent="#7c2d12" />
          )}
          <Tile to="/app/alertas" title="🔔 Alertas" desc="Cumpleaños próximos, antigüedad 20 años, ingresos y bajas recientes, datos incompletos." accent="#ef4444" />
          {canSeeAlertasAgente && (
            <Tile to="/app/alertas-agente" title="🚨 Alertas por Agente" desc="Gestión de alertas manuales por agente: creación, seguimiento y estado de lectura por usuario." accent="#dc2626" />
          )}
          <Tile to="/app/agentes-servicios" title="🏥 Agentes por Servicio" desc="..." accent="#0891b2" />
          {hasPerm('crud:*:*') && (
            <Tile to="/app/bajas-gestion" title="📉 Gestión de Bajas" desc="Estadísticas, completitud de datos y bajas por estructura en pestañas. Filtros por ley, sexo, servicio y edad." accent="#f87171" />
          )}
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Herramientas
        </div>
        <div className="grid">
          <EstructuraTile />
          <Tile to="/app/jefedeptos" title="🏛️ Historial Jefaturas" desc="Cargar y consultar el historial de quién ocupó cada jefatura. Alertas de vencimiento de cargos por concurso." accent="#6366f1" />
          <Tile to="/app/herramientas" title="⚖️ Jubilación IPS" desc="Calculadora de jubilación IPS para Leyes 10471 y 10430. Servicio nombrado, becas, ANSES, insalubridad y prorrateo." accent="#7c3aed" />
          <Tile to="/app/concursos" title="🏆 Concursos Ley 10471" desc="Concurso de ingreso por año, ley, servicio y agente. Concurso de funciones: Ley 10471 con más de 15 años de antigüedad. Exportación a Excel." accent="#6366f1" />
          <LegajoTile />
          <Tile to="/app/mi-cuenta" title="👤 Mi cuenta" desc="Perfil, permisos, tablas del sistema e información de acceso." accent="#0ea5e9" />
          <Tile to="/app/escaneo" title="🖨️ Escaneo" desc="Escaneo de documentos, dispositivos, bandejas y cola de trabajos en tiempo real." accent="#0891b2" />
          <Tile to="/app/admin" title="🛠️ Administración" desc="Gestión administrativa del sistema, usuarios y solicitudes de acceso." accent="#dc2626" />
          <Tile to="/app/fichero" title="📤 Módulo Fichero" desc="Monitor de archivos de fichadas: archivos creados, estado de subida SFTP y alerta de red caída." accent="#f59e0b" />
        </div>
      </div>

      {(canSeeSaludLaboral || canSeeEmbarazadas || canSeeSamo || canSeeExamenIngreso || canSeeInfectologia) && (
        <div style={{ marginTop: 24, marginBottom: 6 }}>
          <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Salud Laboral
          </div>
          <div className="grid">
            {canSeeSaludLaboral && (
              <Tile to="/app/salud-laboral" title="🏥 Salud Laboral" desc="Reconocimientos médicos y exámenes anuales del personal." accent="#14b8a6" />
            )}
            {canSeeSamo && (
              <Tile to="/app/samo" title="🏥 SAMO" desc="Gestión y seguimiento de licencias médicas del personal." accent="#0d9488" />
            )}
            {canSeeEmbarazadas && (
              <Tile to="/app/embarazadas" title="🤰 Embarazadas" desc="Registro de agentes embarazadas, FPP y alertas de licencia." accent="#f472b6" />
            )}
            {canSeeExamenIngreso && (
              <Tile to="/app/examen-ingreso" title="🩺 Examen de Ingreso" desc="Gestión de turnos de examen de ingreso para candidatos activos y nuevos agentes." accent="#6366f1" />
            )}
            {canSeeInfectologia && (
              <Tile to="/app/infectologia" title="🩹 Infectología" desc="Registro y seguimiento de accidentes punzo-cortantes del personal." accent="#ef4444" />
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
