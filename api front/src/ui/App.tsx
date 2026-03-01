// src/ui/App.tsx
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ToastProvider } from './toast';
import { ErrorBoundary } from './ErrorBoundary';
import { GatePage } from '../pages/GatePage';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { TablesPage } from '../pages/TablesPage';
import { TableViewPage } from '../pages/TableViewPage';
import { InfoPage } from '../pages/InfoPage';
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
import { LegajoPage } from '../pages/LegajoPage';
import { AlertasPage } from '../pages/AlertasPage';
import { BuscadorPage } from '../pages/BuscadorPage';
import { SolicitarAccesoPage } from '../pages/SolicitarAccesoPage';
import { RequirePermission } from '../auth/RequirePermission';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { GestionUsuarioPage } from '../pages/GestionUsuarioPage';
import { SaludLaboralPage } from '../pages/SaludLaboralPage';
import { EmbarazadasPage } from '../pages/EmbarazadasPage';

function Private({ children }: { children: React.ReactNode }) {
  const { session, isReady } = useAuth();
  const loc = useLocation();
  if (!isReady) return null;
  if (!session) return <Navigate to="/gate" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

function AppGuard({ children }: { children: React.ReactNode }) {
  return <RequirePermission perm="api:access">{children}</RequirePermission>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Routes>
            <Route path="/gate" element={<GatePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/solicitar-acceso" element={<SolicitarAccesoPage />} />

            {/* Core */}
            <Route path="/app" element={<Private><AppGuard><DashboardPage /></AppGuard></Private>} />
            <Route path="/app/gestion" element={<Private><AppGuard><GestionPage /></AppGuard></Private>} />
            <Route path="/app/documents" element={<Private><AppGuard><DocumentsPage /></AppGuard></Private>} />
            <Route path="/app/tables" element={<Private><AppGuard><TablesPage /></AppGuard></Private>} />
            <Route path="/app/tables/:table" element={<Private><AppGuard><TableViewPage /></AppGuard></Private>} />
            <Route path="/app/info" element={<Private><AppGuard><InfoPage /></AppGuard></Private>} />

            {/* Módulos standalone */}
            <Route path="/app/consultas" element={<Private><AppGuard><ConsultasPage /></AppGuard></Private>} />
            <Route path="/app/pedidos" element={<Private><AppGuard><PedidosPage /></AppGuard></Private>} />
            <Route path="/app/documentos" element={<Private><AppGuard><DocumentosPage /></AppGuard></Private>} />
            <Route path="/app/reportes" element={<Private><AppGuard><ReportesPage /></AppGuard></Private>} />
            <Route path="/app/redaccion" element={<Private><AppGuard><RedaccionPage /></AppGuard></Private>} />
            <Route path="/app/mi-cuenta" element={<Private><AppGuard><GestionUsuarioPage /></AppGuard></Private>} />
            {/* Nuevos módulos */}
            <Route path="/app/estadisticas" element={<Private><AppGuard><EstadisticasPage /></AppGuard></Private>} />
            <Route path="/app/organigrama" element={<Private><AppGuard><OrganigramaPage /></AppGuard></Private>} />
            <Route path="/app/comparador" element={<Private><AppGuard><ComparadorPage /></AppGuard></Private>} />
            <Route path="/app/legajo" element={<Private><AppGuard><LegajoPage /></AppGuard></Private>} />
            <Route path="/app/alertas" element={<Private><AppGuard><AlertasPage /></AppGuard></Private>} />
            <Route path="/app/buscador" element={<Private><AppGuard><BuscadorPage /></AppGuard></Private>} />            
            <Route path="/app/salud-laboral" element={<Private><AppGuard><SaludLaboralPage /></AppGuard></Private>} />
            <Route path="/app/embarazadas" element={<Private><AppGuard><EmbarazadasPage /></AppGuard></Private>} />

            {/* Alta de agentes */}
            <Route path="/app/carga-agente" element={<Private><AppGuard><CargaAgentePage /></AppGuard></Private>} />

            {/* Admin */}
            <Route path="/app/admin" element={<Private><AdminPage /></Private>} />

            {/* Misc */}
            <Route path="/app/forbidden" element={<Private><ForbiddenPage /></Private>} />
            <Route path="/" element={<Navigate to="/gate" replace />} />
            <Route path="*" element={<Navigate to="/gate" replace />} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}
