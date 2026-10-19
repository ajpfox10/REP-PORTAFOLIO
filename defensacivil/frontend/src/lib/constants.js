export const STATUSES = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO', 'CERRADO', 'CANCELADO'];
export const ACTIVE_STATUSES = ['RECIBIDO', 'EN_CAMINO', 'EN_ESCENA', 'CONTROLADO'];

export const STATUS_LABELS = {
  RECIBIDO:   'Recibido',
  EN_CAMINO:  'En camino',
  EN_ESCENA:  'En escena',
  CONTROLADO: 'Controlado',
  CERRADO:    'Cerrado',
  CANCELADO:  'Cancelado',
};

// Colores de estado para los mapas (en sintonía con los tokens CSS --st-*)
export const STATUS_COLORS = {
  RECIBIDO:   '#2563eb',
  EN_CAMINO:  '#d97706',
  EN_ESCENA:  '#c62828',
  CONTROLADO: '#7c3aed',
  CERRADO:    '#17803d',
  CANCELADO:  '#64748b',
};

export const PRIORITIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
export const PRIORITY_LABELS = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' };

export const ROLES = ['admin', 'medium', 'telefonista', 'chofer', 'read'];
export const ROLE_LABELS = {
  admin:       'Administrador',
  medium:      'Operador',
  read:        'Lector',
  telefonista: 'Telefonista',
  chofer:      'Chofer',
};
export const ROLE_DESCRIPTIONS = {
  admin:       'Acceso completo, usuarios y auditoría',
  medium:      'Carga y edita sus propios incidentes',
  telefonista: 'Registra llamadas entrantes en el mapa',
  chofer:      'Informa estado y ubicación desde el lugar',
  read:        'Solo consulta',
};

export const UNIT_TYPES = ['BOMBEROS', 'POLICIA', 'AMBULANCIA', 'DEFENSA_CIVIL', 'RESCATE', 'GENDARMERIA', 'PREFECTURA', 'EJERCITO', 'CRUZ_ROJA', 'OTRO'];
export const UNIT_LABELS = {
  BOMBEROS: 'Bomberos', POLICIA: 'Policía', AMBULANCIA: 'Ambulancia', DEFENSA_CIVIL: 'Defensa Civil',
  RESCATE: 'Rescate', GENDARMERIA: 'Gendarmería', PREFECTURA: 'Prefectura', EJERCITO: 'Ejército',
  CRUZ_ROJA: 'Cruz Roja', OTRO: 'Otro',
};

export const RESOURCE_TYPES = ['VEHICULO', 'EQUIPO', 'MATERIAL', 'HERRAMIENTA', 'OTRO'];
export const RESOURCE_LABELS = { VEHICULO: 'Vehículo', EQUIPO: 'Equipo', MATERIAL: 'Material', HERRAMIENTA: 'Herramienta', OTRO: 'Otro' };

export const INFRA_TYPES = ['HOSPITAL', 'SALITA', 'BOMBEROS', 'SAME', 'DEFENSA_CIVIL', 'CUARTEL_GN', 'OTRO'];
export const INFRA_LABELS = {
  HOSPITAL: 'Hospital', SALITA: 'Centro de salud', BOMBEROS: 'Bomberos', SAME: 'SAME',
  DEFENSA_CIVIL: 'Base Defensa Civil', CUARTEL_GN: 'Gendarmería', OTRO: 'Otro',
};
export const INFRA_COLORS = {
  HOSPITAL: '#c62828', SALITA: '#db2777', BOMBEROS: '#ea580c', SAME: '#0891b2',
  DEFENSA_CIVIL: '#1f56c4', CUARTEL_GN: '#4d7c0f', OTRO: '#64748b',
};

export const ACTION_LABELS = {
  LOGIN: 'Inicio de sesión', CHANGE_PASSWORD: 'Cambio de contraseña',
  CREATE_INCIDENT: 'Alta de incidente', UPDATE_INCIDENT: 'Edición de incidente',
  DELETE_INCIDENT: 'Baja de incidente', STATUS_CHANGE: 'Cambio de estado', FIELD_NOTE: 'Novedad de campo',
  CREATE_USER: 'Alta de usuario', UPDATE_USER: 'Edición de usuario',
  RESET_PASSWORD: 'Contraseña restablecida', TOGGLE_USER: 'Usuario activado/desactivado',
  CREATE_INFRA: 'Alta de infraestructura', UPDATE_INFRA: 'Edición de infraestructura', DELETE_INFRA: 'Baja de infraestructura',
  CREATE_STATION: 'Alta de comisaría', UPDATE_STATION: 'Edición de comisaría', DELETE_STATION: 'Baja de comisaría',
};

export const DEFAULT_CENTER = [-34.68, -58.52]; // AMBA
