import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { aExtension } from '../LicenciasMedicasControlPage/WhatsappTab';
import { ExtensionDescarga, NAV, cmpVersion, hayVersionNueva, useVersionPublicada } from '../LicenciasMedicasControlPage/ExtensionDescarga';

// ─────────────────────────────────────────────────────────────────────────────
// Baja el certificado del RDAM (Registro de Deudores Alimentarios Morosos) para los agentes de una
// tanda y lo guarda en DOCU\<dni>\RDAM. Lo hace la extensión de Chrome de la app (v1.6.0+) con el
// trámite público /solicitudCertificado (sin login ni captcha). Con sesión iniciada en el RDAM, si ese
// DNI ya tiene un certificado de hoy se reusa (no se pide otro).
// Robot equivalente sin extensión: apipersonal/scripts/descargar_rdam.py.
// ─────────────────────────────────────────────────────────────────────────────

type Pendiente = {
  dni: number;
  apellido: string;
  nombre: string;
  sexo: 'M' | 'F' | null;
  tieneCuil: boolean; // = ya tiene un RDAM vigente (< 60 días) en Libre de deuda (RDAM)
  archivos: string[];
};

type Resultado = { estado: 'OK' | 'SIN_SESION' | 'NO_GENERADO' | 'ERROR' | 'SIN_DATOS'; detalle?: string | null; reusado?: boolean };

const VERSION_MINIMA = '1.6.0';
const PAUSA_MS = 3000;
const COLOR: Record<string, string> = {
  OK: '#22c55e', NO_GENERADO: '#f59e0b', SIN_SESION: '#ef4444', ERROR: '#ef4444', SIN_DATOS: '#94a3b8',
};
const TXT: Record<string, string> = {
  OK: 'Bajado', NO_GENERADO: 'El RDAM no lo generó', SIN_SESION: 'Sin sesión', ERROR: 'Error', SIN_DATOS: 'Faltan datos',
};
const BORDER = '1px solid rgba(255,255,255,0.1)';

function pdfBlob(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Encontrado = { dni: number; apellidoNombre: string; estadoEmpleo: string | null };

/** tanda = null → agentes sueltos: se pegan DNIs o se buscan en la base. */
export function RdamPanel({ tanda, onCerrar, onGuardado }: {
  tanda: string | null;
  onCerrar: () => void;
  onGuardado?: (dni: number) => void;
}) {
  const toast = useToast();
  const [ext, setExt] = useState<string | null | undefined>(undefined); // undefined = verificando
  const publicada = useVersionPublicada();
  const [verDescarga, setVerDescarga] = useState(false);
  const [rows, setRows] = useState<Pendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [rebajar, setRebajar] = useState(!tanda);
  const [sueltos, setSueltos] = useState<number[]>([]);
  const [pegar, setPegar] = useState('');
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState<Encontrado[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const [actual, setActual] = useState<number | null>(null);
  const [res, setRes] = useState<Map<number, Resultado>>(new Map());
  const detenerRef = useRef(false);
  const [falloExt, setFalloExt] = useState(false);

  // PING escuchando TODAS las respuestas: si hay dos copias de la extensión cargadas contestan las dos.
  const [versiones, setVersiones] = useState<string[]>([]);
  const detectar = useCallback(async () => {
    const id = `ping-${Date.now()}`;
    const vistas: string[] = [];
    const oir = (ev: MessageEvent) => {
      if (ev.source === window && ev.data?.hpw === 'ext' && ev.data.id === id && ev.data.ok) vistas.push(String(ev.data.version || '?'));
    };
    window.addEventListener('message', oir);
    window.postMessage({ hpw: 'app', id, type: 'PING' }, window.location.origin);
    await new Promise((r) => setTimeout(r, 1200));
    window.removeEventListener('message', oir);
    const orden = [...vistas].sort((a, b) => (a === '?' || b === '?' ? 0 : cmpVersion(b, a)));
    setVersiones(orden);
    setExt(orden[0] || null);
  }, []);

  const cargar = useCallback(async () => {
    if (!tanda && !sueltos.length) { setRows([]); setCargando(false); return; }
    setCargando(true);
    try {
      const filtro = tanda ? `tanda=${encodeURIComponent(tanda)}` : `dnis=${sueltos.join(',')}`;
      const r = await apiFetch<{ ok: boolean; data: { rows: Pendiente[] } }>(
        `/tramites-documentales/tandas/cuil-pendientes?${filtro}&carpeta=RDAM`
      );
      setRows(r.data.rows || []);
    } catch (e: any) {
      toast.error('No se pudo leer la tanda', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanda, sueltos]);

  // Buscador de agentes en la base (por apellido/nombre o DNI), con una pausa al tipear.
  useEffect(() => {
    if (tanda || busca.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ ok: boolean; data: { rows: Encontrado[] } }>(
          `/tramites-documentales/buscar-agente?q=${encodeURIComponent(busca.trim())}`
        );
        setEncontrados(r.data.rows || []);
      } catch { setEncontrados([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [busca, tanda]);

  function agregar(dnis: number[]) {
    setSueltos((prev) => Array.from(new Set([...prev, ...dnis.filter((d) => d > 0)])));
  }
  function agregarPegados() {
    const dnis = (pegar.match(/\d{6,9}/g) || []).map(Number);
    if (!dnis.length) { toast.warning('Sin DNI', 'Pegá uno o varios DNI (separados por coma, espacio o renglón).'); return; }
    agregar(dnis);
    setPegar('');
  }
  const noEnBase = !tanda ? sueltos.filter((d) => !cargando && !rows.some((r) => r.dni === d)) : [];

  useEffect(() => { void detectar(); void cargar(); }, [detectar, cargar]);
  useEffect(() => () => { detenerRef.current = true; }, []);

  const extOk = !!ext && ext !== '?' && cmpVersion(ext, VERSION_MINIMA) >= 0;
  const aBajar = rows.filter((r) => rebajar || !r.tieneCuil);
  const conRdam = rows.filter((r) => r.tieneCuil).length;

  function marcar(dni: number, r: Resultado) {
    setRes((prev) => new Map(prev).set(dni, r));
  }

  async function guardar(p: Pendiente, b64: string) {
    const fd = new FormData();
    fd.append('dni', String(p.dni));
    fd.append('path', 'Libre de deuda (RDAM)');
    fd.append('robot', 'extension_rdam');
    const apNom = `${p.apellido} ${p.nombre}`.toUpperCase().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || String(p.dni);
    fd.append('files', new File([pdfBlob(b64)], `${apNom} RDAM ${hoy()}.pdf`, { type: 'application/pdf' }));
    const r = await apiFetch<{ ok: boolean; data: { saved: string[] } }>('/tramites-documentales/docu-upload', { method: 'POST', body: fd });
    // Recién con el nuevo guardado, lo viejo de la carpeta pasa a Trasladados (no se borra).
    const conservar = r.data?.saved?.[0];
    if (!conservar) return 0;
    const l = await apiFetch<{ ok: boolean; data: { borrados: string[] } }>('/tramites-documentales/docu-rdam-limpiar', {
      method: 'POST',
      body: JSON.stringify({ dni: p.dni, conservar }),
    });
    return l.data?.borrados?.length || 0;
  }

  async function empezar() {
    if (!extOk) { setVerDescarga(true); return; }
    if (versiones.length > 1) { toast.warning('Dos extensiones', 'Quitá la extensión vieja antes de bajar los RDAM.'); return; }
    detenerRef.current = false;
    setCorriendo(true);
    setRes(new Map());
    setFalloExt(false);
    const lista = [...aBajar];
    let ok = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        if (detenerRef.current) break;
        const p = lista[i];
        setActual(p.dni);
        const faltan = [!p.apellido && 'apellido', !p.nombre && 'nombre', !p.sexo && 'sexo'].filter(Boolean);
        if (faltan.length) {
          marcar(p.dni, { estado: 'SIN_DATOS', detalle: `Falta en la base: ${faltan.join(', ')}` });
          continue;
        }
        const r: any = await aExtension('RDAM', {
          dni: p.dni, sexo: p.sexo === 'F' ? '2' : '1', apellido: p.apellido.toUpperCase(), nombre: p.nombre.toUpperCase(), forzar: false,
        }, 330000); // el RDAM puede pedir verificación de Cloudflare a mano (la extensión espera hasta 4 min)
        if (r.ok && r.pdf) {
          try {
            const borrados = await guardar(p, r.pdf);
            const detalle = [r.reusado && 'ya estaba pedido hoy en el RDAM', borrados && `reemplazó ${borrados} viejo(s)`].filter(Boolean).join(' · ');
            marcar(p.dni, { estado: 'OK', reusado: r.reusado, detalle: detalle || null });
            ok++;
            onGuardado?.(p.dni);
          } catch (e: any) {
            marcar(p.dni, { estado: 'ERROR', detalle: `Se bajó pero no se pudo guardar: ${e?.message || 'Error'}` });
          }
        } else {
          marcar(p.dni, { estado: (r.estado as Resultado['estado']) || 'ERROR', detalle: r.detalle });
          if (r.estado === 'SIN_SESION') {
            toast.error('No hay sesión en el RDAM', 'Entrá con tu usuario en la pestaña del RDAM y volvé a tocar Bajar.');
            break;
          }
          if (/no respondió|Recargá la página/i.test(r.detalle || '')) {
            toast.error('Se perdió la extensión', r.detalle || '');
            break;
          }
          if (/Acción desconocida/i.test(r.detalle || '')) {
            setFalloExt(true);
            break;
          }
        }
        if (i < lista.length - 1 && !detenerRef.current) await new Promise((rs) => setTimeout(rs, PAUSA_MS));
      }
    } finally {
      setCorriendo(false);
      setActual(null);
      toast.ok('RDAM', `${ok} certificado(s) guardado(s)`);
      void cargar();
    }
  }

  const hechos = Array.from(res.values());
  const cuenta = (e: string) => hechos.filter((h) => h.estado === e).length;

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(124,58,237,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>⚖️ Certificado RDAM — {tanda ? `"${tanda}"` : 'agentes sueltos'}</b>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCerrar} disabled={corriendo} style={btn(corriendo)}>Cerrar</button>
      </div>

      {/* Estado de la extensión */}
      <div style={{ fontSize: '0.8rem', color: extOk ? '#86efac' : '#fde68a' }}>
        {ext === undefined ? 'Verificando la extensión…'
          : extOk ? <>✅ Extensión instalada (v{ext}).{hayVersionNueva(ext, publicada) ? <> Hay versión nueva v{publicada}: se actualiza sola.</> : null}</>
          : ext ? <>⚠️ La extensión de este {NAV.nombre} es la v{ext}: para bajar el RDAM hace falta la v{VERSION_MINIMA} o más nueva.{' '}
              <button type="button" onClick={() => setVerDescarga(true)} style={btn(false)}>🔄 Cómo actualizarla</button>{' '}
              <button type="button" onClick={detectar} style={btn(false)}>Volver a verificar</button></>
          : <>⚠️ Falta la extensión de la app en este {NAV.nombre}.{' '}
              <button type="button" onClick={() => setVerDescarga(true)} style={{ ...btn(false), fontWeight: 700 }}>🧩 Descargar e instalar</button>{' '}
              <button type="button" onClick={detectar} style={btn(false)}>Volver a verificar</button></>}
      </div>
      {versiones.length > 1 ? (
        <div style={{ fontSize: '0.82rem', color: '#fecaca', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 10px' }}>
          ❌ Hay <b>{versiones.length} copias</b> de la extensión cargadas en este {NAV.nombre} (v{versiones.join(', v')}).
          Abrí <code>{NAV.url}</code>, tocá <b>Quitar</b> en la vieja y dejá una sola. Después apretá <b>F5</b> acá.
        </div>
      ) : null}
      {falloExt ? (
        <div style={{ fontSize: '0.82rem', color: '#fecaca', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 10px' }}>
          ❌ {NAV.nombre} está usando una versión vieja de la extensión aunque diga v{ext}. Abrí <code>{NAV.url}</code>,
          en “Personal - Asistente (WhatsApp y CUIL ANSES)” {NAV.recargar} y después apretá <b>F5</b> acá.
        </div>
      ) : null}
      {verDescarga && <ExtensionDescarga instalada={ext} publicada={publicada} onCerrar={() => setVerDescarga(false)} />}

      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
        Usa el trámite público del RDAM: no hace falta iniciar sesión. Si estás logueado en el RDAM, además reusa el
        certificado que ya se haya pedido hoy para ese DNI.
      </div>

      {!tanda ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Pegá los DNI (coma, espacio o uno por renglón)</span>
            <textarea value={pegar} onChange={(e) => setPegar(e.target.value)} rows={3} disabled={corriendo}
              placeholder="xxxxxxx, 30111222…" style={inp} />
            <button type="button" onClick={agregarPegados} disabled={corriendo || !pegar.trim()} style={btn(corriendo || !pegar.trim())}>➕ Agregar DNI</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 280px' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>…o buscalos en la base (apellido, nombre o DNI)</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} disabled={corriendo} placeholder="Buscar agente…" style={inp} />
            {encontrados.length ? (
              <div style={{ maxHeight: 150, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
                {encontrados.map((e) => {
                  const ya = sueltos.includes(Number(e.dni));
                  return (
                    <div key={e.dni} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', borderBottom: BORDER, fontSize: '0.78rem' }}>
                      <span style={{ flex: 1, color: '#e2e8f0' }}>{e.apellidoNombre} <span style={{ color: '#64748b' }}>· {e.dni}{e.estadoEmpleo ? ` · ${e.estadoEmpleo}` : ''}</span></span>
                      <button type="button" disabled={ya || corriendo} onClick={() => agregar([Number(e.dni)])} style={btn(ya || corriendo)}>{ya ? 'agregado' : '➕'}</button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {noEnBase.length ? (
        <div style={{ fontSize: '0.78rem', color: '#fde68a' }}>
          ⚠️ No están en la base (no se pueden pedir): {noEnBase.join(', ')}{' '}
          <button type="button" onClick={() => setSueltos((prev) => prev.filter((d) => !noEnBase.includes(d)))} style={btn(false)}>Quitar</button>
        </div>
      ) : null}

      {!tanda && !sueltos.length ? null : cargando ? <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Leyendo los agentes…</div> : (
        <>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            {rows.length} agente(s) · <b>{conRdam}</b> ya tienen un RDAM vigente · <b>{aBajar.length}</b> a bajar
            <label style={{ marginLeft: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={rebajar} disabled={corriendo} onChange={(e) => setRebajar(e.target.checked)} /> volver a bajar también los que ya tienen
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!corriendo ? (
              <button type="button" onClick={() => void empezar()} disabled={!aBajar.length || ext === undefined}
                style={{ ...btn(!aBajar.length), background: '#6d28d9', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                ▶ Bajar {aBajar.length} certificado(s)
              </button>
            ) : (
              <button type="button" onClick={() => { detenerRef.current = true; }}
                style={{ ...btn(false), background: '#b91c1c', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                ⏹ Detener
              </button>
            )}
            {hechos.length ? (
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                {hechos.length}/{aBajar.length} · ✅ {cuenta('OK')} · ⚠️ {cuenta('NO_GENERADO') + cuenta('SIN_DATOS')} · ❌ {cuenta('ERROR') + cuenta('SIN_SESION')}
              </span>
            ) : null}
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              Deja {PAUSA_MS / 1000} s entre agentes. No cierres la pestaña del RDAM que se abre en segundo plano.
            </span>
          </div>

          <div style={{ maxHeight: 260, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {aBajar.map((p) => {
              const r = res.get(p.dni);
              return (
                <div key={p.dni} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', borderBottom: BORDER, fontSize: '0.78rem',
                  background: actual === p.dni ? 'rgba(124,58,237,0.25)' : 'transparent',
                }}>
                  <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.apellido}, {p.nombre} <span style={{ color: '#64748b' }}>· DNI {p.dni}</span>
                  </span>
                  {!tanda && !corriendo ? (
                    <button type="button" title="Quitar de la lista" onClick={() => setSueltos((prev) => prev.filter((d) => d !== p.dni))}
                      style={{ ...btn(false), padding: '1px 7px' }}>✕</button>
                  ) : null}
                  {actual === p.dni ? <span style={{ color: '#c4b5fd' }}>pidiendo…</span>
                    : r ? (
                      <span title={r.detalle || ''} style={{ color: COLOR[r.estado], maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {TXT[r.estado]}{r.detalle ? ` — ${r.detalle}` : ''}
                      </span>
                    ) : p.tieneCuil ? <span style={{ color: '#64748b' }}>ya tiene ({p.archivos.length})</span> : null}
                </div>
              );
            })}
            {!aBajar.length ? <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>{rows.length ? 'Todos los agentes ya tienen un RDAM vigente.' : 'Sin agentes.'}</div> : null}
          </div>
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '6px 9px',
  color: '#e2e8f0', fontSize: '0.8rem', fontFamily: 'inherit', resize: 'vertical',
};

function btn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '5px 10px',
    color: disabled ? '#475569' : '#e2e8f0', fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
  };
}
