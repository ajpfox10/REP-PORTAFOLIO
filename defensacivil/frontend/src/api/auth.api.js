import api from './axios';

export const authApi = {
  login:          (username, password) => api.post('/auth/login', { username, password }),
  logout:         ()                   => api.post('/auth/logout'),
  me:             ()                   => api.get('/auth/me'),
  changePassword: data                 => api.put('/auth/change-password', data),
};
