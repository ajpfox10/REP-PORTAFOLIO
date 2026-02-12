import { emitAlert } from "./alertSink";

type WindowCounter = { t0: number; n: number };

const windows: Record<string, WindowCounter> = {};

function bump(key: string, windowMs: number) {
  const now = Date.now();
  const w = windows[key] || { t0: now, n: 0 };
  if (now - w.t0 > windowMs) {
    w.t0 = now;
    w.n = 0;
  }
  w.n++;
  windows[key] = w;
  return w.n;
}

export function alertOnSpike(
  key: string,
  count: number,
  windowMs: number,
  title: string,
  details?: any
) {
  const n = bump(key, windowMs);
  if (n === count) {
    emitAlert("critical", title, { windowMs, count, ...details });
  }
}
