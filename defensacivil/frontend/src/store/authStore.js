import { create } from 'zustand';
import { authApi } from '../api/auth.api';

const useAuthStore = create((set, get) => ({
  user:            null,
  isAuthenticated: false,
  isLoading:       true,
  error:           null,

  initialize: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) { set({ isLoading: false }); return; }

    try {
      const { data } = await authApi.refresh(refreshToken);
      sessionStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch {
      sessionStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ isLoading: false });
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const { data } = await authApi.login(username, password);
      sessionStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      set({ user: data.user, isAuthenticated: true, error: null });
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al iniciar sesión';
      set({ error: msg });
      return false;
    }
  },

  logout: async () => {
    try {
      await authApi.logout(localStorage.getItem('refreshToken'));
    } catch {/* ignore */}
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    set({ user: null, isAuthenticated: false });
  },

  hasRole: (...roles) => roles.includes(get().user?.role),
  isAdmin:  () => get().user?.role === 'admin',
  canWrite: () => ['admin', 'medium'].includes(get().user?.role),
}));

export default useAuthStore;
