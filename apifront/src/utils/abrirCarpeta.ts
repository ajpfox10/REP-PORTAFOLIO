// src/utils/abrirCarpeta.ts
// Abre una carpeta de DOCU en el Explorador de Windows DE LA PC DEL USUARIO.
//
// Por qué hace falta un handler: la API vive en la Sesión 0 del servidor (aislada
// del escritorio), así que no puede abrir el Explorador de nadie — menos aún el de
// una PC remota. El que abre es la PC donde está el navegador, vía el protocolo
// `p5abrir:` que registra abrir-carpeta-handler\Instalar.cmd.
//
// Si el handler no está instalado en esa PC, no pasa nada visible: por eso siempre
// se deja además la ruta en el portapapeles como plan B (pegar con Ctrl+V).
import { apiFetch } from '../api/http';

export type RutaCarpeta = {
  /** Ruta de red completa, ej: \\192.168.0.21\G\DOCU\1100\DNI */
  unc: string;
  /** true si la subcarpeta no existía y el backend la creó recién. */
  creada: boolean;
};

export type OpcionesCarpeta = {
  /**
   * Nombre de UN documento (ej. "DNI"). Se manda al backend, que crea la subcarpeta
   * si no existe. Para los chips de Faltantes, donde el documento justamente falta.
   */
  doc?: string | null;
  /**
   * Subcarpeta relativa ya existente dentro de la carpeta del agente (ej. "DNI/anexos").
   * Se agrega del lado del cliente: NO se crea nada. Para el visor, que navega
   * carpetas que ya existen y puede estar en un nivel anidado.
   *
   * Va aparte de `doc` porque el backend sanitiza con path.basename() y se quedaría
   * solo con el último tramo de una ruta anidada, apuntando a la carpeta equivocada.
   */
  sub?: string | null;
};

/**
 * Devuelve la ruta UNC de la carpeta del agente, opcionalmente apuntando a una
 * subcarpeta. Ver OpcionesCarpeta: `doc` crea si falta, `sub` nunca crea.
 */
export async function rutaCarpetaAgente(
  dni: number | string,
  opts: OpcionesCarpeta = {},
): Promise<RutaCarpeta> {
  const res = await apiFetch<{ ok: boolean; data: { uncRel: string; creada: boolean } }>(
    '/tramites-documentales/abrir-carpeta',
    { method: 'POST', body: JSON.stringify({ dni, doc: opts.doc || undefined }) },
  );
  const sub = (opts.sub || '').replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
  const rel = sub ? `${res.data.uncRel}\\${sub}` : res.data.uncRel;
  return {
    unc: `\\\\${window.location.hostname}\\${rel}`,
    creada: !!res.data.creada,
  };
}

/** Copia texto al portapapeles. Devuelve si lo logró (http no seguro lo bloquea). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Fallback para contexto http no seguro, donde navigator.clipboard no existe.
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Invoca el handler `p5abrir:` para que Windows abra el Explorador en esa ruta.
 * No hay forma de saber desde JS si el handler existe: si no está instalado,
 * simplemente no ocurre nada (por eso el llamador copia la ruta igual).
 */
export function lanzarExplorador(unc: string): void {
  window.location.href = `p5abrir:${encodeURIComponent(unc)}`;
}

/**
 * Todo junto: resuelve la ruta, intenta abrir el Explorador y deja la ruta en el
 * portapapeles como respaldo. Devuelve la ruta y si quedó copiada, para el toast.
 */
export async function abrirCarpetaEnExplorador(
  dni: number | string,
  opts: OpcionesCarpeta = {},
): Promise<{ unc: string; copiado: boolean; creada: boolean }> {
  const { unc, creada } = await rutaCarpetaAgente(dni, opts);
  const copiado = await copiarTexto(unc);
  lanzarExplorador(unc);
  return { unc, copiado, creada };
}
