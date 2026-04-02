import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import Layout       from '../components/layout/Layout';

import Login          from '../pages/Login';
import Dashboard      from '../pages/Dashboard';
import IncidentList   from '../pages/IncidentList';
import IncidentDetail from '../pages/IncidentDetail';
import IncidentCreate from '../pages/IncidentCreate';
import IncidentEdit   from '../pages/IncidentEdit';
import MapView        from '../pages/MapView';
import UserList       from '../pages/UserList';
import UserCreate     from '../pages/UserCreate';
import UserEdit       from '../pages/UserEdit';
import AuditLog       from '../pages/AuditLog';
import NotFound       from '../pages/NotFound';
import LoadingScreen  from '../components/common/LoadingScreen';

function ProtectedRoute({ children, requiredRoles }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (requiredRoles && !requiredRoles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index                    element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"         element={<Dashboard />} />
        <Route path="incidents"         element={<IncidentList />} />
        <Route path="incidents/new"     element={<ProtectedRoute requiredRoles={['admin','medium']}><IncidentCreate /></ProtectedRoute>} />
        <Route path="incidents/:uuid"   element={<IncidentDetail />} />
        <Route path="incidents/:uuid/edit" element={<ProtectedRoute requiredRoles={['admin','medium']}><IncidentEdit /></ProtectedRoute>} />
        <Route path="mapa"              element={<MapView />} />
        <Route path="usuarios"          element={<ProtectedRoute requiredRoles={['admin']}><UserList /></ProtectedRoute>} />
        <Route path="usuarios/nuevo"    element={<ProtectedRoute requiredRoles={['admin']}><UserCreate /></ProtectedRoute>} />
        <Route path="usuarios/:uuid/editar" element={<ProtectedRoute requiredRoles={['admin']}><UserEdit /></ProtectedRoute>} />
        <Route path="auditoria"         element={<ProtectedRoute requiredRoles={['admin']}><AuditLog /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
