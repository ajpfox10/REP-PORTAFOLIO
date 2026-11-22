// ColaEnvios — panel de la cola de envíos por WhatsApp (mig 143) en "Habilitar y enviar".
// Muestra qué PC está mandando, el tilde "Esta PC manda los mensajes de la agenda" y cómo va cada mensaje
// (en cola / mandando / enviado ✅ / error ❌ / salteado porque ya tenía turno). Se refresca solo.
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { designarPcAgenda, esPcAgenda, nombrePcAgenda, pcIdAgenda, setNombrePcAgenda, versionExtensionAgenda } from './envioCola';

interface Fila {
  id: number; habilitacion_id: number; dni: number; apellido: string; nombre: string;
  estado: 'PENDIENTE' | 'TOMADO' | 'ENVIADO' | 'ERROR' | 'SALTEADO' | 'CANCELADO' | 'RETENIDO';
  sin_leer: number | null; mensajes: { t: number | null; tipo: string; texto: string }[]; forzar: boolean;
  prueba_destino: string | null; celular: string | null; pc: string | null; detalle: string | null; intentos: number;
  created_at: string; tomado_at: string | null; terminado_at: string | null;
}
interface Pc { nombre: string; segundos: number; version: string | null; pausa: string | null }
interface PcConectada {
  id: string; nombre: string; usuario: string | null; version: string | null; whatsapp: boolean | null; whatsapp_listo: boolean | null;
  segundos: number; manda: boolean; ip?: string; red?: string | null; app_vieja?: boolean; inactiva?: boolean; pedidos?: number;
}

const ESTADO: Record<Fila['estado'], { txt: string; color: string }> = {
  PENDIENTE: { txt: '⏳ en cola', color: '#fbbf24' },
  TOMADO: { txt: '📤 mandando…', color: '#60a5fa' },
  ENVIADO: { txt: '✅ enviado', color: '#4ade80' },
  ERROR: { txt: '❌ error', color: '#f87171' },
  SALTEADO: { txt: '⏭ salteado', color: '#94a3b8' },
  CANCELADO: { txt: '✖ cancelado', color: '#94a3b8' },
  RETENIDO: { txt: '📩 tenía sin leer', color: '#f472b6' },
};
const horaMsg = (t: number | null) => (t ? new Date(t * 1000).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.82rem', verticalAlign: 'top' };
const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const hace = (s: number) => (s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`);
const haceLargo = (s: number) => (s < 3600 ? hace(s) : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`);
const json = (body: any) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function ColaEnvios({ agendaId, recargar, onCambio, soloRetenidos }: { agendaId: number; recargar: number; onCambio: () => void; soloRetenidos?: boolean }) {
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [pcs, setPcs] = useState<Pc[]>([]);
  const [conectadas, setConectadas] = useState<PcConectada[]>([]);
  const [verPcs, setVerPcs] = useState(false);
  const [horasPcs, setHorasPcs] = useState(1);   // PCs que usaron la app en la última 1 h / 24 h / 48 h
  const [estaPc, setEstaPc] = useState(esPcAgenda());
  const [nombre, setNombre] = useState(nombrePcAgenda());
  const [ext, setExt] = useState<string | null | undefined>(undefined);
  const [verTodo, setVerTodo] = useState(false);
  const [filtroRet, setFiltroRet] = useState(!!soloRetenidos);
  useEffect(() => { if (soloRetenidos) setFiltroRet(true); }, [soloRetenidos, recargar]);
  const enviadosAntes = useRef<number | null>(null);

  const cargar = async () => {
    try {
      const [r, c] = await Promise.all([
        apiFetch<any>(`/agenda-turnos/cola?agenda_id=${agendaId}`),
        apiFetch<any>(`/agenda-turnos/pcs?horas=${horasPcs}`).catch(() => null),
      ]);
      if (c?.data) {
        setConectadas(c.data.pcs || []);
        setEstaPc(!!c.data.manda && c.data.manda.id === pcIdAgenda());
      }
      const f: Fila[] = r.data?.filas || [];
      setFilas(f); setPcs(r.data?.pcs || []);
      // salió alguno nuevo → la lista de enlaces cambia (sale de "Para reenviar")
      const terminados = f.filter(x => x.estado === 'ENVIADO' || x.estado === 'SALTEADO' || x.estado === 'RETENIDO').length;
      if (enviadosAntes.current !== null && terminados !== enviadosAntes.current) onCambio();
      enviadosAntes.current = terminados;
    } catch { /* noop */ }
  };
  useEffect(() => { void cargar(); }, [agendaId, recargar, horasPcs]);
  const activos = filas.filter(f => f.estado === 'PENDIENTE' || f.estado === 'TOMADO').length;
  useEffect(() => { const t = setInterval(() => void cargar(), activos ? 8_000 : 30_000); return () => clearInterval(t); }, [agendaId, activos]);
  useEffect(() => { void versionExtensionAgenda().then(setExt); }, [estaPc]);

  const marcar = async (v: boolean) => {
    if (v && !ext) { toast.warning('Sin extensión', 'En esta PC no responde la extensión de WhatsApp (Reportes → WhatsApp para instalarla). Sin ella no puede mandar.'); }
    try {
      setNombrePcAgenda(nombre);
      await designarPcAgenda(v ? pcIdAgenda() : null);
      setEstaPc(v);
      if (v) toast.ok('Esta PC manda los mensajes de la agenda', 'Dejá abierta la app y WhatsApp Web en este navegador. Revisa la cola cada 30 s.');
      await cargar();
    } catch (e: any) { toast.error('PC que manda', e?.message); }
  };
  const elegir = async (p: PcConectada | null) => {
    if (p && !p.whatsapp_listo && !window.confirm(`${p.nombre} ${p.whatsapp === false ? 'NO tiene WhatsApp Web abierto' : 'no informa si tiene WhatsApp Web abierto (extensión vieja)'}. ¿Elegirla igual?`)) return;
    try {
      await designarPcAgenda(p ? p.id : null);
      toast.ok(p ? `Manda: ${p.nombre}` : 'Ninguna PC manda', p ? 'Empieza en menos de un minuto (en su próximo aviso).' : 'La cola queda esperando.');
      await cargar();
    } catch (e: any) { toast.error('PC que manda', e?.message); }
  };
  const reintentar = async (f: Fila) => {
    try { await apiFetch(`/agenda-turnos/cola/${f.id}/reintentar`, json({})); await cargar(); } catch (e: any) { toast.error('Reintentar', e?.message); }
  };
  const mandarIgual = async (f: Fila) => {
    if (!window.confirm(`${f.apellido} ${f.nombre} tenía mensajes sin leer. Si se manda el enlace, WhatsApp los marca como leídos.\n\n¿Mandar igual?`)) return;
    try { await apiFetch(`/agenda-turnos/cola/${f.id}/mandar-igual`, json({})); await cargar(); onCambio(); } catch (e: any) { toast.error('Mandar igual', e?.message); }
  };
  const atendido = async (f: Fila) => {
    try { await apiFetch(`/agenda-turnos/cola/${f.id}/atendido`, json({})); await cargar(); onCambio(); } catch (e: any) { toast.error('Atendido', e?.message); }
  };
  const cancelarTodo = async () => {
    if (!window.confirm('¿Sacar de la cola todos los mensajes que todavía no salieron?')) return;
    try { const r = await apiFetch<any>('/agenda-turnos/cola/cancelar', json({ agenda_id: agendaId })); toast.ok('Cola', `${r.cancelados} cancelados`); await cargar(); }
    catch (e: any) { toast.error('Cancelar', e?.message); }
  };

  const cuenta = (e: Fila['estado']) => filas.filter(f => f.estado === e).length;
  const pcActiva = pcs.find(p => p.segundos < 120);
  const visibles = filtroRet ? filas.filter(f => f.estado === 'RETENIDO')
    : verTodo ? filas : filas.filter(f => f.estado !== 'CANCELADO').slice(0, 30);

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.35)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <b>📤 Cola de envío por WhatsApp</b>
        {pcActiva
          ? <span style={{ color: pcActiva.pausa ? '#fbbf24' : '#4ade80' }}>
              {pcActiva.pausa ? '⏸' : '🟢'} Manda: <b>{pcActiva.nombre}</b> ({hace(pcActiva.segundos)}){pcActiva.pausa ? ` · en pausa: ${pcActiva.pausa}` : ''}
            </span>
          : <span style={{ color: activos ? '#f87171' : '#94a3b8' }}>
              {activos ? '🔴' : '⚪'} Ninguna PC está mandando{pcs[0] ? ` (última: ${pcs[0].nombre}, ${hace(pcs[0].segundos)})` : ''}
              {activos ? ': marcá una PC que tenga WhatsApp abierto.' : ''}
            </span>}
        <span className="muted">⏳ {cuenta('PENDIENTE') + cuenta('TOMADO')} · ✅ {cuenta('ENVIADO')} · ❌ {cuenta('ERROR')} · ⏭ {cuenta('SALTEADO')}</span>
        {(cuenta('RETENIDO') > 0 || filtroRet) && (
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#f472b6' }}>
            <input type="checkbox" checked={filtroRet} onChange={(e) => setFiltroRet(e.target.checked)} /> 📩 Solo los que tenían sin leer ({cuenta('RETENIDO')})
          </label>
        )}
        {activos > 0 && <button type="button" className="btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => void cancelarTodo()}>Cancelar los que faltan</button>}
        <button type="button" className="btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => void cargar()}>↻</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: '0.82rem' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={estaPc} onChange={(e) => void marcar(e.target.checked)} />
          <b>Esta PC manda los mensajes de la agenda</b>
        </label>
        <span>Nombre de esta PC</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={() => setNombrePcAgenda(nombre)}
          style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', width: 140 }} />
        <span className="muted">
          Extensión: {ext === undefined ? '…' : ext ? `v${ext} ✔` : 'no responde ✖'} · tiene que estar abierta la app y WhatsApp Web en este navegador.
        </span>
      </div>

      <div style={{ marginTop: 8, fontSize: '0.82rem' }}>
        <button type="button" className="btn" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => setVerPcs(v => !v)}>
          {verPcs ? '▾' : '▸'} 🖥 PCs con la app ({conectadas.filter(p => !p.inactiva && p.segundos < 600).length} ahora · {conectadas.length} en {horasPcs === 1 ? 'la última hora' : `las últimas ${horasPcs} h`})
        </button>
        {verPcs && (
          <select value={horasPcs} onChange={(e) => setHorasPcs(Number(e.target.value))}
            style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.78rem' }}>
            <option value={1}>Última hora</option>
            <option value={24}>Últimas 24 horas</option>
            <option value={48}>Últimas 48 horas</option>
          </select>
        )}
        {verPcs && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <tbody>
              {conectadas.map(p => (
                <tr key={p.id} style={{ opacity: p.inactiva || p.segundos >= (p.app_vieja ? 600 : 180) ? 0.5 : 1, background: p.manda ? 'rgba(74,222,128,0.08)' : undefined }}>
                  <td style={td}>
                    <b>{p.red || p.nombre}</b>{p.id === pcIdAgenda() ? ' (esta PC)' : ''}
                    <div className="muted" style={{ fontSize: '0.72rem' }}>{p.usuario || 'usuario ?'}{p.ip ? ` · ${p.ip}` : ''}{p.red && p.nombre !== p.red && !p.app_vieja ? ` · ${p.nombre}` : ''}</div>
                  </td>
                  <td style={td}>{p.app_vieja || p.inactiva ? <span className="muted">—</span> : p.version ? `extensión v${p.version}` : <span style={{ color: '#f87171' }}>sin extensión</span>}</td>
                  <td style={td}>
                    {p.inactiva ? <span className="muted">no la está usando ahora</span>
                      : p.app_vieja ? <span style={{ color: '#fbbf24' }} title="Tiene abierta la app de antes de la última actualización: no avisa si tiene WhatsApp ni puede mandar">⚠ app vieja abierta: recargá (F5) en esa PC</span>
                      : p.whatsapp_listo ? <span style={{ color: '#4ade80' }}>WhatsApp ✔</span>
                      : p.whatsapp ? <span style={{ color: '#fbbf24' }}>WhatsApp abierto, cargando / sin sesión</span>
                      : p.whatsapp === false ? <span style={{ color: '#f87171' }}>WhatsApp cerrado</span>
                      : <span className="muted">WhatsApp ? (extensión vieja)</span>}
                  </td>
                  <td style={td}><span className="muted">{p.inactiva ? `usó la app ${haceLargo(p.segundos)}` : p.app_vieja ? `último pedido ${hace(p.segundos)}` : p.segundos < 180 ? `conectada · ${hace(p.segundos)}` : `desconectada · ${hace(p.segundos)}`}</span></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {p.manda
                      ? <><span style={{ color: '#4ade80', fontWeight: 700 }}>✔ manda</span>{' '}<button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} onClick={() => void elegir(null)}>Quitar</button></>
                      : !p.app_vieja && !p.inactiva && <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} disabled={!p.version || p.segundos >= 180} onClick={() => void elegir(p)}>Que mande esta</button>}
                  </td>
                </tr>
              ))}
              {!conectadas.length && <tr><td style={td}><span className="muted">Ninguna PC avisó todavía (avisan cada minuto con la app abierta).</span></td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {filas.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <tbody>
              {visibles.map(f => (
                <tr key={f.id}>
                  <td style={td}>{f.apellido} {f.nombre}<div className="muted" style={{ fontSize: '0.72rem' }}>DNI {f.dni}{f.prueba_destino ? ` · PRUEBA → ${f.prueba_destino}` : f.celular ? ` · ${f.celular}` : ''}</div></td>
                  <td style={{ ...td, color: ESTADO[f.estado].color, whiteSpace: 'nowrap' }}>{ESTADO[f.estado].txt}</td>
                  <td style={td}>
                    <span className="muted">{f.detalle || ''}{f.pc ? `${f.detalle ? ' · ' : ''}${f.pc}` : ''}{f.terminado_at ? ` · ${hora(f.terminado_at)}` : ` · puesto ${hora(f.created_at)}`}</span>
                    {f.mensajes?.length > 0 && (
                      <div style={{ marginTop: 4, padding: '4px 8px', borderLeft: '3px solid #f472b6', background: 'rgba(244,114,182,0.08)', borderRadius: 4 }}>
                        {f.mensajes.map((m, i) => (
                          <div key={i} style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                            <span className="muted" style={{ fontSize: '0.7rem' }}>{horaMsg(m.t)} </span>{m.texto || <i className="muted">({m.tipo})</i>}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {f.estado === 'RETENIDO' && <>
                      <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} onClick={() => void atendido(f)} title="Ya le contestaron: no se manda el enlace">✔ Ya lo atendí</button>{' '}
                      <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} onClick={() => void mandarIgual(f)}>📤 Mandar igual</button>
                    </>}
                    {(f.estado === 'ERROR' || f.estado === 'SALTEADO' || f.estado === 'CANCELADO') &&
                      <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '1px 6px' }} onClick={() => void reintentar(f)}>Reintentar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length > visibles.length && !verTodo && (
            <button type="button" className="btn" style={{ fontSize: '0.75rem', marginTop: 4 }} onClick={() => setVerTodo(true)}>Ver todo ({filas.length})</button>
          )}
        </>
      )}
    </div>
  );
}
