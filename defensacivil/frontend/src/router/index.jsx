import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import Layout from '../components/layout/Layout';
import LoadingScreen from '../components/common/LoadingScreen';
import { Loading } from '../components/common/ui';
import Login from '../pages/Login';
import NotFound from '../pages/NotFound';

// Las pantallas con mapas pesan más: se cargan recién cuando se visitan
const Dashboard          = lazy(() => import('../pages/Dashboard'));
const IncidentList       = lazy(() => import('../pages/IncidentList'));
const IncidentDetail     = lazy(() => import('../pages/IncidentDetail'));
const IncidentCreate     = lazy(() => import('../pages/IncidentCreate'));
const IncidentEdit       = lazy(() => import('../pages/IncidentEdit'));
const MapView            = lazy(() => import('../pages/MapView'));
const FloodView          = lazy(() => import('../pages/FloodView'));
const InfrastructureView = lazy(() => import('../pages/InfrastructureView'));
const CargaTelefonista   = lazy(() => import('../pages/CargaTelefonista'));
const CargaChofer        = lazy(() => import('../pages/CargaChofer'));
const UserList           = lazy(() => import('../pages/UserList'));
const UserForm           = lazy(() => import('../pages/UserForm'));
const AuditLog           = lazy(() => import('../pages/AuditLog'));

function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireRole({ roles, children }) {
  const role = useAuthStore(s => s.user?.role);
  if (!roles.includes(role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

const page = el => <Suspense fallback={<div className="page"><Loading /></div>}>{el}</Suspense>;

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"            element={page(<Dashboard />)} />
        <Route path="incidents"            element={page(<IncidentList />)} />
        <Route path="incidents/new"        element={page(<RequireRole roles={['admin', 'medium', 'telefonista']}><IncidentCreate /></RequireRole>)} />
        <Route path="incidents/:uuid"      element={page(<IncidentDetail />)} />
        <Route path="incidents/:uuid/edit" element={page(<RequireRole roles={['admin', 'medium', 'telefonista']}><IncidentEdit /></RequireRole>)} />
        <Route path="mapa"                 element={page(<MapView />)} />
        <Route path="inundaciones"         element={page(<FloodView />)} />
        <Route path="infraestructura"      element={page(<InfrastructureView />)} />
        <Route path="telefonista"          element={page(<RequireRole roles={['admin', 'telefonista']}><CargaTelefonista /></RequireRole>)} />
        <Route path="chofer"               element={page(<RequireRole roles={['admin', 'chofer']}><CargaChofer /></RequireRole>)} />
        <Route path="usuarios"             element={page(<RequireRole roles={['admin']}><UserList /></RequireRole>)} />
        <Route path="usuarios/nuevo"       element={page(<RequireRole roles={['admin']}><UserForm /></RequireRole>)} />
        <Route path="usuarios/:uuid/editar" element={page(<RequireRole roles={['admin']}><UserForm /></RequireRole>)} />
        <Route path="auditoria"            element={page(<RequireRole roles={['admin']}><AuditLog /></RequireRole>)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
