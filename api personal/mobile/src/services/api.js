import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

const API_URL = 'http://localhost:3000/api/v1'; // Cambiar por IP real

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Interceptor para agregar token
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('@auth:token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor para manejar errores de autenticación
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('@auth:token');
      // Navegar a login (necesitarías navigation fuera de aquí)
    }
    return Promise.reject(error);
  }
);

export const login = async (email, password) => {
  try {
    const response = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user } = response.data.data;
    
    await AsyncStorage.setItem('@auth:token', accessToken);
    await AsyncStorage.setItem('@auth:refreshToken', refreshToken);
    await AsyncStorage.setItem('@auth:user', JSON.stringify(user));
    
    api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    
    return { success: true, user };
  } catch (error) {
    return { 
      success: false, 
      message: error.response?.data?.error || 'Error de conexión' 
    };
  }
};

export const logout = async () => {
  await AsyncStorage.removeItem('@auth:token');
  await AsyncStorage.removeItem('@auth:refreshToken');
  await AsyncStorage.removeItem('@auth:user');
  delete api.defaults.headers.common['Authorization'];
};

export const getDocuments = async (page = 1, limit = 20) => {
  const response = await api.get(`/documents?page=${page}&limit=${limit}`);
  return response.data;
};

export const getDocumentFile = (id) => `${API_URL}/documents/${id}/file`;

export const getEventos = async (dni) => {
  const response = await api.get(`/eventos/dni/${dni}`);
  return response.data;
};

export const getPersonal = async (dni) => {
  const response = await api.get(`/personal/search?dni=${dni}`);
  return response.data;
};

export const getTables = async () => {
  const response = await api.get('/tables');
  return response.data;
};

export default api;