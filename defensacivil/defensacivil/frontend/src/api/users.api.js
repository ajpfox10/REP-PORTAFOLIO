import api from './axios';

export const usersApi = {
  getAll:       ()             => api.get('/users'),
  getOne:       (uuid)         => api.get(`/users/${uuid}`),
  create:       (data)         => api.post('/users', data),
  update:       (uuid, data)   => api.put(`/users/${uuid}`, data),
  resetPassword:(uuid, data)   => api.put(`/users/${uuid}/password`, data),
  toggleActive: (uuid)         => api.put(`/users/${uuid}/toggle-active`),
};
