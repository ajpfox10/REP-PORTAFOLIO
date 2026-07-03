export interface AdmsStatus {
  database: string;
  host: string;
  port: number;
  tables: { name: string; exists: boolean; approxRows: number | null }[];
  summary: {
    dispositivos?: number;
    personas?: number;
    fichadas?: number;
    comandosPendientes?: number;
    primeraFichada?: string | null;
    ultimaFichada?: string | null;
  };
}

export interface AdmsDispositivo {
  sn: string;
  alias: string;
  ip: string | null;
  estado: 'online' | 'offline' | 'pausado';
  admsEstado?: 'online' | 'offline' | 'pausado';
  tcpOnline?: boolean | null;
  tcpLatencyMs?: number | null;
  protocolOnline?: boolean | null;
  protocolLatencyMs?: number | null;
  protocolError?: string | null;
  lastActivity: string | null;
  segundosSinActividad: number | null;
  firmware: string | null;
  usuarios: number | null;
  huellas: number | null;
  fichadas: number | null;
  pushVersion: string | number | null;
}

export interface AdmsDeviceStructure {
  id?: number;
  sn: string;
  reparticion_id: number | null;
  reparticion_nombre: string | null;
  servicio_id?: number | null;
  servicio_nombre?: string | null;
  sector_id?: number | null;
  sector_nombre?: string | null;
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
}

export interface AdmsDeviceHistory {
  sn: string;
  alias: string;
  ip: string | null;
  state: number;
  deleted: boolean;
  lastActivity: string | null;
  usuarios: number | null;
  huellas: number | null;
  fichadas: number | null;
  estructura: AdmsDeviceStructure | null;
}

export interface AdmsFichada {
  id: number;
  dni: string;
  nombre: string;
  fechaHora: string;
  tipo: 'entrada' | 'salida';
  checktype: string | number;
  verifycode: string | number | null;
  sn: string | null;
}

export interface AdmsFichadasFilters {
  desde: string;
  hasta: string;
  dni: string;
  sn: string;
  tipo: string;
}

export interface AdmsSyncReglas {
  servicios: Record<string, string[]>;
}

export interface AdmsPingResult {
  sn: string;
  alias: string;
  ip: string | null;
  tcpOnline: boolean | null;
  protocolOnline?: boolean | null;
  latencyMs: number | null;
  protocolLatencyMs?: number | null;
  portOpen?: boolean | null;
  error?: string | null;
  message?: string;
}

export interface AdmsBiotemplate {
  id: number;
  dni: string;
  nombre: string;
  bioType: number;
  bioTypeName: string;
  index: number;
  valid: number;
  size: number;
  majorVer: number;
  minorVer: number;
  sn: string | null;
  utime: string | null;
}

export interface AdmsPullFichadasResult {
  sn: string;
  desde: string;
  hasta: string;
  totalReloj: number;
  enRango: number;
  insertadas: number;
  duplicadas: number;
}

export interface AdmsPersona {
  userid: number;
  dni: string;
  nombre: string;
  departamentoId: number | null;
  tarjeta: string | null;
  privilegio: number | null;
  grupo: number | null;
  zonas: string | null;
  sn: string | null;
  actualizado: string | null;
}

export interface AdmsComando {
  id: number;
  sn: string;
  alias: string;
  contenido: string;
  creado: string | null;
  enviado: string | null;
  finalizado: string | null;
  retorno: number | null;
  estado: 'pendiente' | 'enviado' | 'finalizado' | 'error' | 'vencido';
}

export interface AdmsComandosFilters {
  sn: string;
  estado: 'todos' | 'pendientes' | 'enviados' | 'finalizados' | 'errores' | 'vencidos';
}

export interface AdmsCruces {
  sn?: string | null;
  estructura?: AdmsDeviceStructure | null;
  totalPersonal: number;
  totalAdms: number;
  coincidencias: number;
  soloAdmsTotal: number;
  soloPersonalTotal: number;
  limit: number;
  soloAdms: { userid: number; dni: string; nombre: string }[];
  soloPersonal: { dni: string; nombre: string }[];
}

export interface AdmsSyncPreview {
  target: {
    sn: string | null;
    dispositivos: { sn: string; alias: string }[];
  };
  resumen: {
    personal: number;
    adms: number;
    dispositivos: number;
    crear: number;
    actualizar: number;
    soloAdms: number;
    bajas: number;
    comandosEstimados: number;
    comandosBajaEstimados: number;
  };
  filtros: {
    servicioId: number | null;
    soloActivos: boolean;
    options: { privilege: number; group: number; timezone: string; cardSource: 'none' | 'dni' | 'legajo' };
    reglasDestino?: string[];
  };
  crear: { dni: string; nombre: string; comandos: number }[];
  actualizar: { dni: string; actual: string; esperado: string; comandos: number }[];
  soloAdms: { userid: number; dni: string; nombre: string; comandos: number }[];
  limit: number;
}

export interface AdmsFingerprintRow {
  userid: number;
  dni: string;
  nombre: string;
  fingerId: number;
  version: string;
  size: number;
  compatible: { sn: string; alias: string; fpVersion: string; ok: boolean }[];
}

export type AdmsBiometricState = 'todos' | 'incompleto' | 'no_existe' | 'sin_biometria' | 'solo_huella' | 'solo_palma' | 'ambas';

export interface AdmsBiometricStatusRow {
  userid: number | null;
  dni: string;
  nombre: string;
  sn: string | null;
  existe: boolean;
  huellas: number;
  palmas: number;
  estado: Exclude<AdmsBiometricState, 'todos' | 'incompleto'>;
}

export interface AdmsBiometricStatusResult {
  alcance: 'general' | 'fichero';
  sn: string | null;
  estado: AdmsBiometricState;
  total: number;
  limit: number;
  offset: number;
  resumen: {
    total: number;
    noExiste: number;
    sinBiometria: number;
    soloHuella: number;
    soloPalma: number;
    ambas: number;
  };
  data: AdmsBiometricStatusRow[];
}

export interface AdmsRuntimeEvent {
  ts: string;
  sn: string;
  endpoint: string;
  method: string;
  ip: string;
  ok: boolean;
  detail: string;
}

export interface AdmsRereadPreview {
  target: {
    sn: string;
    alias: string;
    lastActivity: string | null;
    transactionCount: number | null;
    pushVersion: string | number | null;
  };
  rango: { desde: string; hasta: string };
  stamp: { actual: number; propuesto: number; margen: number };
  db: {
    totalEnRango: number;
    primera: string | null;
    ultima: string | null;
    muestras: { dni: string; nombre: string; fechaHora: string; tipo: string; verifycode: string | number | null }[];
  };
  advertencia: string;
}

export interface AdmsDeleteAttlogPreview {
  target: {
    sn: string;
    alias: string;
    lastActivity: string | null;
    transactionCount: number | string | null;
    pushVersion: string | number | null;
  };
  filtros: {
    sn: string;
    desde: string;
    hasta: string;
    dni: string | null;
    tipo: string | null;
  };
  db: {
    totalEnRango: number;
    primera: string | null;
    ultima: string | null;
    muestras: {
      dni: string;
      nombre: string;
      fechaHora: string;
      tipo: 'entrada' | 'salida';
      verifycode: string | number | null;
    }[];
  };
  advertencia: string;
}

export interface AdmsClockCrossRow {
  dni: string;
  nombre: string;
  servicioId: number | null;
  servicioNombre: string | null;
  marcasA: number;
  marcasB: number;
  primeraA: string | null;
  ultimaA: string | null;
  primeraB: string | null;
  ultimaB: string | null;
}

export interface AdmsClockCross {
  rango: { desde: string; hasta: string };
  relojes: { a: { sn: string; alias: string }; b: { sn: string; alias: string } };
  filtros: { servicioId: number | null; soloActivos: boolean };
  resumen: { activos: number; soloA: number; soloB: number; ambos: number; ninguno: number };
  soloA: AdmsClockCrossRow[];
  soloB: AdmsClockCrossRow[];
  ambos: AdmsClockCrossRow[];
  ninguno: AdmsClockCrossRow[];
  limit: number;
}

export interface AdmsMessageAgent {
  dni: string;
  nombre: string;
  legajo: string | number | null;
  servicioId: number | null;
  servicioNombre: string | null;
}

export interface AdmsMessagePreview {
  sn: string;
  dni: string;
  formato: 'privado' | 'idle' | 'legacy';
  plantilla: string;
  mensaje: string;
  inicio: string;
  minutos: number;
  tipo: string;
  comando: string;
  comandos: string[];
  agente: AdmsMessageAgent & { registradoAdms: boolean };
  reloj: { sn: string; alias: string };
}

export interface AdmsAudioFile {
  id: string;
  nombre: string;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface AdmsAudioRule {
  id: string;
  nombre: string;
  evento: 'entrada' | 'salida' | 'fichada';
  sn: string | null;
  dni: string | null;
  audioId: string;
  activo: boolean;
  volumen: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdmsAudioEvent {
  id: string;
  ts: string;
  evento: 'entrada' | 'salida' | 'fichada';
  sn: string;
  dni: string;
  nombre: string;
  checktime: string;
  audioId: string | null;
  audioUrl: string | null;
  reglaId: string | null;
  volumen: number;
}
