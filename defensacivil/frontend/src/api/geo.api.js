import api from './axios';

export const geoApi = {
  getProvinces:      ()              => api.get('/geo/provinces'),
  getPartidos:       (provinceId)    => api.get(`/geo/provinces/${provinceId}/partidos`),
  getLocalities:     (partidoId)     => api.get(`/geo/partidos/${partidoId}/localities`),
  getPoliceStations: (provinceId)    => api.get('/geo/police-stations', { params: { province_id: provinceId } }),
  getIncidentTypes:  ()              => api.get('/geo/incident-types'),
  getInfrastructure: (params = {})   => api.get('/geo/infrastructure', { params }),
};
