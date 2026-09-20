import { apiFetch } from '../../../api/http';
import type {
  DbPreview,
  Dispositivo,
  EstadoFichero,
  ExportarRangoPayload,
  ExportarRangoResult,
  FicheroConfig,
  FicheroPendientes,
} from '../types';

export async function getFicheroDispositivos(): Promise<{ data: Dispositivo[]; warning?: string }> {
  const res = await apiFetch<{ ok: boolean; data: Dispositivo[]; warning?: string }>('/fichero/dispositivos');
  if (!res?.ok) throw new Error('No se pudieron leer los dispositivos');
  return { data: res.data ?? [], warning: res.warning };
}

export async function getFicheroEstado(): Promise<EstadoFichero> {
  const res = await apiFetch<{ ok: boolean; data: EstadoFichero }>('/fichero/estado');
  if (!res?.ok) throw new Error('No se pudo leer el estado');
  return res.data;
}

export async function getFicheroRedActiva(): Promise<boolean> {
  const res = await apiFetch<{ ok: boolean; red: string }>('/fichero/red');
  if (!res?.ok) throw new Error('No se pudo verificar la red');
  return res.red === 'activa';
}

export async function getFicheroConfig(): Promise<FicheroConfig> {
  const res = await apiFetch<{ ok: boolean; data: FicheroConfig }>('/fichero/config');
  if (!res?.ok) throw new Error('No se pudo leer la configuracion');
  return res.data;
}

export async function getFicheroDbPreview(): Promise<DbPreview> {
  const res = await apiFetch<{ ok: boolean } & DbPreview & { error?: string }>('/fichero/db-preview');
  if (!res?.ok) throw new Error((res as any)?.error ?? 'No se pudo conectar a la DB del reloj');
  return { columna: res.columna, minFecha: res.minFecha, maxFecha: res.maxFecha, muestras: res.muestras };
}

export async function postFicheroAction(endpoint: string): Promise<{ ok: boolean; msg?: string }> {
  return apiFetch<{ ok: boolean; msg?: string }>(`/fichero/${endpoint}`, { method: 'POST' });
}

export async function putFicheroConfig(config: Partial<FicheroConfig>): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/fichero/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function postFicheroExportar(payload: ExportarRangoPayload): Promise<ExportarRangoResult> {
  return apiFetch<ExportarRangoResult>('/fichero/exportar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getFicheroPendientes(params: { desde?: string; hasta?: string; detalle?: boolean } = {}): Promise<FicheroPendientes> {
  const qs = new URLSearchParams();
  if (params.desde) qs.set('desde', params.desde);
  if (params.hasta) qs.set('hasta', params.hasta);
  if (params.detalle) qs.set('detalle', '1');
  const res = await apiFetch<{ ok: boolean; error?: string } & FicheroPendientes>(`/fichero/pendientes?${qs.toString()}`);
  if (!res?.ok) throw new Error(res?.error ?? 'No se pudieron leer las fichadas pendientes');
  return res;
}
