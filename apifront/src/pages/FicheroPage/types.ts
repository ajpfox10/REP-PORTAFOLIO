export interface FicheroConfig {
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPass: string;
  mysqlDb: string;
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  sftpPass: string;
  sftpDir: string;
  sftpLocalAddr: string;
  outputDir: string;
  prefijo: string;
  sufijo: string;
  limite: number;
  intervaloMin: number;
  modoContinu: boolean;
  fechaDesdeContinu: string | null;
  horaDesdeContinu: string | null;
  continuoModo: 'todos' | 'uno' | 'grupo';
  continuoSn: string | null;
  continuoSns: string[];
}

export interface LogEntry {
  fechaCreacion: string;
  nombreArchivo: string;
  fechaSubida: string;
  exitoso: boolean;
  error: string;
  rangoDesde?: string;
  rangoHasta?: string;
  registros?: number;
}

export interface EstadoFichero {
  corriendo: boolean;
  redCaida: boolean;
  total: number;
  exitosos: number;
  fallidos: number;
  primerArchivo: string | null;
  ultimoArchivo: string | null;
  ultimaSubidaExitosa: string | null;
  intervaloMin: number | null;
  proximaEjecucionMs: number | null;
  entradas: LogEntry[];
}

export interface DbPreview {
  columna: { COLUMN_TYPE: string; COLUMN_NAME: string } | null;
  minFecha: string | null;
  maxFecha: string | null;
  muestras: { badgenumber: string; checktime: string; checktype: number; name: string }[];
}

export interface Dispositivo {
  sn: string;
  alias: string;
  lastActivity: string | null;
  segundosSinActividad: number | null;
  estado: 'online' | 'offline' | 'pausado';
  admsEstado?: 'online' | 'offline' | 'pausado';
  protocolOnline?: boolean | null;
  protocolLatencyMs?: number | null;
  protocolError?: string | null;
  portOpen?: boolean | null;
  tcpOnline?: boolean | null;
  tcpLatencyMs?: number | null;
  ip: string | null;
}

export interface ExportarRangoPayload {
  fechaDesde: string;
  fechaHasta: string;
  horaDesde: string;
  horaHasta: string;
  sn?: string | null;
  sns?: string[] | null;
}

export interface ExportarRangoResult {
  ok: boolean;
  registros: number;
  archivo: string;
  sn?: string | null;
  alias?: string | null;
  error?: string;
}
