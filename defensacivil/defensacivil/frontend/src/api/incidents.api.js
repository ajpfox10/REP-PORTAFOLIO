import api from './axios';

export const incidentsApi = {
  getAll:         (params)       => api.get('/incidents', { params }),
  getOne:         (uuid)         => api.get(`/incidents/${uuid}`),
  getMapPoints:   (params)       => api.get('/incidents/map', { params }),
  getDashboard:   ()             => api.get('/incidents/dashboard'),
  create:         (data)         => api.post('/incidents', data),
  update:         (uuid, data)   => api.put(`/incidents/${uuid}`, data),
  delete:         (uuid)         => api.delete(`/incidents/${uuid}`),

  addUnit:        (uuid, data)   => api.post(`/incidents/${uuid}/units`, data),
  removeUnit:     (uuid, unitId) => api.delete(`/incidents/${uuid}/units/${unitId}`),

  addResource:    (uuid, data)       => api.post(`/incidents/${uuid}/resources`, data),
  removeResource: (uuid, resourceId) => api.delete(`/incidents/${uuid}/resources/${resourceId}`),

  updateStatus:   (uuid, data)   => api.post(`/incidents/${uuid}/status`, data),
  getHistory:     (uuid)         => api.get(`/incidents/${uuid}/history`),
};
