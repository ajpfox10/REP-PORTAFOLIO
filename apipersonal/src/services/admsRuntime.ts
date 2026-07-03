import fs from 'fs';
import path from 'path';

export interface AdmsRuntimeEvent {
  ts: string;
  sn: string;
  endpoint: string;
  method: string;
  ip: string;
  ok: boolean;
  detail: string;
}

const events: AdmsRuntimeEvent[] = [];

function runtimeLogPath(): string {
  return path.resolve(process.cwd(), 'fichadas', 'adms_runtime', 'events.jsonl');
}

export function recordAdmsRuntimeEvent(event: Omit<AdmsRuntimeEvent, 'ts'>): void {
  const fullEvent = { ...event, ts: new Date().toISOString() };
  events.unshift(fullEvent);
  if (events.length > 500) events.length = 500;
  try {
    const file = runtimeLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(fullEvent)}\n`, 'utf8');
  } catch {
    // La comunicacion no debe fallar por un problema de log operativo.
  }
}

export function getAdmsRuntimeEvents(limit = 100): AdmsRuntimeEvent[] {
  const safeLimit = Math.max(1, Math.min(500, limit));
  if (events.length >= safeLimit) return events.slice(0, safeLimit);

  try {
    const file = runtimeLogPath();
    if (!fs.existsSync(file)) return events.slice(0, safeLimit);
    const persisted = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-safeLimit)
      .map(line => {
        try { return JSON.parse(line) as AdmsRuntimeEvent; }
        catch { return null; }
      })
      .filter((row): row is AdmsRuntimeEvent => !!row)
      .reverse();
    const seen = new Set(events.map(e => `${e.ts}|${e.sn}|${e.endpoint}|${e.detail}`));
    return [
      ...events,
      ...persisted.filter(e => !seen.has(`${e.ts}|${e.sn}|${e.endpoint}|${e.detail}`)),
    ].slice(0, safeLimit);
  } catch {
    return events.slice(0, safeLimit);
  }
}
