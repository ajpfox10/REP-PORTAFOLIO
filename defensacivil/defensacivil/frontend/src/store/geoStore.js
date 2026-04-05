import { create } from 'zustand';
import { geoApi } from '../api/geo.api';

const useGeoStore = create((set, get) => ({
  provinces:      [],
  partidos:       {},
  localities:     {},
  policeStations: [],
  incidentTypes:  [],
  infrastructure: [],

  fetchProvinces: async () => {
    if (get().provinces.length) return;
    try {
      const { data } = await geoApi.getProvinces();
      set({ provinces: data });
    } catch {/* ignore */}
  },

  fetchPartidos: async (provinceId) => {
    if (get().partidos[provinceId]) return;
    try {
      const { data } = await geoApi.getPartidos(provinceId);
      set(s => ({ partidos: { ...s.partidos, [provinceId]: data } }));
    } catch {/* ignore */}
  },

  fetchLocalities: async (partidoId) => {
    if (get().localities[partidoId]) return;
    try {
      const { data } = await geoApi.getLocalities(partidoId);
      set(s => ({ localities: { ...s.localities, [partidoId]: data } }));
    } catch {/* ignore */}
  },

  fetchPoliceStations: async (provinceId) => {
    try {
      const { data } = await geoApi.getPoliceStations(provinceId);
      set({ policeStations: data });
    } catch {/* ignore */}
  },

  fetchIncidentTypes: async () => {
    if (get().incidentTypes.length) return;
    try {
      const { data } = await geoApi.getIncidentTypes();
      set({ incidentTypes: data });
    } catch {/* ignore */}
  },

  fetchInfrastructure: async (params = {}) => {
    try {
      const { data } = await geoApi.getInfrastructure(params);
      set({ infrastructure: data });
    } catch {/* ignore */}
  },
}));

export default useGeoStore;
