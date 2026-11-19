// src/pages/LegajoPage/LegajoEnlaceBlock.tsx
// Legajo por enlace (mig 138): la oficina le manda al agente un enlace único para que complete él mismo
// los datos del legajo desde el celular (hoja 1, familia, incompatibilidad, bienes, DJ). Lo que manda queda
// "para revisar" en Legajo → 📥 Recibidos por enlace, y recién al aprobar se carga.
// Se usa en la ficha de Gestión (Info) y en /app/legajo. Backend: /legajo/enlace/* (legajoEnlace.routes.ts).
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { escribirWhatsapp, copiarConAviso } from '../../utils/whatsappAgente';

interface Enlace {
  id: number; token: string | null; estado: 'HABILITADO' | 'ENVIADO' | 'DEVUELTO' | 'APROBADO' | 'ANULADO' | 'VENCIDO';
  vence_el: string; enviado_at: string | null; revisado_at: string | null; devolucion_motivo: string | null; creado: string;
}
interface Resp {
  agente: { dni: number; apellido: string; nombre: string; activo: boolean; celular: string | null; dudoso: boolean };
  enlace: Enlace | null; url_publica: string; plantilla: string; dias_default: number;
}

const fmt = (f?: string | null) => (f ? f.slice(0, 10).split('-').reverse().join('/') + (f.length > 10 ? ` ${f.slice(11, 16)}` : '') : '');
const tc = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const btn: React.CSSProperties = {
  padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b',
  color: '#e2e8f0', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

export const linkLegajo = (url: string, token: string) => `${url.replace(/\/+$/, '')}/l/${token}`;
export const mensajeLegajo = (plantilla: string, a: { nombre: string; apellido: string }, url: string, token: string, vence: string) =>
  plantilla.replace(/\{NOMBRE\}/g, tc(a.nombre || '')).replace(/\{APELLIDO\}/g, tc(a.apellido || ''))
    .replace(/\{VENCE\}/g, fmt(vence)).replace(/\{LINK\}/g, linkLegajo(url, token));

export function LegajoEnlaceBlock({ dni, onCambio }: { dni: string; onCambio?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    try { const r = await apiFetch<any>(`/legajo/enlace/agente/${dni}`); setData(r.data); setError(false); }
    catch { setError(true); }
  };
  useEffect(() => { setData(null); if (dni) void cargar(); }, [dni]);
  if (error || !data) return null;   // sin permiso / sin tabla: no ensucia la ficha

  const e = data.enlace;
  const abierto = e && (e.estado === 'HABILITADO' || e.estado === 'DEVUELTO') && e.token;
  const msg = () => (abierto ? mensajeLegajo(data.plantilla, data.agente, data.url_publica, e!.token!, e!.vence_el) : '');

  const post = async (url: string, body: any, okTitulo: string, okMsg: string) => {
    setOcupado(true);
    try {
      const r = await apiFetch<any>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const x = Array.isArray(r.data) ? r.data[0] : null;
      if (x && !x.ok) toast.warning('No se habilitó', x.motivo || '');
      else toast.ok(okTitulo, okMsg);
      await cargar(); onCambio?.();
    } catch (err: any) { toast.error('Legajo por enlace', err?.message); }
    finally { setOcupado(false); }
  };
  const habilitar = () => post('/legajo/enlace/habilitar', { dnis: [Number(dni)], dias: data.dias_default }, 'Enlace listo', 'Ya se le puede mandar por WhatsApp');
  const anular = () => {
    if (!window.confirm('¿Anular el enlace del legajo? Ya no va a poder usarlo (lo que haya cargado no se pasa al legajo).')) return;
    void post(`/legajo/enlace/${e!.id}/anular`, {}, 'Anulado', 'El enlace ya no abre');
  };

  return (
    <div className="agente-servicio-block">
      <span className="agente-servicio-title">Legajo por enlace</span>
      {!data.url_publica && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>Falta la dirección pública (es la misma de la Agenda de turnos → Configurar).</div>
      )}
      {e && (
        <div style={{ fontSize: '0.8rem', marginTop: 3, color: '#e2e8f0' }}>
          {e.estado === 'HABILITADO' && <span style={{ color: '#fbbf24' }}>🔗 Enlace enviado el {fmt(e.creado)}, todavía no lo mandó · vence {fmt(e.vence_el)}</span>}
          {e.estado === 'DEVUELTO' && <span style={{ color: '#fbbf24' }}>↩️ Devuelto para corregir ({e.devolucion_motivo}) · vence {fmt(e.vence_el)}</span>}
          {e.estado === 'ENVIADO' && <span style={{ color: '#22d3ee' }}>📥 Lo completó el {fmt(e.enviado_at)}: está para revisar en Legajo → Recibidos por enlace</span>}
          {e.estado === 'APROBADO' && <span style={{ color: '#34d399' }}>✅ Cargado al legajo el {fmt(e.revisado_at)} (lo completó el agente)</span>}
          {e.estado === 'VENCIDO' && <span style={{ color: '#64748b' }}>El último enlace venció el {fmt(e.vence_el)} sin enviarse</span>}
          {e.estado === 'ANULADO' && <span style={{ color: '#64748b' }}>El último enlace fue anulado</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {abierto ? (
          <>
            <button type="button" style={btn} disabled={!data.url_publica || ocupado}
              title={data.agente.celular ? `WhatsApp a ${data.agente.celular}${data.agente.dudoso ? ' (celular dudoso)' : ''}` : 'Sin celular en la base'}
              onClick={async () => { setOcupado(true); try { await escribirWhatsapp(toast, data.agente, msg()); } finally { setOcupado(false); } }}>
              {ocupado ? '⏳…' : '📲 WhatsApp'}
            </button>
            <button type="button" style={btn} disabled={!data.url_publica} onClick={() => void copiarConAviso(toast, msg(), 'Mensaje con el enlace')}>Copiar mensaje</button>
            <button type="button" style={btn} disabled={!data.url_publica} onClick={() => void copiarConAviso(toast, linkLegajo(data.url_publica, e!.token!), 'Enlace')}>🔗 Copiar enlace</button>
            <button type="button" style={{ ...btn, color: '#f87171' }} disabled={ocupado} onClick={anular}>Anular</button>
          </>
        ) : e?.estado === 'ENVIADO' ? null : !data.agente.activo ? (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Solo para agentes activos.</span>
        ) : (
          <button type="button" style={{ ...btn, background: '#4338ca', borderColor: '#4338ca', fontWeight: 600 }} disabled={ocupado} onClick={() => void habilitar()}
            title="Genera un enlace único para que el agente complete sus datos del legajo desde el celular">
            {ocupado ? 'Habilitando…' : e?.estado === 'APROBADO' ? '📝 Mandar de nuevo para actualizar el legajo' : '📝 Mandar enlace para completar el legajo'}
          </button>
        )}
      </div>
    </div>
  );
}
