// hooks/useDnisRelacionados.ts
// Resuelve, para un DNI, la lista de DNIs relacionados por cambios de DNI.
// Cuando un agente cambió de documento, sus datos históricos (consultas,
// pedidos, documentos, expedientes, citaciones…) quedan colgados del DNI viejo.
// Este hook lee la tabla `cambios_dni` (expuesta por el CRUD automático) en
// AMBOS sentidos y sigue la cadena por si hubo más de un cambio, devolviendo
// [principal, ...relacionados] sin duplicados.
//
// Degrada suave: si el endpoint no existe todavía (API sin reiniciar tras crear
// la tabla) devuelve solo el DNI principal y no rompe nada.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/http';

const clean = (v: any) => String(v ?? '').replace(/\D/g, '');

// BFS por la tabla cambios_dni siguiendo dni_nuevo<->dni_viejo en ambos sentidos.
async function resolveChain(startDni: string): Promise<string[]> {
  const seen = new Set<string>([startDni]);
  const queue: string[] = [startDni];
  let guard = 0;

  while (queue.length && guard < 25) {
    guard++;
    const d = queue.shift()!;
    const [porNuevo, porViejo] = await Promise.all([
      apiFetch<any>(`/cambios_dni?dni_nuevo=${d}&limit=50`).catch(() => null),
      apiFetch<any>(`/cambios_dni?dni_viejo=${d}&limit=50`).catch(() => null),
    ]);
    const add = (v: any) => {
      const s = clean(v);
      if (s && !seen.has(s)) { seen.add(s); queue.push(s); }
    };
    (porNuevo?.data || []).forEach((r: any) => add(r.dni_viejo));
    (porViejo?.data || []).forEach((r: any) => add(r.dni_nuevo));
  }

  return [...seen]; // el principal queda primero por orden de inserción
}

// Consulta un endpoint CRUD `?dni=` para varios DNIs y concatena los resultados,
// paginando cada uno. Reusa el criterio de corte de useModules.
export async function fetchRowsByDnis(
  endpoint: string,
  dnis: string[],
  opts: { extraQuery?: string; limit?: number; max?: number } = {},
): Promise<any[]> {
  const { extraQuery = '', limit = 200, max = 2000 } = opts;
  let all: any[] = [];
  for (const dni of dnis) {
    let page = 1;
    let totalPages = 1;
    while (true) {
      const qs = `dni=${dni}&limit=${limit}&page=${page}${extraQuery ? `&${extraQuery}` : ''}`;
      const res = await apiFetch<any>(`${endpoint}?${qs}`);
      const rows: any[] = res?.data || [];
      const total = Number(res?.meta?.total) || rows.length;
      totalPages = Math.max(1, Math.ceil(total / limit));
      all = all.concat(rows);
      if (!rows.length || rows.length < limit || page >= totalPages) break;
      page++;
      if (all.length >= max) break;
    }
    if (all.length >= max) break;
  }
  return all;
}

export function useDnisRelacionados(cleanDni: string) {
  const base = clean(cleanDni);
  const [state, setState] = useState<{ dnis: string[]; loading: boolean }>({
    dnis: base ? [base] : [],
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!base) { setState({ dnis: [], loading: false }); return; }
    setState({ dnis: [base], loading: true });
    resolveChain(base)
      .then(dnis => { if (!cancelled) setState({ dnis, loading: false }); })
      .catch(() => { if (!cancelled) setState({ dnis: [base], loading: false }); });
    return () => { cancelled = true; };
  }, [base]);

  return {
    dnis: state.dnis,                 // [principal, ...relacionados]
    relacionados: state.dnis.slice(1),
    principal: base,
    loading: state.loading,
  };
}
