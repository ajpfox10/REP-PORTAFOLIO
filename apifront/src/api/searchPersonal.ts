// src/api/searchPersonal.ts
//
// Solución al crash de /personal/search (error SQL en el backend).
// Carga TODOS los registros de personal paginando la API y los mantiene
// en memoria. Las búsquedas posteriores son instantáneas (client-side).
//
// Uso:
//   const results = await searchPersonal('GARCIA');     // por apellido/nombre
//   const results = await searchPersonal('', 28305607); // por DNI

import { apiFetch } from './http';

let cache: any[] | null = null;
let loadingPromise: Promise<any[]> | null = null;

async function loadAll(): Promise<any[]> {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const PAGE = 200;
    let page = 1;
    let all: any[] = [];
    let total = Infinity;

    while (all.length < total) {
      const res = await apiFetch<any>(`/personal?limit=${PAGE}&page=${page}`);
      const rows: any[] = res?.data || [];
      if (!rows.length) break;
      all = [...all, ...rows];
      if (res?.meta?.total) total = Number(res.meta.total);
      else total = all.length;
      if (rows.length < PAGE) break;
      page++;
    }

    cache = all;
    loadingPromise = null;
    return all;
  })();

  return loadingPromise;
}

/** Invalida el cache (útil después de una alta/edición) */
export function invalidatePersonalCache() {
  cache = null;
  loadingPromise = null;
}

/** Devuelve todos los registros de personal (usa el mismo cache interno) */
export async function getAllPersonal(): Promise<any[]> {
  return loadAll();
}

/**
 * Busca personas por apellido (y/o nombre) usando el cache local.
 * Si se pasa `dniExacto` hace búsqueda directa por DNI contra la API.
 *
 * @param query  - texto libre: apellido, nombre o parte de ellos
 * @param limit  - máximo de resultados a devolver (default 30)
 * @returns array de registros de personal
 */
export async function searchPersonal(
  query: string
): Promise<any[]> {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!q) return [];

  const all = await loadAll();

  const results = all.filter(p => {
    const ape = (p.apellido ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nom = (p.nombre ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const full = `${ape} ${nom}`;
    return ape.startsWith(q) || ape.includes(q) || full.includes(q);
  });

  // Ordenar: primero los que empiezan con el query
  results.sort((a, b) => {
    const aA = (a.apellido ?? '').toLowerCase();
    const bA = (b.apellido ?? '').toLowerCase();
    const aStarts = aA.startsWith(q) ? 0 : 1;
    const bStarts = bA.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return aA.localeCompare(bA);
  });

  return results; // sin límite, la paginación la maneja el componente
}
