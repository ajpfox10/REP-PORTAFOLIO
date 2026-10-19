import { format, formatDistanceToNowStrict } from 'date-fns';
import { es } from 'date-fns/locale';

const toDate = v => (v instanceof Date ? v : new Date(v));

export const fmtDateTime = v => (v ? format(toDate(v), 'dd/MM/yyyy HH:mm', { locale: es }) : '—');
export const fmtShort    = v => (v ? format(toDate(v), 'dd/MM HH:mm', { locale: es }) : '—');
export const fmtDay      = v => (v ? format(toDate(v), "EEE d 'de' MMM", { locale: es }) : '—');
export const fmtAgo      = v => (v ? `hace ${formatDistanceToNowStrict(toDate(v), { locale: es })}` : '—');
export const fmtNumber   = n => new Intl.NumberFormat('es-AR').format(n ?? 0);
export const fmtCoords   = (lat, lng) => (lat != null && lng != null ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : '—');

export const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Mensaje legible a partir de un error de la API
export function apiError(err, fallback = 'Ocurrió un error inesperado') {
  const data = err?.response?.data;
  if (data?.errors?.length) return data.errors.map(e => e.message).join(' · ');
  if (data?.error) return data.error;
  if (err?.code === 'ECONNABORTED' || err?.message === 'Network Error') return 'No hay conexión con el servidor';
  return fallback;
}

// Errores de validación por campo, para mostrarlos debajo de cada input
export function fieldErrors(err) {
  return Object.fromEntries((err?.response?.data?.errors || []).map(e => [e.field, e.message]));
}
