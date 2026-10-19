import axios from 'axios';

// El access token vive solo en memoria: no queda en localStorage ni en
// sessionStorage, donde un script inyectado podría leerlo. La sesión se
// recupera al recargar gracias a la cookie httpOnly de refresh.
let accessToken = null;
export const setAccessToken = token => { accessToken = token; };

const baseURL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(config => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Una sola renovación en curso: si varias solicitudes vencen a la vez, todas
// esperan la misma. Dos renovaciones simultáneas con la misma cookie harían
// que el servidor la tome como robada y cierre la sesión.
let refreshing = null;
let onSessionExpired = () => {};
export const setSessionExpiredHandler = fn => { onSessionExpired = fn; };

export function refreshSession() {
  if (!refreshing) {
    refreshing = axios.post(`${baseURL}/auth/refresh`, null, { withCredentials: true, timeout: 15000 })
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && err.response.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const { accessToken: token } = await refreshSession();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshErr) {
        setAccessToken(null);
        onSessionExpired();
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
