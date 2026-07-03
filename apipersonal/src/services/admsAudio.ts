import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type AdmsAudioEventType = 'entrada' | 'salida' | 'fichada';

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
  evento: AdmsAudioEventType;
  sn: string | null;
  dni: string | null;
  audioId: string;
  activo: boolean;
  volumen: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdmsAudioConfig {
  archivos: AdmsAudioFile[];
  reglas: AdmsAudioRule[];
}

export interface AdmsAttendanceAudioEvent {
  id: string;
  ts: string;
  evento: AdmsAudioEventType;
  sn: string;
  dni: string;
  nombre: string;
  checktime: string;
  audioId: string | null;
  audioUrl: string | null;
  reglaId: string | null;
  volumen: number;
}

const audioEvents: AdmsAttendanceAudioEvent[] = [];

function baseDir(): string {
  return path.resolve(process.cwd(), 'fichadas', 'adms_audio');
}

function configPath(): string {
  return path.resolve(process.cwd(), 'config', 'admsAudioRules.json');
}

function eventsPath(): string {
  return path.join(baseDir(), 'events.jsonl');
}

function ensureDirs(): void {
  fs.mkdirSync(baseDir(), { recursive: true });
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
}

function emptyConfig(): AdmsAudioConfig {
  return { archivos: [], reglas: [] };
}

export function readAdmsAudioConfig(): AdmsAudioConfig {
  ensureDirs();
  const file = configPath();
  if (!fs.existsSync(file)) return emptyConfig();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AdmsAudioConfig>;
    return {
      archivos: Array.isArray(parsed.archivos) ? parsed.archivos : [],
      reglas: Array.isArray(parsed.reglas) ? parsed.reglas : [],
    };
  } catch {
    return emptyConfig();
  }
}

export function writeAdmsAudioConfig(config: AdmsAudioConfig): void {
  ensureDirs();
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function safeAudioFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'audio';
}

export function allowedAudio(mime: string, originalName: string): boolean {
  const ext = path.extname(originalName).toLowerCase();
  return (
    ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4'].includes(mime)
    || ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)
  );
}

export function addAdmsAudioFile(input: {
  tempPath: string;
  originalName: string;
  mime: string;
  size: number;
  nombre?: string;
}): AdmsAudioFile {
  ensureDirs();
  const config = readAdmsAudioConfig();
  const ext = path.extname(input.originalName).toLowerCase() || '.bin';
  const id = randomUUID();
  const filename = safeAudioFilename(`${id}${ext}`);
  const target = path.join(baseDir(), filename);
  fs.renameSync(input.tempPath, target);
  const file: AdmsAudioFile = {
    id,
    nombre: String(input.nombre || path.basename(input.originalName, ext) || 'Audio').trim().slice(0, 80),
    filename,
    originalName: input.originalName,
    mime: input.mime || 'application/octet-stream',
    size: input.size,
    createdAt: new Date().toISOString(),
  };
  config.archivos.unshift(file);
  writeAdmsAudioConfig(config);
  return file;
}

export function audioFilePath(id: string): { file: AdmsAudioFile; path: string } | null {
  const config = readAdmsAudioConfig();
  const file = config.archivos.find(a => a.id === id);
  if (!file) return null;
  const resolved = path.resolve(baseDir(), file.filename);
  if (!resolved.startsWith(path.resolve(baseDir()))) return null;
  if (!fs.existsSync(resolved)) return null;
  return { file, path: resolved };
}

export function upsertAdmsAudioRule(input: Partial<AdmsAudioRule> & {
  nombre?: string;
  evento: AdmsAudioEventType;
  audioId: string;
}): AdmsAudioRule {
  const config = readAdmsAudioConfig();
  if (!config.archivos.some(a => a.id === input.audioId)) throw new Error('Audio no encontrado');
  const now = new Date().toISOString();
  const id = input.id || randomUUID();
  const previous = config.reglas.find(r => r.id === id);
  const rule: AdmsAudioRule = {
    id,
    nombre: String(input.nombre || previous?.nombre || 'Regla de audio').trim().slice(0, 80),
    evento: input.evento,
    sn: input.sn ? String(input.sn).trim() : null,
    dni: input.dni ? String(input.dni).replace(/\D/g, '').replace(/^0+/, '') || null : null,
    audioId: input.audioId,
    activo: input.activo ?? previous?.activo ?? true,
    volumen: Math.max(0, Math.min(1, Number(input.volumen ?? previous?.volumen ?? 0.8))),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  config.reglas = [rule, ...config.reglas.filter(r => r.id !== id)];
  writeAdmsAudioConfig(config);
  return rule;
}

export function deleteAdmsAudioRule(id: string): boolean {
  const config = readAdmsAudioConfig();
  const before = config.reglas.length;
  config.reglas = config.reglas.filter(r => r.id !== id);
  writeAdmsAudioConfig(config);
  return config.reglas.length !== before;
}

function eventTypeFromChecktype(checktype: string | number | null | undefined): AdmsAudioEventType {
  const raw = String(checktype ?? '').trim();
  if (['1', 'SALIDA', 'OUT'].includes(raw.toUpperCase())) return 'salida';
  return 'entrada';
}

function matchRule(config: AdmsAudioConfig, event: { evento: AdmsAudioEventType; sn: string; dni: string }): AdmsAudioRule | null {
  return config.reglas.find(rule => {
    if (!rule.activo) return false;
    if (rule.evento !== 'fichada' && rule.evento !== event.evento) return false;
    if (rule.sn && rule.sn !== event.sn) return false;
    if (rule.dni && rule.dni !== event.dni) return false;
    return config.archivos.some(a => a.id === rule.audioId);
  }) || null;
}

export function recordAdmsAttendanceAudioEvent(input: {
  sn: string;
  dni: string;
  nombre?: string | null;
  checktime: string;
  checktype?: string | number | null;
}): AdmsAttendanceAudioEvent {
  const config = readAdmsAudioConfig();
  const dni = String(input.dni || '').replace(/\D/g, '').replace(/^0+/, '');
  const evento = eventTypeFromChecktype(input.checktype);
  const rule = matchRule(config, { evento, sn: input.sn, dni });
  const ev: AdmsAttendanceAudioEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    evento,
    sn: input.sn,
    dni,
    nombre: String(input.nombre || '').trim(),
    checktime: input.checktime,
    audioId: rule?.audioId || null,
    audioUrl: rule ? `/api/v1/fichero/adms/audio/archivos/${encodeURIComponent(rule.audioId)}/play` : null,
    reglaId: rule?.id || null,
    volumen: rule?.volumen ?? 0.8,
  };
  audioEvents.unshift(ev);
  if (audioEvents.length > 300) audioEvents.length = 300;
  try {
    ensureDirs();
    fs.appendFileSync(eventsPath(), `${JSON.stringify(ev)}\n`, 'utf8');
  } catch {
    // El audio operativo no debe bloquear la recepcion de fichadas.
  }
  return ev;
}

export function getAdmsAttendanceAudioEvents(limit = 100): AdmsAttendanceAudioEvent[] {
  return audioEvents.slice(0, Math.max(1, Math.min(300, limit)));
}
