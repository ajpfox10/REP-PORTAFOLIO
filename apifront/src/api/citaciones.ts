import { apiFetch } from './http';
import { loadSession } from '../auth/session';

export function getOperadorActual(): { nombre: string; usuarioId: number | null } {
  const session = loadSession();
  const user: any = session?.user || {};
  return {
    nombre: user?.nombre || user?.email || (user?.id ? `Usuario #${user.id}` : 'anon'),
    usuarioId: user?.id ?? null,
  };
}

export async function atenderCitacion(citacion: any) {
  const cierreCitacion = new Date().toISOString();
  const operador = getOperadorActual();
  const explicacion = [
    `Citación #${citacion.id}`,
    citacion.motivo ? `Motivo: ${citacion.motivo}` : null,
    citacion.citado_por ? `Citado por: ${citacion.citado_por}` : null,
  ].filter(Boolean).join(' | ');

  await apiFetch<any>(`/citaciones/${citacion.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      citacion_activa: 0,
      cierre_citacion: cierreCitacion,
    }),
  });

  const consultaRes = await apiFetch<any>('/consultas', {
    method: 'POST',
    body: JSON.stringify({
      dni: citacion.dni,
      motivo_consulta: 'Citación atendida',
      explicacion,
      atendido_por: operador.nombre,
      hora_atencion: cierreCitacion,
      impreso: 'si',
    }),
  });

  await apiFetch('/citaciones_vistas', {
    method: 'POST',
    body: JSON.stringify({
      citacion_id: citacion.id,
      visto_por: operador.nombre,
      usuario_id: operador.usuarioId,
      accion: 'atendida_con_ticket',
    }),
  }).catch(() => {});

  return {
    cierreCitacion,
    consulta: consultaRes?.data ?? consultaRes,
    operador: operador.nombre,
    explicacion,
  };
}
