/**
 * @file infra/invalidateOnWrite.ts
 * @description Patron "Invalida al Escribir" (Invalidate-on-Write) para cache.
 *
 * --- Para quien no sabe de sistemas ---
 * Imaginate una pizarra con la lista de empleados que se actualiza cada hora.
 * Si alguien entra o sale, esperamos hasta la proxima hora para actualizar la pizarra.
 * Con "invalidar al escribir", ni bien hay un cambio BORRAMOS la pizarra vieja.
 * La proxima vez que alguien mire, se genera una pizarra nueva y fresca.
 * Resultado: los datos siempre estan al dia, sin esperar que expire el cache.
 *
 * --- Tecnicamente ---
 * Cuando una operacion de escritura (POST/PUT/PATCH/DELETE) se ejecuta exitosamente,
 * este modulo invalida (elimina) las entradas de cache relacionadas usando "tags".
 *
 * Ejemplo de flujo:
 *   GET /api/v1/personal?dni=12345  → se cachea con tag "personal:12345"
 *   PUT /api/v1/personal/12345      → invalidate("personal:12345") → borra el cache
 *   GET /api/v1/personal?dni=12345  → cache miss → consulta BD fresca → cachea de nuevo
 *
 * REGLAS DE TAGS (convencion del proyecto):
 *   personal:{dni}       → datos de un agente especifico
 *   personal:list        → listados de personal
 *   documents:{id}       → archivo especifico
 *   documents:dni:{dni}  → todos los docs de un agente
 *   eventos:{dni}        → eventos de un agente
 *   agentes:{dni}        → datos del agente
 */

import { cacheInvalidateTags } from './cache';
import { logger } from '../logging/logger';

// ─── Tag builders ─────────────────────────────────────────────────────────────

/** Tags de cache para operaciones de personal */
export const personalTags = {
  byDni:  (dni: number | string) => `personal:${dni}`,
  list:   () => 'personal:list',
  all:    (dni: number | string) => [`personal:${dni}`, 'personal:list'],
};

/** Tags de cache para documentos */
export const documentTags = {
  byId:   (id: number | string)         => `documents:${id}`,
  byDni:  (dni: number | string)         => `documents:dni:${dni}`,
  list:   () => 'documents:list',
  all:    (id: number | string, dni: number | string) =>
            [`documents:${id}`, `documents:dni:${dni}`, 'documents:list'],
};

/** Tags de cache para agentes */
export const agenteTags = {
  byDni:  (dni: number | string) => `agentes:${dni}`,
  list:   () => 'agentes:list',
  all:    (dni: number | string) => [`agentes:${dni}`, 'agentes:list'],
};

/** Tags de cache para eventos */
export const eventoTags = {
  byDni:  (dni: number | string) => `eventos:${dni}`,
  list:   () => 'eventos:list',
};

// ─── Invalidator central ──────────────────────────────────────────────────────

/**
 * Invalida una lista de tags de cache.
 * Se llama DESPUES de cualquier escritura exitosa en la BD.
 * Si Redis no esta disponible, simplemente loguea y sigue (no rompe la operacion).
 *
 * @param tags - Array de strings o string unico a invalidar
 * @param context - Descripcion de quien llama (para logs). Ej: "agente.alta"
 */
export async function invalidate(
  tags: string | string[],
  context = 'unknown'
): Promise<void> {
  const tagList = Array.isArray(tags) ? tags : [tags];
  if (!tagList.length) return;

  try {
    await cacheInvalidateTags(tagList);
    logger.debug({ msg: 'Cache invalidado', tags: tagList, context });
  } catch (err: any) {
    // NO propagar el error - si el cache falla, la operacion igual fue exitosa
    logger.warn({ msg: 'Cache invalidation fallida (no critico)', tags: tagList, context, err: err?.message });
  }
}

/**
 * Decorator para metodos de service que hacen escrituras.
 * Invalida tags automaticamente cuando el metodo se completa sin error.
 *
 * USO:
 *   @InvalidateOnWrite(['personal:list', (args) => `personal:${args[0]}`])
 *   async updatePersonal(dni: number, data: UpdateDto) { ... }
 *
 * Como alternativa sin decorators (compatible con cualquier build):
 *   const result = await myService.update(dni, data);
 *   await invalidate(personalTags.all(dni), 'personal.update');
 */
export function InvalidateOnWrite(
  tags: Array<string | ((...args: any[]) => string | string[])>
) {
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const result = await original.apply(this, args);
      // Solo invalida si el metodo no lanzó excepcion
      const resolvedTags = tags.flatMap((t) =>
        typeof t === 'function' ? t(...args) : t
      );
      await invalidate(resolvedTags, propertyKey);
      return result;
    };
    return descriptor;
  };
}
