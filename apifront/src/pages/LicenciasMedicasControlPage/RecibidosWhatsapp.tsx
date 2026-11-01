// src/pages/LicenciasMedicasControlPage/RecibidosWhatsapp.tsx
// "📥 Recibidos por WhatsApp": la extensión (acción RECIBIDOS) lee de la memoria del WhatsApp Web
// abierto los mensajes que nos mandaron — sin abrir chats ni marcarlos como leídos, sin el texto —
// y se guardan en whatsapp_recibidos (POST, no duplica). El resumen (GET) cuenta por día y por
// remitente, cruzado con los agentes por celular y con el último aviso de licencia enviado.
// WhatsApp Web solo tiene lo reciente de cada chat: hay que leer seguido para no perder mensajes.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel } from '../../utils/export';
import { ANIOS, MESES, normTxt, rangoDe } from './shared';

interface MsgExt { id: string; numero: string; t: number; nombre: string }
interface AgenteR { dni: string; apellido: string; nombre: string; activo: boolean; telefono?: string }
interface Persona {
  numero: string; nombre_wa: string; cantidad: number; primero: string; ultimo: string;
  agente: AgenteR | null;
  /** NUMERO = su celular de la base · NOMBRE = por el nombre agendado (teléfono distinto en la base) · VARIOS = varios agentes con ese nombre */
  cruce: 'NUMERO' | 'NOMBRE' | 'VARIOS' | null;
  candidatos: AgenteR[];
  otros_agentes: number; ultimo_aviso: string | null; respondio: boolean;
}
interface Resp {
  ok: boolean;
  resumen: {
    mensajes: number; personas: number; agentes: number; sin_agente: number; telefono_distinto: number; varios: number;
    respondieron: number; ultima_lectura: string | null;
  };
  por_dia: { dia: string; mensajes: number; personas: number }[];
  por_franja: { franja: Franja; mensajes: number; personas: number }[];
  personas: Persona[];
}
type Filtro = 'TODOS' | 'AGENTES' | 'TEL_DISTINTO' | 'VARIOS' | 'SIN_AGENTE' | 'RESPONDIERON';
const TXT_CRUCE: Record<string, string> = { NUMERO: 'Por número', NOMBRE: 'Por nombre (teléfono distinto)', VARIOS: 'Varios posibles' };
type Franja = 'MANANA' | 'TARDE' | 'NOCHE' | 'FINDE';
const FRANJAS: { f: Franja; txt: string; ayuda: string }[] = [
  { f: 'MANANA', txt: '🌅 Mañana', ayuda: 'Lunes a viernes de 6 a 12' },
  { f: 'TARDE', txt: '☀️ Tarde', ayuda: 'Lunes a viernes de 12 a 18' },
  { f: 'NOCHE', txt: '🌙 Noche', ayuda: 'Lunes a viernes de 18 a 6' },
  { f: 'FINDE', txt: '📅 Fin de semana', ayuda: 'Sábado y domingo, todo el día' },
];
const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const haceDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const fmtHora = (s: string | null) => (s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtNum = (n: string) => (n.startsWith('549') && n.length === 13 ? `+54 9 ${n.slice(3, 5)} ${n.slice(5, 9)}-${n.slice(9)}` : `+${n}`);

/** Barras por día (hasta 62 días) o por mes (rangos más largos), con los días sin mensajes en 0. */
function BarrasPorDia({ desde, hasta, porDia }: { desde: string; hasta: string; porDia: Resp['por_dia'] }) {
  const barras = useMemo(() => {
    const d0 = new Date(`${desde}T00:00:00Z`), d1 = new Date(`${hasta}T00:00:00Z`);
    const dias = Math.round((+d1 - +d0) / 86400000) + 1;
    const porMes = dias > 62;
    const m = new Map<string, { mensajes: number; personas: number }>();
    for (const x of porDia) {
      const k = porMes ? x.dia.slice(0, 7) : x.dia;
      const v = m.get(k) || { mensajes: 0, personas: 0 };
      // por mes, "personas" es la suma de las de cada día (alguien que escribió 2 días cuenta 2)
      m.set(k, { mensajes: v.mensajes + x.mensajes, personas: v.personas + x.personas });
    }
    const out: { k: string; label: string; titulo: string; finde: boolean; mensajes: number; personas: number }[] = [];
    for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (porMes) {
        const k = iso.slice(0, 7);
        if (out.length && out[out.length - 1].k === k) continue;
        const mes = MES_CORTO[Number(k.slice(5, 7)) - 1];
        out.push({ k, label: mes, titulo: `${mes} ${k.slice(0, 4)}`, finde: false, ...(m.get(k) || { mensajes: 0, personas: 0 }) });
      } else {
        const dow = d.getUTCDay();
        out.push({ k: iso, label: iso.slice(8, 10), titulo: fmtDia(iso), finde: dow === 0 || dow === 6, ...(m.get(iso) || { mensajes: 0, personas: 0 }) });
      }
    }
    return { out, porMes };
  }, [desde, hasta, porDia]);

  const max = Math.max(1, ...barras.out.map(b => b.mensajes));
  const cada = barras.out.length > 31 ? Math.ceil(barras.out.length / 31) : 1;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 4 }}>
        Mensajes por {barras.porMes ? 'mes' : 'día'}{!barras.porMes && ' · fin de semana en gris'}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 130, borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
        {barras.out.map(b => (
          <div key={b.k} title={`${b.titulo}: ${b.mensajes} mensajes · ${b.personas} personas${barras.porMes ? ' (suma diaria)' : ''}`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            {b.mensajes > 0 && barras.out.length <= 31 && <span style={{ fontSize: '0.62rem' }}>{b.mensajes}</span>}
            <div style={{
              width: '100%', height: `${(b.mensajes / max) * 100}%`, minHeight: b.mensajes ? 2 : 0,
              background: b.finde ? 'rgba(148,163,184,0.55)' : 'rgba(74,222,128,0.75)', borderRadius: '3px 3px 0 0',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {barras.out.map((b, i) => (
          <span key={b.k} className="muted" style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: '0.6rem', overflow: 'hidden' }}>
            {i % cada === 0 ? b.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RecibidosWhatsapp({ pedirExtension, onCerrar }: {
  pedirExtension: (type: string, payload?: any, ms?: number) => Promise<any>;
  onCerrar?: () => void;
}) {
  const toast = useToast();
  const [desde, setDesde] = useState(haceDias(0));
  const [hasta, setHasta] = useState(haceDias(0));
  const [datos, setDatos] = useState<Resp | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [q, setQ] = useState('');
  const [anio, setAnio] = useState(Number(haceDias(0).slice(0, 4)));
  const [mes, setMes] = useState(haceDias(0).slice(5, 7));
  // rango que muestra el gráfico: el último consultado (no lo que se está tipeando en las fechas)
  const [vista, setVista] = useState({ desde, hasta });
  // confirmación de "Actualizar en la base": número de WhatsApp → personal.telefono del agente
  const [actualizar, setActualizar] = useState<{ p: Persona; agente: AgenteR } | null>(null);

  const consultar = async (d = desde, h = hasta) => {
    setVista({ desde: d, hasta: h });
    try {
      setDatos(await apiFetch<Resp>(`/licencias-medicas-control/whatsapp/recibidos?desde=${d}&hasta=${h}`));
    } catch (e: any) {
      toast.error('Recibidos', e?.message || 'Error');
    }
  };
  useEffect(() => { consultar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leer = async () => {
    setLeyendo(true);
    try {
      const ext = await pedirExtension('RECIBIDOS', undefined, 60000);
      if (!ext?.ok) throw new Error(ext?.detalle || 'No se pudieron leer los mensajes de WhatsApp');
      const msgs: MsgExt[] = ext.mensajes || [];
      let nuevos = 0;
      // de a 300 para no pasar el límite de tamaño del body de la API
      for (let i = 0; i < msgs.length; i += 300) {
        const r = await apiFetch<{ ok: boolean; nuevos: number }>('/licencias-medicas-control/whatsapp/recibidos', {
          method: 'POST', body: JSON.stringify({ mensajes: msgs.slice(i, i + 300) }),
        });
        nuevos += r.nuevos || 0;
      }
      toast.ok('WhatsApp leído', `${msgs.length} mensajes recibidos en ${ext.chats} chats · ${nuevos} nuevos guardados`);
      await consultar();
    } catch (e: any) {
      toast.error('Recibidos', e?.message || 'Error');
    } finally {
      setLeyendo(false);
    }
  };

  const rango = (d: string, h: string) => { setDesde(d); setHasta(h); consultar(d, h); };
  const porMes = (a: number, m: string) => { setAnio(a); setMes(m); const r = rangoDe(a, m); rango(r.desde, r.hasta); };

  const visibles = useMemo(() => {
    const nq = normTxt(q).trim();
    return (datos?.personas || []).filter(p => {
      if (filtro === 'AGENTES' && !p.agente) return false;
      if (filtro === 'TEL_DISTINTO' && p.cruce !== 'NOMBRE') return false;
      if (filtro === 'VARIOS' && p.cruce !== 'VARIOS') return false;
      if (filtro === 'SIN_AGENTE' && p.cruce) return false;
      if (filtro === 'RESPONDIERON' && !p.respondio) return false;
      if (!nq) return true;
      return normTxt(`${p.nombre_wa} ${p.agente?.apellido} ${p.agente?.nombre} ${p.agente?.dni}`).includes(nq) || p.numero.includes(nq);
    });
  }, [datos, filtro, q]);

  const exportar = () => exportToExcel(`whatsapp_recibidos_${desde}_${hasta}`, visibles.map(p => ({
    'Número': fmtNum(p.numero),
    'Nombre en WhatsApp': p.nombre_wa,
    Agente: p.agente ? `${p.agente.apellido}, ${p.agente.nombre}` : '',
    DNI: p.agente?.dni || '',
    'Activo': p.agente ? (p.agente.activo ? 'Sí' : 'No') : '',
    Cruce: p.cruce ? TXT_CRUCE[p.cruce] : 'Sin agente',
    'Teléfono en la base': p.cruce === 'NOMBRE' ? (p.agente?.telefono || '(sin teléfono)')
      : p.cruce === 'VARIOS' ? p.candidatos.map(c => `${c.apellido}, ${c.nombre}: ${c.telefono || '(sin teléfono)'}`).join(' | ') : '',
    Mensajes: p.cantidad,
    'Primero': fmtHora(p.primero),
    'Último': fmtHora(p.ultimo),
    'Último aviso de licencia': fmtHora(p.ultimo_aviso),
    'Respondió al aviso': p.respondio ? 'Sí' : '',
  })));

  const r = datos?.resumen;
  const tarjetas: { f: Filtro; txt: string; n: number | undefined; color: string }[] = [
    { f: 'TODOS', txt: '💬 Mensajes', n: r?.mensajes, color: 'rgba(124,58,237,0.25)' },
    { f: 'TODOS', txt: '👥 Personas', n: r?.personas, color: 'rgba(124,58,237,0.25)' },
    { f: 'AGENTES', txt: '🪪 Agentes', n: r?.agentes, color: 'rgba(34,197,94,0.22)' },
    { f: 'TEL_DISTINTO', txt: '⚠️ Teléfono distinto en la base', n: r?.telefono_distinto, color: 'rgba(249,115,22,0.28)' },
    { f: 'VARIOS', txt: '❓ Varios posibles', n: r?.varios, color: 'rgba(234,179,8,0.25)' },
    { f: 'SIN_AGENTE', txt: '❔ Sin agente', n: r?.sin_agente, color: 'rgba(100,116,139,0.3)' },
    { f: 'RESPONDIERON', txt: '↩️ Respondieron a un aviso', n: r?.respondieron, color: 'rgba(234,179,8,0.25)' },
  ];

  return (
    <div className="card" style={{ padding: 12, marginBottom: 12, border: '1px solid rgba(34,197,94,0.3)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>📥 Recibidos por WhatsApp</b>
        <button type="button" className="btn" onClick={leer} disabled={leyendo}>
          {leyendo ? 'Leyendo WhatsApp…' : '⬇️ Leer WhatsApp ahora'}
        </button>
        {r?.ultima_lectura && <span className="muted" style={{ fontSize: '0.75rem' }}>Última lectura: {fmtHora(r.ultima_lectura)}</span>}
        <span style={{ flex: 1 }} />
        {onCerrar && <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>}
      </div>
      <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
        Lee los mensajes que llegaron al WhatsApp Web abierto sin abrir los chats ni marcarlos como leídos, y sin guardar el texto.
        WhatsApp Web solo tiene lo reciente de cada chat: conviene leer todos los días.
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} />
        <span className="muted">a</span>
        <input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} />
        <button type="button" className="btn" onClick={() => consultar()}>Ver</button>
        <button type="button" className="btn" onClick={() => rango(haceDias(0), haceDias(0))}>Hoy</button>
        <button type="button" className="btn" onClick={() => rango(haceDias(6), haceDias(0))}>7 días</button>
        <button type="button" className="btn" onClick={() => rango(haceDias(29), haceDias(0))}>30 días</button>
        <span className="muted" style={{ margin: '0 4px' }}>·</span>
        <select className="input" value={mes} onChange={e => porMes(anio, e.target.value)} aria-label="Mes">
          <option value="">Todo el año</option>
          {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
        </select>
        <select className="input" value={anio} onChange={e => porMes(Number(e.target.value), mes)} aria-label="Año">
          {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {datos && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {tarjetas.map(t => (
              <button key={t.txt} type="button" className="btn" onClick={() => setFiltro(t.f)}
                style={{ padding: '6px 12px', textAlign: 'left', background: filtro === t.f && t.f !== 'TODOS' ? t.color : undefined }}>
                <div style={{ fontSize: '0.72rem' }} className="muted">{t.txt}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{t.n ?? 0}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {FRANJAS.map(fr => {
              const v = datos.por_franja.find(x => x.franja === fr.f);
              const pct = r?.mensajes ? Math.round(((v?.mensajes || 0) / r.mensajes) * 100) : 0;
              return (
                <div key={fr.f} className="card" title={fr.ayuda} style={{ padding: '5px 10px', fontSize: '0.75rem', minWidth: 120 }}>
                  <div className="muted">{fr.txt}</div>
                  <div><b style={{ fontSize: '1rem' }}>{v?.mensajes || 0}</b> <span className="muted">msj · {pct}% · {v?.personas || 0} 👤</span></div>
                </div>
              );
            })}
          </div>

          {vista.desde !== vista.hasta && <BarrasPorDia desde={vista.desde} hasta={vista.hasta} porDia={datos.por_dia} />}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              {filtro === 'TODOS' ? 'Todos' : tarjetas.find(t => t.f === filtro)?.txt} · {visibles.length}
            </span>
            {filtro !== 'TODOS' && <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.75rem' }} onClick={() => setFiltro('TODOS')}>Ver todos</button>}
            <input className="input" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 160px', minWidth: 140 }} />
            <button type="button" className="btn" onClick={exportar} disabled={!visibles.length}>⬇️ Excel</button>
          </div>

          <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '6px' }}>Quién</th>
                  <th style={{ padding: '6px' }}>Número</th>
                  <th style={{ padding: '6px', textAlign: 'right' }}>Mensajes</th>
                  <th style={{ padding: '6px' }}>Último</th>
                  <th style={{ padding: '6px' }}>Aviso de licencia</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 12, textAlign: 'center' }}>
                  {datos.personas.length ? 'Nada en este filtro.' : 'Sin mensajes guardados en el período. Tocá “Leer WhatsApp ahora”.'}
                </td></tr>}
                {visibles.map(p => (
                  <tr key={p.numero} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '5px 6px' }}>
                      {p.agente
                        ? <>{p.agente.apellido}, {p.agente.nombre} <span className="muted" style={{ fontSize: '0.72rem' }}>· DNI {p.agente.dni}{!p.agente.activo && ' · no activo'}{p.otros_agentes > 0 && ` · +${p.otros_agentes} con el mismo número`}</span></>
                        : p.cruce === 'VARIOS' ? <b>❓ Varios agentes con ese nombre</b>
                        : <span className="muted">Sin agente</span>}
                      {p.nombre_wa && <div className="muted" style={{ fontSize: '0.7rem' }}>WhatsApp: {p.nombre_wa}</div>}
                      {p.cruce === 'NOMBRE' && p.agente && (
                        <div style={{ marginTop: 3, fontSize: '0.75rem', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="badge" style={{ background: 'rgba(249,115,22,0.28)' }}>
                            ⚠️ En la base tiene {p.agente.telefono ? <>otro teléfono: <b>{p.agente.telefono}</b></> : <b>sin teléfono</b>}
                          </span>
                          <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.72rem' }} onClick={() => setActualizar({ p, agente: p.agente! })}>📲 Actualizar en la base</button>
                        </div>
                      )}
                      {p.cruce === 'VARIOS' && p.candidatos.map(c => (
                        <div key={c.dni} style={{ marginTop: 3, fontSize: '0.75rem', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{c.apellido}, {c.nombre} <span className="muted">· DNI {c.dni} · en la base: {c.telefono || 'sin teléfono'}</span></span>
                          <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.72rem' }} onClick={() => setActualizar({ p, agente: c })}>Es este</button>
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{fmtNum(p.numero)}</td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 700 }}>{p.cantidad}</td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{fmtHora(p.ultimo)}</td>
                    <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>
                      {p.ultimo_aviso
                        ? <>{fmtHora(p.ultimo_aviso)} {p.respondio && <span className="badge" style={{ background: 'rgba(234,179,8,0.25)' }}>↩️ respondió</span>}</>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {actualizar && (
        <ActualizarTelefono numero={actualizar.p.numero} agente={actualizar.agente}
          onCerrar={() => setActualizar(null)}
          onGuardado={() => { setActualizar(null); void consultar(vista.desde, vista.hasta); }} />
      )}
    </div>
  );
}

/** Confirmación con el antes/después: el número de WhatsApp va a personal.telefono del agente,
 *  adelante de lo que había (recomendado: no se pierde un fijo u otro número y los avisos usan el
 *  primero) o reemplazándolo. Formato "+54 9 11 6172-4555": celularDe lo lee como celular. */
function ActualizarTelefono({ numero, agente, onCerrar, onGuardado }: {
  numero: string; agente: AgenteR; onCerrar: () => void; onGuardado: () => void;
}) {
  const toast = useToast();
  const nuevo = fmtNum(numero);
  const antes = (agente.telefono || '').trim();
  const adelante = antes ? `${nuevo} / ${antes}` : nuevo;
  const entra = adelante.length <= 50; // personal.telefono es VARCHAR(50)
  const [modo, setModo] = useState<'ADELANTE' | 'REEMPLAZAR'>(antes && entra ? 'ADELANTE' : 'REEMPLAZAR');
  const [guardando, setGuardando] = useState(false);
  const despues = modo === 'ADELANTE' ? adelante : nuevo;

  const guardar = async () => {
    setGuardando(true);
    try {
      await apiFetch('/licencias-medicas-control/whatsapp/telefono', {
        method: 'PUT', body: JSON.stringify({ dni: Number(agente.dni), telefono: despues }),
      });
      toast.ok('Teléfono actualizado', `${agente.apellido}, ${agente.nombre}: ${despues}`);
      onGuardado();
    } catch (e: any) {
      toast.error('No se pudo actualizar', e?.message || 'Error');
      setGuardando(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ padding: 16, maxWidth: 520, width: '100%', fontSize: '0.85rem' }}>
        <b>📲 Actualizar teléfono en la base</b>
        <div style={{ marginTop: 8 }}>{agente.apellido}, {agente.nombre} <span className="muted">· DNI {agente.dni}</span></div>
        <table style={{ marginTop: 10, borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr><td className="muted" style={{ padding: '3px 8px 3px 0', whiteSpace: 'nowrap' }}>Hoy en la base</td><td>{antes || <i className="muted">sin teléfono</i>}</td></tr>
            <tr><td className="muted" style={{ padding: '3px 8px 3px 0', whiteSpace: 'nowrap' }}>Escribe desde</td><td><b>{nuevo}</b></td></tr>
          </tbody>
        </table>
        {antes && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', opacity: entra ? 1 : 0.5 }}>
              <input type="radio" checked={modo === 'ADELANTE'} disabled={!entra} onChange={() => setModo('ADELANTE')} />
              <span>Poner el de WhatsApp <b>adelante</b> y dejar lo anterior (recomendado)
                {!entra && <span className="muted"> — no entra: el campo admite 50 caracteres</span>}</span>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <input type="radio" checked={modo === 'REEMPLAZAR'} onChange={() => setModo('REEMPLAZAR')} />
              <span><b>Reemplazar</b> todo por el de WhatsApp</span>
            </label>
          </div>
        )}
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(34,197,94,0.12)', borderRadius: 6 }}>
          <span className="muted">Va a quedar: </span><b>{despues}</b>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn" onClick={guardar} disabled={guardando} style={{ fontWeight: 700, background: 'rgba(34,197,94,0.3)' }}>
            {guardando ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
