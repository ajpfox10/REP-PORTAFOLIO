// src/services/resolucionArchivoMatch.ts
// Resolución ↔ archivo de la carpeta RESOLUCIONES Y VARIOS (tblarchivos dni=1).
// Compara por NÚMEROS, sin importar el formato del nombre:
//   RESOC-2026-997-GDEBA-SGG ↔ RESOC-2026-997.pdf · 1839/2006 ↔ 11112-1839-06.pdf · "RESO 752-2021".
// Misma lógica que el visor (apifront ResolucionesPage) y que el backfill
// scripts/resoluciones_registrar_y_vincular.cjs: si se cambia acá, cambiarla allá también.

const LETRAS = 'A-Za-zÁÉÍÓÚÑáéíóúñ';
const sinExt = (s: unknown) => String(s ?? '').replace(/\.+[a-z0-9]{2,5}$/i, '');
const principal = (s: unknown) => sinExt(s).trim().replace(/\s*-\s*/g, '-')
  .replace(new RegExp(`^([${LETRAS}]+)\\s+(?=\\d)`), '$1-').split(/\s+/)[0] || '';
const ANIO_MAX = () => new Date().getFullYear() + 1;

/** Grupos de dígitos; UN solo grupo es el año (el mayor de 4 cifras 1960..año+1) y va a 2 cifras. */
function grupos(s: unknown): number[] {
  const gs: string[] = String(s).match(/\d+/g) || [];
  const max = ANIO_MAX();
  let iAnio = -1;
  gs.forEach((g, i) => { const n = +g; if (g.length === 4 && n >= 1960 && n <= max && (iAnio < 0 || n > +gs[iAnio])) iAnio = i; });
  return gs.map((g, i) => (i === iAnio ? +g % 100 : +g));
}
const prefijo = (s: unknown) => (principal(s).match(new RegExp(`^[${LETRAS}]+`)) || [''])[0].toUpperCase();
const familia = (p: string) => (!p ? '' : /^RES/.test(p) ? 'RESO' : /^DEC/.test(p) ? 'DECRETO' : /^DI/.test(p) ? 'DISPO' : p);
const ord = (a: number[]) => [...a].sort((x, y) => x - y).join(',');
const contiene = (grande: number[], chico: number[]) => {
  const resto = [...grande];
  for (const n of chico) { const i = resto.indexOf(n); if (i < 0) return false; resto.splice(i, 1); }
  return true;
};
const normTxt = (s: unknown) => sinExt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function puntajeResArchivo(numeroRes: unknown, fechaRes: unknown, nombreArchivo: string, apellido = ''): number {
  let R = grupos(principal(numeroRes));
  if (!R.length) return 0;
  if (R.length === 1 && fechaRes) R = [...R, Number(String(fechaRes instanceof Date ? fechaRes.toISOString() : fechaRes).slice(0, 4)) % 100];
  const F = grupos(principal(nombreArchivo));
  if (!F.length) return 0;
  const preR = prefijo(numeroRes); const preF = prefijo(nombreArchivo);
  const famR = familia(preR); const famF = familia(preF);
  if (famR && famF && famR !== famF) return 0;
  let p = 0;
  if (R.length === F.length && ord(R) === ord(F)) p = 100;
  else if (!preR && R.length >= 2 && F.length > R.length && contiene(F, R)) p = 50;
  else return 0;
  if (normTxt(numeroRes) && normTxt(numeroRes) === normTxt(nombreArchivo)) p += 20;
  if (preR && preR === preF) p += 10; else if (famR && famR === famF) p += 5;
  const restoArchivo = normTxt(sinExt(nombreArchivo).trim().split(/\s+/).slice(1).join(' '));
  const ape = normTxt(String(apellido).split(/[\s,]+/)[0] || '');
  if (ape.length >= 3 && restoArchivo.includes(ape)) p += 15; else if (!restoArchivo) p += 3;
  const lit = (s: unknown) => (principal(s).match(/\d+/g) || []).join('-');
  if (lit(numeroRes) === lit(nombreArchivo)) p += 2;
  if (/no usar|blanco/i.test(nombreArchivo)) p -= 30;
  return p;
}

export interface ArchivoGeneral { id: number; nombre?: string | null; nombre_archivo_original?: string | null }

/** Mejor archivo; con empate no elige (archivo=null) y devuelve los candidatos ordenados. */
export function matchResolucionGeneral<T extends ArchivoGeneral>(
  r: { numero: unknown; fecha?: unknown }, generales: T[], apellido = '',
): { archivo: T | null; candidatos: T[] } {
  const scored = generales
    .map(a => ({ a, p: puntajeResArchivo(r.numero, r.fecha, a.nombre_archivo_original || a.nombre || '', apellido) }))
    .filter(x => x.p > 0)
    .sort((x, y) => y.p - x.p);
  if (!scored.length) return { archivo: null, candidatos: [] };
  const top = scored.filter(x => x.p === scored[0].p);
  return { archivo: top.length === 1 ? top[0].a : null, candidatos: scored.slice(0, 10).map(x => x.a) };
}
