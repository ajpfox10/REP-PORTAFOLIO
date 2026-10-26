// src/pages/MensajesRelojPage/index.tsx
// Mensaje al reloj para MUCHOS agentes: se buscan como en Gestión (DNI o apellido/nombre), se arma la lista
// de elegidos y se manda un solo mensaje. La API (/mensajes-reloj/masivo) lo encola en todos los relojes activos.
import React, { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { RelojesSelector } from '../../components/RelojesSelector';

const MAX = 80;
const MAX_AGENTES = 300;

const VIGENCIAS: Array<[number, string]> = [
  [60, '1 hora'], [240, '4 horas'], [720, '12 horas'], [1440, '24 horas'], [2880, '2 días'], [10080, '7 días'],
];

type Agente = {
  dni: number;
  apellido: string;
  nombre: string;
  estado_empleo?: string | null;
  servicio_nombre?: string | null;
  ocupacion_nombre?: string | null;
};

type Envio = {
  sms_uid: number; creado: string; mensaje: string; vigencia_min: number; estado: string;
  agentes: number; destinatarios: string; creado_por: string | null;
  asignaciones: number; aceptadas: number; con_error: number; en_cola: number;
};

function limpiar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
}

const S: Record<string, React.CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, alignItems: 'start' },
  item: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: '0.82rem' },
  lista: { maxHeight: 360, overflow: 'auto', marginTop: 8 },
  baja: { color: '#fca5a5', fontWeight: 700, fontSize: '0.7rem' },
};

export function MensajesRelojPage() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Agente[]>([]);
  const [pegados, setPegados] = useState('');
  const [elegidos, setElegidos] = useState<Agente[]>([]);
  const [texto, setTexto] = useState('');
  const [vigencia, setVigencia] = useState(1440);
  const [sns, setSns] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [envios, setEnvios] = useState<Envio[]>([]);

  async function cargarEnvios() {
    try {
      const res = await apiFetch<{ ok: boolean; data: Envio[] }>('/mensajes-reloj/envios');
      setEnvios(res.data || []);
    } catch {
      setEnvios([]);
    }
  }
  useEffect(() => { cargarEnvios(); }, []);

  async function buscarPorDni(valor = dni) {
    const limpio = valor.replace(/\D/g, '');
    if (!limpio) return;
    setBuscando(true);
    try {
      const res = await apiFetch<any>(`/personal/${limpio}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado', `No hay agente con DNI ${limpio}`); setResultados([]); return; }
      const d = res.data;
      setResultados([{ dni: Number(d.dni || limpio), apellido: d.apellido, nombre: d.nombre, estado_empleo: d.estado_empleo ?? d.estado_laboral, servicio_nombre: d.servicios?.[0]?.servicio_nombre ?? null }]);
    } catch (e: any) {
      toast.error('No se pudo buscar', e?.message);
    } finally {
      setBuscando(false);
    }
  }

  async function buscarPorNombre() {
    const q = nombre.trim();
    if (!q) return;
    setBuscando(true);
    try {
      const res = await apiFetch<any>(`/personal/search?q=${encodeURIComponent(q)}&limit=50&page=1`);
      const lista: Agente[] = res?.data || [];
      setResultados(lista);
      if (!lista.length) toast.error('Sin resultados', `No hay agentes que coincidan con "${q}"`);
    } catch (e: any) {
      toast.error('No se pudo buscar', e?.message);
    } finally {
      setBuscando(false);
    }
  }

  function agregar(lista: Agente[]) {
    setElegidos(prev => {
      const ya = new Set(prev.map(a => a.dni));
      const nuevos = lista.filter(a => !ya.has(Number(a.dni))).map(a => ({ ...a, dni: Number(a.dni) }));
      const total = [...prev, ...nuevos];
      if (total.length > MAX_AGENTES) {
        toast.error('Demasiados agentes', `Máximo ${MAX_AGENTES} por envío`);
        return total.slice(0, MAX_AGENTES);
      }
      return total;
    });
  }

  async function agregarPegados() {
    const dnis = [...new Set(pegados.split(/[^\d]+/).filter(Boolean))];
    if (!dnis.length) return;
    setBuscando(true);
    const encontrados: Agente[] = [];
    const faltan: string[] = [];
    for (const d of dnis) {
      try {
        const res = await apiFetch<any>(`/personal/${d}`);
        if (res?.ok && res?.data) {
          const x = res.data;
          encontrados.push({ dni: Number(x.dni || d), apellido: x.apellido, nombre: x.nombre, estado_empleo: x.estado_empleo ?? x.estado_laboral, servicio_nombre: x.servicios?.[0]?.servicio_nombre ?? null });
        } else faltan.push(d);
      } catch {
        faltan.push(d);
      }
    }
    setBuscando(false);
    agregar(encontrados);
    setPegados('');
    if (faltan.length) toast.error('No encontrados', faltan.join(', '));
    else toast.ok(`${encontrados.length} agente(s) agregados`);
  }

  async function enviar() {
    if (!elegidos.length) { toast.error('Mensaje', 'Elegí al menos un agente'); return; }
    if (!texto.trim()) { toast.error('Mensaje', 'Escribí el mensaje'); return; }
    if (!sns.length) { toast.error('Mensaje', 'Elegí al menos un reloj'); return; }
    if (!window.confirm(`¿Enviar "${limpiar(texto).trim()}" a ${elegidos.length} agente(s) en ${sns.length} reloj(es)?`)) return;
    setEnviando(true);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string; estado: string; agentes: number; relojes: any[]; aviso?: string }>(
        '/mensajes-reloj/masivo',
        { method: 'POST', body: JSON.stringify({ dnis: elegidos.map(a => a.dni), mensaje: texto, vigencia_min: vigencia, sns }) },
      );
      if (!res.ok) throw new Error(res.error || 'No se pudo encolar');
      if (res.estado === 'simulado') toast.ok('Mensaje guardado (prueba)', res.aviso || '');
      else toast.ok('Mensaje en cola', `${res.agentes} agente(s) en ${res.relojes.length} reloj(es). Puede tardar hasta 5 minutos.`);
      setTexto('');
      setElegidos([]);
      await cargarEnvios();
    } catch (e: any) {
      toast.error('No se pudo mandar', e?.message);
    } finally {
      setEnviando(false);
    }
  }

  const largo = texto.length;
  const tieneAcentos = texto !== limpiar(texto);
  const elegidosSet = new Set(elegidos.map(a => a.dni));

  return (
    <Layout title="Mensajes al reloj">
      <div className="muted" style={{ marginBottom: 12 }}>
        Elegí agentes y mandales un mensaje que aparece en el reloj cuando fichan. Elegí en qué relojes (de entrada van todos) y tené en cuenta que puede tardar hasta 5 minutos en llegar.
      </div>

      <div style={S.grid}>
        {/* Buscador */}
        <div className="card gp-card-14">
          <h3 className="gp-h3-top0">🔎 Buscar agentes</h3>
          <label className="label">DNI</label>
          <input className="input" value={dni} onChange={e => setDni(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorDni()} placeholder="Enter para buscar" disabled={buscando}
            style={{ width: '100%', boxSizing: 'border-box' }} />
          <label className="label" style={{ marginTop: 8, display: 'block' }}>Apellido y Nombre</label>
          <input className="input" value={nombre} onChange={e => setNombre(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorNombre()} placeholder="Apellido Nombre (Enter)" disabled={buscando}
            style={{ width: '100%', boxSizing: 'border-box' }} />

          {buscando && <div className="muted" style={{ marginTop: 8 }}>🔄 Buscando…</div>}
          {!!resultados.length && (
            <>
              <div className="row gp-row-between-center" style={{ marginTop: 10 }}>
                <b>{resultados.length} resultado(s)</b>
                <button className="btn" type="button" onClick={() => agregar(resultados)}>+ Agregar todos</button>
              </div>
              <div style={S.lista}>
                {resultados.map(a => (
                  <div key={a.dni} style={S.item}>
                    <div style={{ flex: 1 }}>
                      <div><b>{a.apellido}, {a.nombre}</b> {a.estado_empleo === 'BAJA' && <span style={S.baja}>BAJA</span>}</div>
                      <div className="muted">DNI {a.dni}{a.servicio_nombre ? ` · ${a.servicio_nombre}` : ''}</div>
                    </div>
                    <button className="btn" type="button" disabled={elegidosSet.has(Number(a.dni))} onClick={() => agregar([a])}>
                      {elegidosSet.has(Number(a.dni)) ? '✓' : '+'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="sep" />
          <label className="label">Pegar DNIs (uno por línea, o separados por coma)</label>
          <textarea className="input" rows={3} value={pegados} onChange={e => setPegados(e.target.value)}
            placeholder={'30111222\n28333444'} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          <button className="btn" type="button" style={{ marginTop: 6 }} disabled={buscando || !pegados.trim()} onClick={agregarPegados}>
            + Agregar DNIs
          </button>
        </div>

        {/* Elegidos + mensaje */}
        <div className="card gp-card-14">
          <div className="row gp-row-between-center">
            <h3 className="gp-h3-top0" style={{ margin: 0 }}>👥 Elegidos ({elegidos.length})</h3>
            {!!elegidos.length && <button className="btn" type="button" onClick={() => setElegidos([])}>Quitar todos</button>}
          </div>
          {!elegidos.length && <div className="muted" style={{ marginTop: 8 }}>Todavía no elegiste a nadie.</div>}
          <div style={S.lista}>
            {elegidos.map(a => (
              <div key={a.dni} style={S.item}>
                <div style={{ flex: 1 }}>
                  <b>{a.apellido}, {a.nombre}</b> {a.estado_empleo === 'BAJA' && <span style={S.baja}>BAJA</span>}
                  <span className="muted"> · DNI {a.dni}</span>
                </div>
                <button className="btn" type="button" onClick={() => setElegidos(prev => prev.filter(x => x.dni !== a.dni))}>✕</button>
              </div>
            ))}
          </div>

          <div className="sep" />
          <label className="label">Mensaje (aparece en el reloj cuando fichan)</label>
          <textarea className="input" rows={3} value={texto} maxLength={MAX}
            onChange={e => setTexto(e.target.value.slice(0, MAX))} placeholder="Ej: Reunión de personal el viernes 10 hs"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
          <div className="row gp-row-between-wrap" style={{ fontSize: '0.78rem', marginTop: 4 }}>
            <span className="muted">{tieneAcentos ? 'Los acentos y la ñ se van a quitar al mandarlo.' : 'Sin acentos ni ñ.'}</span>
            <span style={{ fontWeight: 700, color: largo >= MAX ? '#f87171' : largo >= MAX - 10 ? '#fbbf24' : '#94a3b8' }}>
              {largo} / {MAX}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <RelojesSelector value={sns} onChange={setSns} />
          </div>
          <div className="row gp-row-between-wrap" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <label>
              <div className="muted">Se muestra durante</div>
              <select className="input" value={vigencia} onChange={e => setVigencia(Number(e.target.value))}>
                {VIGENCIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button className="btn primary" type="button" disabled={enviando || !elegidos.length || !texto.trim() || !sns.length} onClick={enviar}>
              {enviando ? 'Enviando…' : `💬 Enviar a ${elegidos.length} agente(s) · ${sns.length} reloj(es)`}
            </button>
          </div>
        </div>
      </div>

      {/* Envíos recientes */}
      <div className="card gp-card-14" style={{ marginTop: 14 }}>
        <div className="row gp-row-between-center">
          <h3 className="gp-h3-top0" style={{ margin: 0 }}>📨 Envíos recientes</h3>
          <button className="btn" type="button" onClick={cargarEnvios}>↻ Actualizar</button>
        </div>
        {!envios.length && <div className="muted" style={{ marginTop: 8 }}>Todavía no hay envíos.</div>}
        <div style={{ overflow: 'auto', marginTop: 8 }}>
          <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
            {!!envios.length && (
              <thead>
                <tr><th>Fecha</th><th>Mensaje</th><th>Agentes</th><th>Estado en relojes</th><th>Por</th></tr>
              </thead>
            )}
            <tbody>
              {envios.map(e => (
                <tr key={`${e.sms_uid}-${e.creado}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{e.creado}</td>
                  <td><b>{e.mensaje}</b><div className="muted">vigencia {Math.round(e.vigencia_min / 60)} h</div></td>
                  <td title={e.destinatarios}>
                    {e.agentes}
                    <div className="muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.destinatarios}</div>
                  </td>
                  <td>
                    {e.estado === 'simulado' ? <span className="muted">prueba (no se mandó)</span>
                      : e.estado === 'error' ? <span style={{ color: '#fca5a5' }}>error</span>
                        : (
                          <span>
                            <span style={{ color: '#86efac' }}>{e.aceptadas} aceptadas</span>
                            {!!e.en_cola && <span style={{ color: '#fcd34d' }}> · {e.en_cola} en cola</span>}
                            {!!e.con_error && <span style={{ color: '#fca5a5' }}> · {e.con_error} con error</span>}
                            <span className="muted"> / {e.asignaciones}</span>
                          </span>
                        )}
                  </td>
                  <td>{e.creado_por || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
