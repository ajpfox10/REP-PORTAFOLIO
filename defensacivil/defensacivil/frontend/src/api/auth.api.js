import api from './axios';

export const authApi = {
  login:          (username, password)  => api.post('/auth/login', { username, password }),
  refresh:        (refreshToken)        => api.post('/auth/refresh', { refreshToken }),
  logout:         (refreshToken)        => api.post('/auth/logout', { refreshToken }),
  me:             ()                    => api.get('/auth/me'),
  changePassword: (data)               => api.put('/auth/change-password', data),
};
