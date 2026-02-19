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
import { RequirePermission } from '../auth/RequirePermission';
import { ForbiddenPage } from '../pages/ForbiddenPage';

function Private({ children }: { children: React.ReactNode }) {
  const { session, isReady } = useAuth();
  const loc = useLocation();
  if (!isReady) return null;
  if (!session) return <Navigate to="/gate" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

function AppGuard({ children }: { children: React.ReactNode }) {
  // permiso base del backend (deny-by-default global)
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

            <Route
              path="/app"
              element={
                <Private>
                  <AppGuard>
                    <DashboardPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/documents"
              element={
                <Private>
                  <AppGuard>
                    <DocumentsPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/tables"
              element={
                <Private>
                  <AppGuard>
                    <TablesPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/tables/:table"
              element={
                <Private>
                  <AppGuard>
                    <TableViewPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/info"
              element={
                <Private>
                  <AppGuard>
                    <InfoPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/gestion"
              element={
                <Private>
                  <AppGuard>
                    <GestionPage />
                  </AppGuard>
                </Private>
              }
            />

            <Route
              path="/app/forbidden"
              element={
                <Private>
                  <ForbiddenPage />
                </Private>
              }
            />

            <Route
              path="/app/admin"
              element={
                <Private>
                  <AdminPage />
                </Private>
              }
            />

            <Route path="/" element={<Navigate to="/gate" replace />} />
            <Route path="*" element={<Navigate to="/gate" replace />} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}
