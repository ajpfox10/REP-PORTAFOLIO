import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ToastProvider } from './toast';
import { GatePage } from '../pages/GatePage';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { TablesPage } from '../pages/TablesPage';
import { TableViewPage } from '../pages/TableViewPage';
import { InfoPage } from '../pages/InfoPage';
import {GestionPage}  from "../pages/GestionPage";

function Private({ children }: { children: React.ReactNode }) {
  const { session, isReady } = useAuth();
  const loc = useLocation();
  if (!isReady) return null;
  if (!session) return <Navigate to="/gate" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/gate" element={<GatePage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/app"
            element={
              <Private>
                <DashboardPage />
              </Private>
            }
          />

          <Route
            path="/app/documents"
            element={
              <Private>
                <DocumentsPage />
              </Private>
            }
          />

          <Route
            path="/app/tables"
            element={
              <Private>
                <TablesPage />
              </Private>
            }
          />

          <Route
            path="/app/tables/:table"
            element={
              <Private>
                <TableViewPage />
              </Private>
            }
          />

          <Route path="/app/info" element={<Private><InfoPage /></Private>} />
          <Route path="/" element={<Navigate to="/gate" replace />} />
          <Route path="*" element={<Navigate to="/gate" replace />} />
          <Route
            path="/app/gestion"
            element={
              <Private>
                <GestionPage />
              </Private>
            }
          />

        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
