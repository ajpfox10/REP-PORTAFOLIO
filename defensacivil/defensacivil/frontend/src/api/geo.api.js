import api from './axios';

export const geoApi = {
  getProvinces:      ()              => api.get('/geo/provinces'),
  getPartidos:       (provinceId)    => api.get(`/geo/provinces/${provinceId}/partidos`),
  getLocalities:     (partidoId)     => api.get(`/geo/partidos/${partidoId}/localities`),
  getIncidentTypes:  ()              => api.get('/geo/incident-types'),

  // Infrastructure points
  getInfrastructure:    (params = {}) => api.get('/geo/infrastructure',     { params }),
  createInfrastructure: (data)        => api.post('/geo/infrastructure',    data),
  updateInfrastructure: (id, data)    => api.put(`/geo/infrastructure/${id}`, data),
  deleteInfrastructure: (id)          => api.delete(`/geo/infrastructure/${id}`),

  // Police stations
  getPoliceStations:    (provinceId)  => api.get('/geo/police-stations',    { params: { province_id: provinceId } }),
  createPoliceStation:  (data)        => api.post('/geo/police-stations',   data),
  updatePoliceStation:  (id, data)    => api.put(`/geo/police-stations/${id}`, data),
  deletePoliceStation:  (id)          => api.delete(`/geo/police-stations/${id}`),
};
