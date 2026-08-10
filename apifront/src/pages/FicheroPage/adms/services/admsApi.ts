import { apiFetch, apiFetchBlob } from '../../../../api/http';
import type {
  AdmsAudioEvent,
  AdmsAudioFile,
  AdmsAudioRule,
  AdmsBiometricState,
  AdmsBiometricStatusResult,
  AdmsBiotemplate,
  AdmsComando,
  AdmsComandosFilters,
  AdmsClockCross,
  AdmsCruces,
  AdmsDispositivo,
  AdmsDeviceHistory,
  AdmsDeviceStructure,
  AdmsDeleteAttlogPreview,
  AdmsFichada,
  AdmsFichadasFilters,
  AdmsFingerprintRow,
  AdmsMessageAgent,
  AdmsMessagePreview,
  AdmsPersona,
  AdmsPingResult,
  AdmsPullFichadasResult,
  AdmsRereadPreview,
  AdmsRuntimeEvent,
  AdmsStatus,
  AdmsSyncPreview,
  AdmsSyncReglas,
} from '../types';

export async function getAdmsStatus(): Promise<AdmsStatus> {
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsStatus>('/fichero/adms/status');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer el estado ADMS');
  return {
    ...res,
    database: res.database ?? '',
    host: res.host ?? '',
    port: Number(res.port ?? 0),
    tables: Array.isArray(res.tables) ? res.tables : [],
    summary: res.summary ?? {},
  };
}

export async function getAdmsDispositivos(): Promise<AdmsDispositivo[]> {
  const res = await apiFetch<{ ok: boolean; data: AdmsDispositivo[]; error?: string }>('/fichero/adms/dispositivos');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer los dispositivos');
  return res.data ?? [];
}

export async function getAdmsFichadas(filters: AdmsFichadasFilters, offset = 0): Promise<{
  data: AdmsFichada[];
  total: number;
}> {
  const qs = new URLSearchParams();
  qs.set('limit', '100');
  qs.set('offset', String(offset));
  qs.set('desde', filters.desde);
  qs.set('hasta', filters.hasta);
  if (filters.dni.trim()) qs.set('dni', filters.dni.trim());
  if (filters.sn.trim()) qs.set('sn', filters.sn.trim());
  if (filters.tipo?.trim()) qs.set('tipo', filters.tipo.trim());

  const res = await apiFetch<{ ok: boolean; data: AdmsFichada[]; total: number; error?: string }>(
    `/fichero/adms/fichadas?${qs.toString()}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer las fichadas');
  return { data: res.data ?? [], total: res.total ?? 0 };
}

export async function getAdmsPersonas(q: string, offset = 0, sn = ''): Promise<{ data: AdmsPersona[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('limit', '50');
  qs.set('offset', String(offset));
  if (q.trim()) qs.set('q', q.trim());
  if (sn.trim()) qs.set('sn', sn.trim());

  const res = await apiFetch<{ ok: boolean; data: AdmsPersona[]; total: number; error?: string }>(
    `/fichero/adms/personas?${qs.toString()}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer los usuarios del fichero');
  return { data: res.data ?? [], total: res.total ?? 0 };
}

export async function getAdmsComandos(filters: AdmsComandosFilters, offset = 0): Promise<{ data: AdmsComando[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('limit', '50');
  qs.set('offset', String(offset));
  if (filters.sn.trim()) qs.set('sn', filters.sn.trim());
  if (filters.estado !== 'todos') qs.set('estado', filters.estado);

  const res = await apiFetch<{ ok: boolean; data: AdmsComando[]; total: number; error?: string }>(
    `/fichero/adms/comandos?${qs.toString()}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer los comandos ADMS');
  return { data: res.data ?? [], total: res.total ?? 0 };
}

export async function getAdmsCruces(sn?: string): Promise<AdmsCruces> {
  const qs = sn ? `?sn=${encodeURIComponent(sn)}` : '';
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsCruces>(`/fichero/adms/cruces${qs}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo cruzar ADMS con Personal');
  return res;
}

export async function getAdmsStructureConfig(): Promise<{ data: AdmsDeviceStructure[]; reparticiones: { id: number; nombre: string }[] }> {
  const res = await apiFetch<{ ok: boolean; data: AdmsDeviceStructure[]; reparticiones: { id: number; nombre: string }[]; error?: string }>('/fichero/adms/estructuras');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer la estructura ADMS');
  return { data: res.data ?? [], reparticiones: res.reparticiones ?? [] };
}

export async function saveAdmsDeviceStructure(sn: string, reparticionId: number | null): Promise<void> {
  const res = await apiFetch<{ ok: boolean; error?: string }>(`/fichero/adms/estructuras/${encodeURIComponent(sn)}`, {
    method: 'PUT',
    body: JSON.stringify({ reparticion_id: reparticionId }),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo guardar la estructura');
}

export async function getAdmsDeviceHistory(): Promise<AdmsDeviceHistory[]> {
  const res = await apiFetch<{ ok: boolean; data: AdmsDeviceHistory[]; error?: string }>('/fichero/adms/dispositivos-historial');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer el historial de dispositivos');
  return res.data ?? [];
}

async function postAdmsCommand(path: string, payload: Record<string, unknown>): Promise<number[]> {
  const res = await apiFetch<{ ok: boolean; ids?: number[]; error?: string }>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo crear el comando');
  return res.ids ?? [];
}

export function queueAdmsCheck(sn: string) {
  return postAdmsCommand('/fichero/adms/comandos/check', { sn });
}

export function queueAdmsReboot(sn: string) {
  return postAdmsCommand('/fichero/adms/comandos/reiniciar', { sn });
}

export function queueAdmsSendUser(sn: string, dni: string, incluirHuellas = true) {
  return postAdmsCommand('/fichero/adms/comandos/enviar-usuario', { sn, dni, incluirHuellas });
}

export function queueAdmsDeleteUser(sn: string, dni: string, incluirHuellas = true) {
  return postAdmsCommand('/fichero/adms/comandos/borrar-usuario', { sn, dni, incluirHuellas });
}

// Borra un dedo puntual (FID) del reloj, sin tocar al usuario ni al resto de las huellas
export function queueAdmsDeleteFinger(sn: string, dni: string, fid: number) {
  return postAdmsCommand('/fichero/adms/comandos/borrar-usuario', { sn, dni, fid });
}

export type AdmsCommandAction =
  | 'clear-data'
  | 'clear-log'
  | 'reset-pwd'
  | 'enroll-fp'
  | 'unlock'
  | 'noalarm'
  | 'check'
  | 'reboot'
  | 'get-file'
  | 'put-file'
  | 'shell'
  | 'set-option';

export function queueAdmsAction(payload: {
  sn: string;
  action: AdmsCommandAction;
  dni?: string;
  fid?: number;
  retry?: number;
  password?: string;
  filename?: string;
  content?: string;
  optionKey?: string;
  optionValue?: string;
  confirmacion?: string;
}) {
  return postAdmsCommand('/fichero/adms/comandos/accion', payload);
}

export async function getAdmsSyncPreview(params: {
  sn?: string;
  servicioId?: string;
  soloActivos?: boolean;
  privilege?: number;
  group?: number;
  timezone?: string;
  cardSource?: 'none' | 'dni' | 'legajo';
} = {}): Promise<AdmsSyncPreview> {
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  if (params.sn) qs.set('sn', params.sn);
  if (params.servicioId) qs.set('servicio_id', params.servicioId);
  if (params.soloActivos === false) qs.set('solo_activos', '0');
  if (params.privilege != null) qs.set('privilege', String(params.privilege));
  if (params.group != null) qs.set('group', String(params.group));
  if (params.timezone) qs.set('timezone', params.timezone);
  if (params.cardSource) qs.set('cardSource', params.cardSource);
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsSyncPreview>(`/fichero/adms/sync/preview?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo calcular el preview de sync');
  return res;
}

export async function applyAdmsSync(payload: {
  sn?: string;
  servicio_id?: string;
  solo_activos?: boolean;
  limit?: number;
  crear?: boolean;
  actualizar?: boolean;
  bajas?: boolean;
  huellas?: boolean;
  privilege?: number;
  group?: number;
  timezone?: string;
  cardSource?: 'none' | 'dni' | 'legajo';
}): Promise<{ ids: number[]; total: number; creados: number; actualizados: number; bajas: number; huellas: number; huellasOmitidas: number; dispositivos: number }> {
  const res = await apiFetch<{
    ok: boolean;
    error?: string;
    ids: number[];
    total: number;
    creados: number;
    actualizados: number;
    bajas: number;
    huellas: number;
    huellasOmitidas: number;
    dispositivos: number;
  }>('/fichero/adms/sync/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo aplicar la sincronizacion');
  return {
    ids: res.ids ?? [],
    total: res.total ?? 0,
    creados: res.creados ?? 0,
    actualizados: res.actualizados ?? 0,
    bajas: res.bajas ?? 0,
    huellas: res.huellas ?? 0,
    huellasOmitidas: res.huellasOmitidas ?? 0,
    dispositivos: res.dispositivos ?? 0,
  };
}

// Encola el borrado de los agentes hacia los relojes (la base ADMS nunca se borra)
export async function borrarCrucesUserinfo(payload: {
  dnis: string[];
  incluirHuellas: boolean;
  sn?: string;
}): Promise<{ encolados: number; comandos: number[]; relojes: number; omitidos: string[] }> {
  const res = await apiFetch<{ ok: boolean; error?: string; encolados: number; comandos: number[]; relojes: number; omitidos: string[] }>(
    '/fichero/adms/cruces/borrar-userinfo',
    { method: 'POST', body: JSON.stringify(payload) }
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo encolar el borrado en los relojes');
  return { encolados: res.encolados ?? 0, comandos: res.comandos ?? [], relojes: res.relojes ?? 0, omitidos: res.omitidos ?? [] };
}

export async function getAdmsComunicacion(): Promise<AdmsRuntimeEvent[]> {
  const res = await apiFetch<{ ok: boolean; data: AdmsRuntimeEvent[]; error?: string }>('/fichero/adms/comunicacion?limit=100');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer la comunicacion ADMS');
  return res.data ?? [];
}

export async function getAdmsHuellas(params: { q?: string; sn?: string } = {}): Promise<{
  data: AdmsFingerprintRow[];
  total: number;
  fuente?: string;
  reloj?: { sn: string; alias: string; ip: string };
  resumen?: { usuarios: number; templates: number; bytesTemplates: number };
  dispositivos: { sn: string; alias: string; fpVersion: string }[];
}> {
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.sn?.trim()) qs.set('sn', params.sn.trim());
  const res = await apiFetch<{
    ok: boolean;
    data: AdmsFingerprintRow[];
    total: number;
    fuente?: string;
    reloj?: { sn: string; alias: string; ip: string };
    resumen?: { usuarios: number; templates: number; bytesTemplates: number };
    dispositivos: { sn: string; alias: string; fpVersion: string }[];
    error?: string;
  }>(`/fichero/adms/huellas?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer la biometria directa del fichero');
  return {
    data: res.data ?? [],
    total: res.total ?? 0,
    fuente: res.fuente,
    reloj: res.reloj,
    resumen: res.resumen,
    dispositivos: res.dispositivos ?? [],
  };
}

export async function getAdmsBiometricStatus(params: {
  q?: string;
  sn?: string;
  estado?: AdmsBiometricState;
  offset?: number;
} = {}): Promise<AdmsBiometricStatusResult> {
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  qs.set('offset', String(params.offset ?? 0));
  qs.set('estado', params.estado ?? 'incompleto');
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.sn?.trim()) qs.set('sn', params.sn.trim());
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsBiometricStatusResult>(
    `/fichero/adms/estado-biometrico?${qs.toString()}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer el estado biometrico');
  return res;
}

export async function exportAdmsBiometricStatus(params: {
  q?: string;
  sn?: string;
  estado?: AdmsBiometricState;
} = {}): Promise<void> {
  const qs = new URLSearchParams();
  qs.set('exportar', 'csv');
  qs.set('estado', params.estado ?? 'incompleto');
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.sn?.trim()) qs.set('sn', params.sn.trim());
  const blob = await apiFetchBlob(`/fichero/adms/estado-biometrico?${qs.toString()}`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `estado_biometrico_${params.sn || 'general'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function getAdmsRereadPreview(params: { sn: string; desde: string; hasta: string }): Promise<AdmsRereadPreview> {
  const qs = new URLSearchParams();
  qs.set('sn', params.sn);
  qs.set('desde', params.desde);
  qs.set('hasta', params.hasta);
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsRereadPreview>(`/fichero/adms/relectura/preview?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo calcular preview de relectura');
  return res;
}

export async function applyAdmsReread(payload: {
  sn: string;
  desde: string;
  hasta: string;
  confirmacion: string;
}): Promise<{ ids: number[]; total: number; stampAnterior: number; stampNuevo: number; existentesAntes: number; borradas: number; comando?: string }> {
  const res = await apiFetch<{
    ok: boolean;
    error?: string;
    ids: number[];
    total: number;
    stampAnterior: number;
    stampNuevo: number;
    existentesAntes: number;
    borradas: number;
    comando?: string;
  }>('/fichero/adms/relectura/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo aplicar la relectura');
  return {
    ids: res.ids ?? [],
    total: res.total ?? 0,
    stampAnterior: res.stampAnterior ?? 0,
    stampNuevo: res.stampNuevo ?? 0,
    existentesAntes: res.existentesAntes ?? 0,
    borradas: res.borradas ?? 0,
    comando: res.comando,
  };
}

export async function getAdmsDeleteAttlogPreview(params: {
  sn: string;
  desde: string;
  hasta: string;
  dni?: string;
  tipo?: string;
}): Promise<AdmsDeleteAttlogPreview> {
  const qs = new URLSearchParams();
  qs.set('sn', params.sn);
  qs.set('desde', params.desde);
  qs.set('hasta', params.hasta);
  if (params.dni?.trim()) qs.set('dni', params.dni.trim());
  if (params.tipo?.trim()) qs.set('tipo', params.tipo.trim());
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsDeleteAttlogPreview>(`/fichero/adms/fichadas/borrado/preview?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo calcular el borrado de fichajes');
  return res;
}

export async function applyAdmsDeleteAttlog(payload: {
  sn: string;
  desde: string;
  hasta: string;
  dni?: string;
  tipo?: string;
  confirmacion: string;
}): Promise<{ ids: number[]; total: number; estimadas: number; comando: string }> {
  const res = await apiFetch<{ ok: boolean; error?: string; ids: number[]; total: number; estimadas: number; comando: string }>(
    '/fichero/adms/fichadas/borrado/apply',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo encolar el borrado de fichajes');
  return { ids: res.ids ?? [], total: res.total ?? 0, estimadas: res.estimadas ?? 0, comando: res.comando ?? '' };
}

export async function getAdmsClockCross(params: {
  snA: string;
  snB: string;
  desde: string;
  hasta: string;
  servicioId?: string;
}): Promise<AdmsClockCross> {
  const qs = new URLSearchParams();
  qs.set('snA', params.snA);
  qs.set('snB', params.snB);
  qs.set('desde', params.desde);
  qs.set('hasta', params.hasta);
  qs.set('limit', '300');
  if (params.servicioId?.trim()) qs.set('servicio_id', params.servicioId.trim());
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsClockCross>(`/fichero/adms/relojes/cruce?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo cruzar relojes');
  return res;
}

export async function searchAdmsMessageAgents(q: string, sn?: string): Promise<AdmsMessageAgent[]> {
  const qs = new URLSearchParams();
  qs.set('limit', '50');
  if (q.trim()) qs.set('q', q.trim());
  if (sn?.trim()) qs.set('sn', sn.trim());
  const res = await apiFetch<{ ok: boolean; data: AdmsMessageAgent[]; error?: string }>(`/fichero/adms/mensajes/agentes?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron buscar agentes activos');
  return res.data ?? [];
}

export async function previewAdmsMessage(payload: {
  sn: string;
  dni: string;
  plantilla: string;
  formato: 'privado' | 'idle' | 'legacy';
  tipo?: string;
  minutos?: number;
  inicio?: string;
}): Promise<AdmsMessagePreview> {
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsMessagePreview>('/fichero/adms/mensajes/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo previsualizar el mensaje');
  return res;
}

export async function sendAdmsMessage(payload: {
  sn: string;
  dni: string;
  plantilla: string;
  formato: 'privado' | 'idle' | 'legacy';
  tipo?: string;
  minutos?: number;
  inicio?: string;
}): Promise<{ ids: number[]; total: number } & AdmsMessagePreview> {
  const res = await apiFetch<{ ok: boolean; error?: string; ids: number[]; total: number } & AdmsMessagePreview>('/fichero/adms/mensajes/enviar', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo enviar el mensaje');
  return { ...res, ids: res.ids ?? [], total: res.total ?? 0 };
}

export async function getAdmsAudioConfig(): Promise<{ archivos: AdmsAudioFile[]; reglas: AdmsAudioRule[] }> {
  const res = await apiFetch<{ ok: boolean; error?: string; archivos: AdmsAudioFile[]; reglas: AdmsAudioRule[] }>('/fichero/adms/audio');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer audio ADMS');
  return { archivos: res.archivos ?? [], reglas: res.reglas ?? [] };
}

export async function uploadAdmsAudio(file: File, nombre: string): Promise<AdmsAudioFile> {
  const body = new FormData();
  body.append('file', file);
  if (nombre.trim()) body.append('nombre', nombre.trim());
  const res = await apiFetch<{ ok: boolean; error?: string; data: AdmsAudioFile }>('/fichero/adms/audio/upload', {
    method: 'POST',
    headers: {},
    body,
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo subir audio');
  return res.data;
}

export async function saveAdmsAudioRule(payload: {
  id?: string;
  nombre: string;
  evento: 'entrada' | 'salida' | 'fichada';
  sn?: string | null;
  dni?: string | null;
  audioId: string;
  activo: boolean;
  volumen: number;
}): Promise<AdmsAudioRule> {
  const res = await apiFetch<{ ok: boolean; error?: string; data: AdmsAudioRule }>('/fichero/adms/audio/reglas', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo guardar regla de audio');
  return res.data;
}

export async function deleteAdmsAudioRule(id: string): Promise<void> {
  const res = await apiFetch<{ ok: boolean; error?: string }>(`/fichero/adms/audio/reglas/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo borrar regla de audio');
}

export async function getAdmsAudioEvents(): Promise<AdmsAudioEvent[]> {
  const res = await apiFetch<{ ok: boolean; error?: string; data: AdmsAudioEvent[] }>('/fichero/adms/audio/eventos?limit=100');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer eventos de audio');
  return res.data ?? [];
}

export async function fetchAdmsAudioBlob(audioId: string): Promise<Blob> {
  return apiFetchBlob(`/fichero/adms/audio/archivos/${encodeURIComponent(audioId)}/play`);
}

export async function downloadAdmsBackup(sn: string, tipo: 'datos' | 'sistema'): Promise<void> {
  const blob = await apiFetchBlob(`/fichero/adms/dispositivos/${encodeURIComponent(sn)}/backup?tipo=${tipo}`);
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `${sn}_${tipo}_${ts}.dat`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function retryOldAdmsCommands(payload: { sn?: string; minutos?: number }): Promise<number> {
  const res = await apiFetch<{ ok: boolean; afectados: number; error?: string }>('/fichero/adms/comandos/reintentar-viejos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron reintentar comandos');
  return res.afectados ?? 0;
}

export async function cleanFinishedAdmsCommands(dias = 30): Promise<number> {
  const res = await apiFetch<{ ok: boolean; afectados: number; error?: string }>('/fichero/adms/comandos/limpiar-finalizados', {
    method: 'POST',
    body: JSON.stringify({ dias }),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron limpiar comandos');
  return res.afectados ?? 0;
}

export async function expireOldAdmsCommands(payload: { sn?: string; minutos?: number }): Promise<number> {
  const res = await apiFetch<{ ok: boolean; afectados: number; error?: string }>('/fichero/adms/comandos/marcar-vencidos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron marcar comandos vencidos');
  return res.afectados ?? 0;
}

export interface AdmsCommandStatus {
  id: number;
  sn: string;
  comando: string;
  commit: string | null;
  enviado: string | null;
  finalizado: string | null;
  retorno: number | null;
  estado: 'PENDIENTE' | 'ENVIADO' | 'OK' | 'ERROR';
}

// Estado de comandos por id (para verificar el resultado de un borrado en el reloj)
export async function getAdmsCommandStatus(ids: number[]): Promise<AdmsCommandStatus[]> {
  const res = await apiFetch<{ ok: boolean; data: AdmsCommandStatus[]; error?: string }>(
    `/fichero/adms/comandos/estado?ids=${ids.join(',')}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo leer el estado de comandos');
  return res.data ?? [];
}

export async function getAdmsSyncReglas(): Promise<AdmsSyncReglas> {
  const res = await apiFetch<{ ok: boolean; data: AdmsSyncReglas; error?: string }>('/fichero/adms/sync/reglas');
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer las reglas de sync');
  return res.data ?? { servicios: {} };
}

export async function pingAdmsDispositivo(sn: string): Promise<AdmsPingResult> {
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsPingResult>(
    `/fichero/adms/dispositivos/${encodeURIComponent(sn)}/ping`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo hacer ping');
  return res;
}

export async function pullFichadasDispositivo(sn: string, desde: string, hasta: string): Promise<AdmsPullFichadasResult> {
  const res = await apiFetch<{ ok: boolean; error?: string } & AdmsPullFichadasResult>(
    `/fichero/adms/dispositivos/${encodeURIComponent(sn)}/pull-fichadas`,
    { method: 'POST', body: JSON.stringify({ desde, hasta }) }
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron traer fichadas');
  return res;
}

export async function getAdmsBiotemplates(params: { q?: string; bioType?: number; sn?: string } = {}): Promise<{
  data: AdmsBiotemplate[];
  total: number;
  dispositivos: { sn: string; alias: string }[];
}> {
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.bioType != null) qs.set('bioType', String(params.bioType));
  if (params.sn?.trim()) qs.set('sn', params.sn.trim());
  const res = await apiFetch<{ ok: boolean; error?: string; data: AdmsBiotemplate[]; total: number; dispositivos: { sn: string; alias: string }[] }>(
    `/fichero/adms/biotemplates?${qs.toString()}`
  );
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer biotemplates');
  return { data: res.data ?? [], total: res.total ?? 0, dispositivos: res.dispositivos ?? [] };
}

export async function updateAdmsDispositivo(sn: string, data: {
  alias?: string;
  state?: boolean;
  transTimes?: string;
  transInterval?: number;
  tzAdj?: number;
}): Promise<void> {
  const res = await apiFetch<{ ok: boolean; error?: string }>(`/fichero/adms/dispositivos/${encodeURIComponent(sn)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudo actualizar el dispositivo');
}
