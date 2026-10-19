import { create } from 'zustand';
import { authApi } from '../api/auth.api';
import { refreshSession, setAccessToken, setSessionExpiredHandler } from '../api/axios';
import { apiError } from '../lib/format';

const WRITERS = ['admin', 'medium', 'telefonista', 'chofer'];

let initializing = null;

const useAuthStore = create((set, get) => ({
  user:            null,
  isAuthenticated: false,
  isLoading:       true,
  error:           null,

  // Recupera la sesión con la cookie httpOnly. Se comparte la promesa para que
  // el doble montaje de React en desarrollo no dispare dos renovaciones.
  initialize: () => {
    if (!initializing) {
      initializing = refreshSession()
        .then(data => set({ user: data.user, isAuthenticated: true, isLoading: false }))
        .catch(() => set({ user: null, isAuthenticated: false, isLoading: false }));
    }
    return initializing;
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const { data } = await authApi.login(username, password);
      setAccessToken(data.accessToken);
      set({ user: data.user, isAuthenticated: true, error: null });
      return true;
    } catch (err) {
      set({ error: apiError(err, 'No se pudo iniciar sesión') });
      return false;
    }
  },

  logout: async () => {
    try { await authApi.logout(); } catch { /* la sesión local se cierra igual */ }
    setAccessToken(null);
    set({ user: null, isAuthenticated: false });
  },

  // Cuando el servidor rechaza la renovación (sesión vencida o cerrada)
  expire: () => {
    setAccessToken(null);
    set({ user: null, isAuthenticated: false, error: 'Tu sesión venció. Ingresá nuevamente.' });
  },

  hasRole:       (...roles) => roles.includes(get().user?.role),
  isAdmin:       () => get().user?.role === 'admin',
  canWrite:      () => WRITERS.includes(get().user?.role),
  canEditGeo:    () => ['admin', 'medium'].includes(get().user?.role),
}));

setSessionExpiredHandler(() => useAuthStore.getState().expire());

export default useAuthStore;
