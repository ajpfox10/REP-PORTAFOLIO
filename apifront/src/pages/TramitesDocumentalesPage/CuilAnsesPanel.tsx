import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { aExtension } from '../LicenciasMedicasControlPage/WhatsappTab';
import { ExtensionDescarga, NAV, cmpVersion, hayVersionNueva, useVersionPublicada } from '../LicenciasMedicasControlPage/ExtensionDescarga';

// ─────────────────────────────────────────────────────────────────────────────
// Baja la constancia de CUIL de ANSES para los agentes de una tanda y la guarda en DOCU\<dni>\CUIL.
// La consulta la hace la extensión de Chrome de la app (v1.5.0+) en el navegador de quien la usa:
// ANSES bloquea las consultas automáticas desde el servidor. La app hace el bucle con una pausa
// entre agentes; si ANSES responde con su protección anti-robots se frena todo (no se reintenta).
// ─────────────────────────────────────────────────────────────────────────────

type Pendiente = {
  dni: number;
  apellido: string;
  nombre: string;
  cuil: string | null;
  fechaNacimiento: string | null;
  sexo: 'M' | 'F' | null;
  tieneCuil: boolean;
  archivos: string[];
  faltanDatos: string[];
};

type Resultado = { estado: 'OK' | 'NO_ENCONTRADO' | 'BLOQUEADO' | 'ERROR' | 'SIN_DATOS'; detalle?: string | null; cuilAnses?: string };

const VERSION_MINIMA = '1.5.0';
const PAUSA_MS = 5000;
const ARCHIVO = 'Constancia CUIL ANSES.pdf';
const COLOR: Record<string, string> = {
  OK: '#22c55e', NO_ENCONTRADO: '#f59e0b', BLOQUEADO: '#ef4444', ERROR: '#ef4444', SIN_DATOS: '#94a3b8',
};
const TXT: Record<string, string> = {
  OK: 'Bajada', NO_ENCONTRADO: 'ANSES no lo encontró', BLOQUEADO: 'ANSES bloqueó', ERROR: 'Error', SIN_DATOS: 'Faltan datos',
};
const BORDER = '1px solid rgba(255,255,255,0.1)';

function pdfBlob(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

export function CuilAnsesPanel({ tanda, onCerrar, onGuardado }: {
  tanda: string;
  onCerrar: () => void;
  onGuardado?: (dni: number) => void;
}) {
  const toast = useToast();
  const [ext, setExt] = useState<string | null | undefined>(undefined); // undefined = verificando
  const publicada = useVersionPublicada();
  const [verDescarga, setVerDescarga] = useState(false);
  const [rows, setRows] = useState<Pendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [rebajar, setRebajar] = useState(false);
  const [corriendo, setCorriendo] = useState(false);
  const [actual, setActual] = useState<number | null>(null);
  const [res, setRes] = useState<Map<number, Resultado>>(new Map());
  const detenerRef = useRef(false);

  const detectar = useCallback(async () => {
    const r = await aExtension('PING', undefined, 1500);
    setExt(r.ok ? (r.version || '?') : null);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: { rows: Pendiente[] } }>(
        `/tramites-documentales/tandas/cuil-pendientes?tanda=${encodeURIComponent(tanda)}`
      );
      setRows(r.data.rows || []);
    } catch (e: any) {
      toast.error('No se pudo leer la tanda', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanda]);

  useEffect(() => { void detectar(); void cargar(); }, [detectar, cargar]);
  useEffect(() => () => { detenerRef.current = true; }, []);

  const extOk = !!ext && ext !== '?' && cmpVersion(ext, VERSION_MINIMA) >= 0;
  const aBajar = rows.filter((r) => rebajar || !r.tieneCuil);
  const conCuil = rows.filter((r) => r.tieneCuil).length;

  function marcar(dni: number, r: Resultado) {
    setRes((prev) => new Map(prev).set(dni, r));
  }

  async function guardar(p: Pendiente, b64: string) {
    const fd = new FormData();
    fd.append('dni', String(p.dni));
    fd.append('path', 'CUIL');
    fd.append('files', new File([pdfBlob(b64)], ARCHIVO, { type: 'application/pdf' }));
    await apiFetch('/tramites-documentales/docu-upload', { method: 'POST', body: fd });
  }

  async function empezar() {
    if (!extOk) { setVerDescarga(true); return; }
    detenerRef.current = false;
    setCorriendo(true);
    setRes(new Map());
    const lista = [...aBajar];
    let ok = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        if (detenerRef.current) break;
        const p = lista[i];
        setActual(p.dni);
        if (p.faltanDatos.length || !p.sexo) {
          marcar(p.dni, { estado: 'SIN_DATOS', detalle: `Falta en la base: ${p.faltanDatos.join(', ') || 'sexo'}` });
          continue;
        }
        const r: any = await aExtension('CUIL_ANSES', {
          dni: p.dni, nombre: p.nombre, apellido: p.apellido, sexo: p.sexo, fechaNacimiento: p.fechaNacimiento,
        }, 90000);
        if (r.ok && r.pdf) {
          try {
            await guardar(p, r.pdf);
            const distinto = p.cuil && r.cuil && p.cuil !== r.cuil;
            marcar(p.dni, {
              estado: 'OK', cuilAnses: r.cuil,
              detalle: distinto ? `⚠️ CUIL distinto: ANSES ${r.cuil} · base ${p.cuil}` : null,
            });
            ok++;
            onGuardado?.(p.dni);
          } catch (e: any) {
            marcar(p.dni, { estado: 'ERROR', detalle: `Se bajó pero no se pudo guardar: ${e?.message || 'Error'}` });
          }
        } else {
          marcar(p.dni, { estado: (r.estado as Resultado['estado']) || 'ERROR', detalle: r.detalle });
          if (r.estado === 'BLOQUEADO') {
            toast.error('ANSES frenó las consultas', 'Se detuvo la tanda. Probá de nuevo más tarde.');
            break;
          }
          if (/no respondió|Recargá la página/i.test(r.detalle || '')) {
            toast.error('Se perdió la extensión', r.detalle || '');
            break;
          }
        }
        if (i < lista.length - 1 && !detenerRef.current) await new Promise((rs) => setTimeout(rs, PAUSA_MS));
      }
    } finally {
      setCorriendo(false);
      setActual(null);
      toast.ok('CUIL ANSES', `${ok} constancia(s) guardada(s)`);
      void cargar();
    }
  }

  const hechos = Array.from(res.values());
  const cuenta = (e: string) => hechos.filter((h) => h.estado === e).length;

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(14,116,144,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>🪪 Constancia de CUIL (ANSES) — "{tanda}"</b>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCerrar} disabled={corriendo} style={btn(corriendo)}>Cerrar</button>
      </div>

      {/* Estado de la extensión */}
      <div style={{ fontSize: '0.8rem', color: extOk ? '#86efac' : '#fde68a' }}>
        {ext === undefined ? 'Verificando la extensión…'
          : extOk ? <>✅ Extensión instalada (v{ext}).{hayVersionNueva(ext, publicada) ? <> Hay versión nueva v{publicada}: se actualiza sola.</> : null}</>
          : ext ? <>⚠️ La extensión de este {NAV.nombre} es la v{ext}: para bajar el CUIL hace falta la v{VERSION_MINIMA} o más nueva.{' '}
              <button type="button" onClick={() => setVerDescarga(true)} style={btn(false)}>🔄 Cómo actualizarla</button>{' '}
              <button type="button" onClick={detectar} style={btn(false)}>Volver a verificar</button></>
          : <>⚠️ Falta la extensión de la app en este {NAV.nombre}.{' '}
              <button type="button" onClick={() => setVerDescarga(true)} style={{ ...btn(false), fontWeight: 700 }}>🧩 Descargar e instalar</button>{' '}
              <button type="button" onClick={detectar} style={btn(false)}>Volver a verificar</button></>}
      </div>
      {verDescarga && <ExtensionDescarga instalada={ext} publicada={publicada} onCerrar={() => setVerDescarga(false)} />}

      {cargando ? <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Leyendo la tanda…</div> : (
        <>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            {rows.length} agente(s) · <b>{conCuil}</b> ya tienen algo en la carpeta CUIL · <b>{aBajar.length}</b> a bajar
            <label style={{ marginLeft: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={rebajar} disabled={corriendo} onChange={(e) => setRebajar(e.target.checked)} /> volver a bajar también los que ya tienen
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!corriendo ? (
              <button type="button" onClick={() => void empezar()} disabled={!aBajar.length || ext === undefined}
                style={{ ...btn(!aBajar.length), background: '#0e7490', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                ▶ Bajar {aBajar.length} constancia(s)
              </button>
            ) : (
              <button type="button" onClick={() => { detenerRef.current = true; }}
                style={{ ...btn(false), background: '#b91c1c', color: '#fff', fontWeight: 700, padding: '7px 14px' }}>
                ⏹ Detener
              </button>
            )}
            {hechos.length ? (
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                {hechos.length}/{aBajar.length} · ✅ {cuenta('OK')} · ⚠️ {cuenta('NO_ENCONTRADO') + cuenta('SIN_DATOS')} · ❌ {cuenta('ERROR') + cuenta('BLOQUEADO')}
              </span>
            ) : null}
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              Deja {PAUSA_MS / 1000} s entre consultas. Dejá abierta la pestaña de ANSES que se abre en segundo plano.
            </span>
          </div>

          <div style={{ maxHeight: 260, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {aBajar.map((p) => {
              const r = res.get(p.dni);
              return (
                <div key={p.dni} style={{
                  display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', borderBottom: BORDER, fontSize: '0.78rem',
                  background: actual === p.dni ? 'rgba(14,116,144,0.25)' : 'transparent',
                }}>
                  <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.apellido}, {p.nombre} <span style={{ color: '#64748b' }}>· DNI {p.dni}</span>
                  </span>
                  {actual === p.dni ? <span style={{ color: '#67e8f9' }}>consultando…</span>
                    : r ? (
                      <span title={r.detalle || ''} style={{ color: COLOR[r.estado], maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {TXT[r.estado]}{r.detalle ? ` — ${r.detalle}` : ''}
                      </span>
                    ) : p.tieneCuil ? <span style={{ color: '#64748b' }}>ya tiene ({p.archivos.length})</span> : null}
                </div>
              );
            })}
            {!aBajar.length ? <div style={{ color: '#64748b', fontSize: '0.8rem', padding: 10 }}>Todos los agentes ya tienen algo en la carpeta CUIL.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '5px 10px',
    color: disabled ? '#475569' : '#e2e8f0', fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
  };
}
