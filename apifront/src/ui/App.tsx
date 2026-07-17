// src/ui/App.tsx
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { isAtilioVarelaUser } from '../auth/userIdentity';
import { ToastProvider } from './toast';
import { ErrorBoundary } from './ErrorBoundary';
import { GatePage } from '../pages/GatePage';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { TableViewPage } from '../pages/TableViewPage';
import { GestionPage } from '../pages/Gesytionpage';
import { AdminPage } from '../pages/AdminPage';
import { CargaAgentePage } from '../pages/CargaAgentePage';
import { ConsultasPage } from '../pages/ConsultasPage';
import { PedidosPage } from '../pages/PedidosPage';
import { DocumentosPage } from '../pages/DocumentosPage';
import { ReportesPage } from '../pages/ReportesPage';
import { RedaccionPage } from '../pages/RedaccionPage';
import { EstadisticasPage } from '../pages/EstadisticasPage';
import { OrganigramaPage } from '../pages/OrganigramaPage';
import { ComparadorPage } from '../pages/ComparadorPage';
import { ComparadorSiapePage } from '../pages/ComparadorSiapePage';
import { LegajoPage } from '../pages/LegajoPage';
import { AlertasPage } from '../pages/AlertasPage';
import { BuscadorPage } from '../pages/BuscadorPage';
import { SolicitarAccesoPage } from '../pages/SolicitarAccesoPage';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { GestionUsuarioPage } from '../pages/GestionUsuarioPage';
import { SaludLaboralPage } from '../pages/SaludLaboralPage';
import { EmbarazadasPage } from '../pages/EmbarazadasPage';
import { GuarderiaPage } from '../pages/GuarderiaPage';
import { ResidentesRotacionPage } from '../pages/ResidentesRotacionPage';
import { ResidentesPage } from '../pages/ResidentesPage';
import { AsistenciaPage } from '../pages/AsistenciaPage';
import { AtencionPublicoPage } from '../pages/AtencionPublicoPage';
import { EscaneoPage } from '../pages/EscaneoPage';
import { EscaneoAgentePage } from '../pages/EscaneoAgentePage';
import { AgentesServiciosPage } from '../pages/AgentesServiciosPage';
import { CitacionesPage } from '../pages/CitacionesPage';
import { JefeServicioPage } from '../pages/JefeServicioPage';
import { SamoPage } from '../pages/SamoPage';
import { ResolucionesPage } from '../pages/ResolucionesPage';
import { FicheroPage } from '../pages/FicheroPage';
import { AusenciasConFichajesPage } from '../pages/AusenciasConFichajesPage';
import { SinFichajeSalidaPage }    from '../pages/SinFichajeSalidaPage';
import { ExamenIngresoPage } from '../pages/ExamenIngresoPage';
import { AccidentesPunzoPage } from '../pages/AccidentesPunzoPage';
import { BajasGestionPage } from '../pages/BajasGestionPage';
import { HistorialEstructuraPage } from '../pages/HistorialEstructuraPage';
import { useKiosk, setKioskManual } from '../hooks/useKiosk';
import { HerramientasPage }    from '../pages/HerramientasPage';
import { ConcursosPage }         from '../pages/ConcursosPage';
import { DirectorEjecutivoPage } from '../pages/DirectorEjecutivoPage';
import { AlertasAgentePage }   from '../pages/AlertasAgentePage';
import { StressAlertasPage }  from '../pages/StressAlertasPage';
import { JefedeptosPage } from '../pages/JefedeptosPage';
import { ReporteAsistenciaServicioPage } from '../pages/ReporteAsistenciaServicioPage';
import { PresentesTurnoPage } from '../pages/PresentesTurnoPage';
import { EstructuraPage } from '../pages/EstructuraPage';
import { FcCertReemplazosPage } from '../pages/FcCertReemplazosPage';
import { BecariosArtPage }      from '../pages/BecariosArtPage';
import { TramitesDocumentalesPage } from '../pages/TramitesDocumentalesPage';

function Private({ children }: { children: React.ReactNode }) {
  const { session, isReady } = useAuth();
  const loc = useLocation();

  if (!isReady) return null;
  if (!session) return <Navigate to="/gate" state={{ from: loc.pathname }} replace />;
  return <KioskRedirect>{children}</KioskRedirect>;
}

// Redirige cualquier ruta al kiosco de atención al público si la IP está configurada.
// Envuelve TODAS las rutas privadas para que no haya forma de escapar por URL directa.
function KioskRedirect({ children }: { children: React.ReactNode }) {
  const { isKiosk, kioskLoading } = useKiosk();
  const loc = useLocation();

  if (kioskLoading) return null;
  if (isKiosk && loc.pathname !== '/app/atencion') {
    return <Navigate to="/app/atencion" replace />;
  }
  return <>{children}</>;
}

function Guard({
  perm,
  anyOf,
  denyAtilioVarela,
  children,
}: {
  perm?: string;
  anyOf?: string[];
  denyAtilioVarela?: boolean;
  children: React.ReactNode;
}) {
  const { hasPerm, session } = useAuth();

  const ok =
    (perm ? hasPerm(perm) : false) ||
    (Array.isArray(anyOf) ? anyOf.some(p => hasPerm(p)) : false);

  if (!ok || (denyAtilioVarela && isAtilioVarelaUser(session?.user))) {
    return <Navigate to="/app/forbidden" replace />;
  }
  return <>{children}</>;
}

function SetKioskRoute({ lock }: { lock: boolean }) {
  setKioskManual(lock);
  return <Navigate to={lock ? '/gate' : '/gate'} replace />;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Routes>
            {/* KioskRedirect envuelve todas las rutas privadas */}
            <Route path="/gate" element={<GatePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/solicitar-acceso" element={<SolicitarAccesoPage />} />

            {/* Base mínima */}
            <Route
              path="/app"
              element={
                <Private>
                  <Guard perm="api:access">
                    <DashboardPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/info"
              element={
                <Private>
                  <Guard perm="api:access">
                    <GestionUsuarioPage initialTab="informacion" />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/mi-cuenta"
              element={
                <Private>
                  <Guard perm="api:access">
                    <GestionUsuarioPage />
                  </Guard>
                </Private>
              }
            />

            {/* Gestión / documentos / tablas */}
            <Route
              path="/app/gestion"
              element={
                <Private>
                  <Guard anyOf={['crud:agentexdni1:read', 'crud:*:*']}>
                    <GestionPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/documents"
              element={
                <Private>
                  <Guard anyOf={['documents:read', 'crud:*:*']}>
                    <DocumentsPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/documentos"
              element={
                <Private>
                  <Guard anyOf={['documents:read', 'crud:*:*']}>
                    <DocumentosPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/tramites-documentales"
              element={
                <Private>
                  <Guard anyOf={['documents:read', 'crud:*:*']}>
                    <TramitesDocumentalesPage />
                  </Guard>
                </Private>
              }
            />
            <Route path="/app/nombramiento" element={<Navigate to="/app/tramites-documentales" replace />} />
            <Route
              path="/app/tables"
              element={
                <Private>
                  <Guard anyOf={['crud:*:read', 'crud:*:*']}>
                    <GestionUsuarioPage initialTab="tablas" />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/tables/:table"
              element={
                <Private>
                  <Guard anyOf={['crud:*:read', 'crud:*:*']}>
                    <TableViewPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/pedidos"
              element={
                <Private>
                  <Guard anyOf={['crud:pedidos:read', 'crud:*:read', 'crud:*:*']}>
                    <PedidosPage />
                  </Guard>
                </Private>
              }
            />

            {/* Salud laboral separado de embarazadas */}
            <Route
              path="/app/salud-laboral"
              element={
                <Private>
                  <Guard anyOf={['crud:reconocimientos_medicos:read', 'crud:examen_anual:read', 'crud:*:*']}>
                    <SaludLaboralPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/embarazadas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <EmbarazadasPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/guarderia"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <GuarderiaPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/residentes-rotacion"
              element={
                <Private>
                  <Guard anyOf={['crud:residentes_rotacion:read', 'crud:*:*']} denyAtilioVarela>
                    <ResidentesRotacionPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/residentes"
              element={
                <Private>
                  <Guard anyOf={['app:residentes:access', 'crud:*:*']}>
                    <ResidentesPage />
                  </Guard>
                </Private>
              }
            />

            {/* Alta / admin */}
            <Route
              path="/app/carga-agente"
              element={
                <Private>
                  <Guard anyOf={['personal:write', 'crud:*:*']}>
                    <CargaAgentePage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/admin"
              element={
                <Private>
                  <Guard anyOf={['usuarios:write', 'crud:*:*']}>
                    <AdminPage />
                  </Guard>
                </Private>
              }
            />

            {/* Módulos todavía sin permiso fino claro: por seguridad, solo admin */}
            <Route
              path="/app/consultas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <ConsultasPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/reportes"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <ReportesPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/redaccion"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <RedaccionPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/estadisticas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <EstadisticasPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/organigrama"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <OrganigramaPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/comparador"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <ComparadorPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/comparador-siape"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <ComparadorSiapePage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/legajo"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <LegajoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/alertas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <AlertasPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/buscador"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <BuscadorPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/asistencia"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <AsistenciaPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/atencion"
              element={
                <Private>
                  <Guard anyOf={['app:atencion:access', 'crud:*:*']}>
                    <AtencionPublicoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/samo"
              element={
                <Private>
                  <Guard anyOf={['app:samo:access', 'crud:*:*']}>
                    <SamoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/resoluciones"
              element={
                <Private>
                  <Guard anyOf={['crud:resoluciones:read', 'crud:*:*']}>
                    <ResolucionesPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/fichero"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <FicheroPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/ausencias-fichajes"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <AusenciasConFichajesPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/sin-fichaje-salida"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <SinFichajeSalidaPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/escaneo"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <EscaneoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/escaneo-agente/:dni"
              element={
                <Private>
                  <Guard anyOf={['crud:*:read', 'crud:*:*']}>
                    <EscaneoAgentePage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/agentes-servicios"
              element={
                <Private>
                 <Guard perm="crud:*:*">
                  <AgentesServiciosPage />
                 </Guard>
               </Private>
              }
             />

             <Route 
                path="/app/citaciones" 
                element={
                  <Private>
                   <Guard perm="crud:*:*">
                     <CitacionesPage />
                   </Guard>
                  </Private>
                }
               />
             
   <Route
  path="/app/mi-sector"
  element={
    <Private>
      <Guard anyOf={['app:jefe_servicio:access', 'crud:*:*']}>
        <JefeServicioPage />
      </Guard>
    </Private>
  }
/>

            <Route
              path="/app/examen-ingreso"
              element={
                <Private>
                  <Guard anyOf={['app:gestion_turnos:access', 'crud:*:*']}>
                    <ExamenIngresoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/infectologia"
              element={
                <Private>
                  <Guard anyOf={['app:infectologia:access', 'app:cargainfecto:access', 'crud:*:*']}>
                    <AccidentesPunzoPage />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/bajas-estructura"
              element={
                <Private>
                  <Guard anyOf={['crud:agentexdni1:read', 'crud:*:*']}>
                    <BajasGestionPage initialSection="estructura" />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/bajas-gestion"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <BajasGestionPage />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/historial-estructura"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <HistorialEstructuraPage />
                  </Guard>
                </Private>
              }
            />

            {/* Alertas por agente (RRHH) */}
            <Route
              path="/app/alertas-agente"
              element={
                <Private>
                  <Guard anyOf={['crud:alertas_agente:read', 'crud:*:*']}>
                    <AlertasAgentePage />
                  </Guard>
                </Private>
              }
            />

            {/* Estructura organizacional */}
            <Route
              path="/app/estructura"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <EstructuraPage />
                  </Guard>
                </Private>
              }
            />

            {/* Jubilación IPS */}
            <Route
              path="/app/herramientas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <HerramientasPage />
                  </Guard>
                </Private>
              }
            />
            {/* Director Ejecutivo */}
            <Route
              path="/app/director"
              element={
                <Private>
                  <Guard perm="app:director_ejecutivo:access">
                    <DirectorEjecutivoPage />
                  </Guard>
                </Private>
              }
            />
            {/* Concursos Ley 10471 */}
            <Route
              path="/app/concursos"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <ConcursosPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/stress-alertas"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <StressAlertasPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/reporte-servicio"
              element={
                <Private>
                  <Guard anyOf={['crud:asistencia:read', 'crud:*:*']}>
                    <ReporteAsistenciaServicioPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/presentes-turno"
              element={
                <Private>
                  <Guard anyOf={['crud:asistencia:read', 'crud:*:*']}>
                    <PresentesTurnoPage />
                  </Guard>
                </Private>
              }
            />
            <Route
              path="/app/jefedeptos"
              element={
                <Private>
                  <Guard anyOf={['crud:jefedeptos:read', 'crud:*:*']}>
                    <JefedeptosPage />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/licencias-pendientes"
              element={
                <Private>
                  <Guard perm="crud:*:*">
                    <StressAlertasPage initialSection="licencias" />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/fc-cert-reemplazos"
              element={
                <Private>
                  <Guard anyOf={['crud:fc_cert_reemplazos:read', 'crud:*:*']}>
                    <FcCertReemplazosPage />
                  </Guard>
                </Private>
              }
            />

            <Route
              path="/app/becarios-art"
              element={
                <Private>
                  <Guard anyOf={['crud:becarios_art:read', 'crud:*:*']}>
                    <BecariosArtPage />
                  </Guard>
                </Private>
              }
            />

            {/* Misc */}
            <Route path="/app/forbidden" element={<Private><ForbiddenPage /></Private>} />
            <Route path="/" element={<Navigate to="/gate" replace />} />

            {/* Activación/desactivación manual de modo kiosco para PCs con IP dinámica */}
            <Route path="/set-kiosk" element={<SetKioskRoute lock />} />
            <Route path="/unset-kiosk" element={<SetKioskRoute lock={false} />} />

            <Route path="*" element={<Navigate to="/gate" replace />} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}
