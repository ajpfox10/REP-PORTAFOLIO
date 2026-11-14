import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Pase a planta: copia los documentos de DOCU\<dni> de los agentes de la tanda a la carpeta de
// Pase a planta (PASE_A_PLANTA_DIR\<HTAL|UPA 18|UPA 4>\<APELLIDO NOMBRE>), con el nombre que se usa
// a mano (NACIONAL, PROVINCIAL, PLANILLA DE COMPATIBILIDAD), SIEMPRE en JPG (los PDF se pasan hoja por
// hoja). Primero muestra la vista previa; copia recién al confirmar, solo lo que falta (nunca pisa).
// Control: muestra lo que hay en las carpetas y no es JPG. Lo hace scripts/pase_planta.py (el mismo
// que corre el robot del mail cada 2 min). Back: POST /tramites-documentales/tandas/pase-planta.
// ─────────────────────────────────────────────────────────────────────────────

type Doc = { doc: string; estado: 'copiar' | 'copiado' | 'reemplazar' | 'reemplazado' | 'ya_esta' | 'falta_en_docu' | 'error'; origen: string | null; destino: string | null; detalle: string | null };
type Row = { dni: number; apellidoNombre: string; dependencia: string | null; carpeta: string | null; carpetaNueva: boolean; docs: Doc[]; error: string | null };
type Totales = { agentes: number; copiar: number; copiados: number; reemplazar: number; reemplazados: number; ya_esta: number; falta_en_docu: number; errores: number; no_jpg: number };
type NoJpg = { dni: number; apellidoNombre: string; archivo: string };
type Convertido = { archivo: string; estado: 'convertir' | 'convertido' | 'error'; detalle: string | null };
type Datos = { tanda: string; base: string; ejecutado: boolean; totales: Totales; rows: Row[]; no_jpg: NoJpg[]; convertidos?: Convertido[] };
type Resp = { ok: boolean; data: Datos };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const COLOR: Record<Doc['estado'], string> = {
  copiar: '#60a5fa', copiado: '#22c55e', reemplazar: '#a78bfa', reemplazado: '#22c55e', ya_esta: '#64748b', falta_en_docu: '#f59e0b', error: '#ef4444',
};
const TXT: Record<Doc['estado'], string> = {
  copiar: 'se copia', copiado: 'copiado', reemplazar: 'se reemplaza (hay uno más nuevo)', reemplazado: 'reemplazado', ya_esta: 'ya está', falta_en_docu: 'falta en DOCU', error: 'error',
};

export function PasePlantaPanel({ tanda, onCerrar }: { tanda: string; onCerrar: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [copiando, setCopiando] = useState(false);
  const [soloPendientes, setSoloPendientes] = useState(true);

  const pedir = useCallback(async (ejecutar: boolean) => {
    const r = await apiFetch<Resp>('/tramites-documentales/tandas/pase-planta', {
      method: 'POST',
      body: JSON.stringify({ tanda, ejecutar }),
    });
    setData(r.data);
    return r.data;
  }, [tanda]);

  const revisar = useCallback(() => {
    setCargando(true);
    pedir(false)
      .catch((e: any) => toast.error('No se pudo armar la vista previa', e?.message || 'Error'))
      .finally(() => setCargando(false));
  }, [pedir]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { revisar(); }, [revisar]);

  const t = data?.totales;
  // Copias PDF que había dejado el robot: en la vista previa vienen "convertir".
  const conv = data && !data.ejecutado ? (data.convertidos || []).filter((c) => c.estado === 'convertir').length : 0;
  const pasadas = (data?.convertidos || []).filter((c) => c.estado === 'convertido').length;
  const delRobot = new Set((data?.convertidos || []).map((c) => c.archivo));
  const aMano = (data?.no_jpg || []).filter((x) => !delRobot.has(x.archivo));
  const hayQueHacer = !!t && (t.copiar > 0 || t.reemplazar > 0 || conv > 0);

  async function copiar() {
    if (!data || !hayQueHacer) return;
    const extra = [
      data.totales.reemplazar ? `Se reemplazan ${data.totales.reemplazar} documento(s) porque en DOCU hay uno más nuevo.` : '',
      conv ? `Se pasan a JPG ${conv} archivo(s) que no lo estaban.` : '',
    ].filter(Boolean).join('\n');
    if (!window.confirm(`Se van a copiar ${data.totales.copiar} documento(s) en JPG a\n${data.base}${extra ? `\n\n${extra}` : ''}\n\nNo se borra nada: lo que sale va a la subcarpeta "viejos" del agente. ¿Seguir?`)) return;
    setCopiando(true);
    try {
      const d = await pedir(true);
      const pas = (d.convertidos || []).filter((c) => c.estado === 'convertido').length;
      const txt = `${d.totales.copiados} copiado(s)${d.totales.reemplazados ? `, ${d.totales.reemplazados} reemplazado(s)` : ''}${pas ? `, ${pas} pasado(s) a JPG` : ''}`;
      if (d.totales.errores) toast.error('Pase a planta', `${txt}, ${d.totales.errores} con error`);
      else toast.ok('Pase a planta', txt);
    } catch (e: any) {
      toast.error('No se pudo copiar', e?.message || 'Error');
    } finally {
      setCopiando(false);
    }
  }

  const pendiente = (r: Row) => !!r.error || r.docs.some((d) => d.estado !== 'ya_esta');
  const filas = (data?.rows || []).filter((r) => !soloPendientes || pendiente(r));

  return (
    <div style={{ border: BORDER, borderRadius: 10, padding: 12, background: 'rgba(14,116,144,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0' }}>📦 Pase a planta — "{tanda}"</b>
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>todos los documentos del trámite, en JPG</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCerrar} disabled={copiando} style={btn(copiando)}>Cerrar</button>
      </div>

      <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
        Copia de <code>DOCU\&lt;dni&gt;</code> a{' '}
        <code>{data?.base || '…'}\&lt;dependencia&gt;\&lt;APELLIDO NOMBRE&gt;</code> todos los documentos del trámite (DNI, CUIL, TITULO, NACIONAL, PROVINCIAL, RDAM, DDJJ…),
        siempre en <b>JPG</b> (un PDF de varias hojas queda NOMBRE 1.jpg, NOMBRE 2.jpg…). Si en DOCU hay uno más nuevo,
        lo reemplaza y el anterior va a la subcarpeta <b>viejos</b>. El robot <i>pase_planta</i> hace lo mismo cada 2 minutos.
      </div>

      {cargando ? (
        <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Armando la vista previa…</div>
      ) : t ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: '0.8rem', color: '#cbd5e1' }}>
            <span>{t.agentes} agente(s)</span>
            {data?.ejecutado
              ? <span style={{ color: COLOR.copiado }}>✅ {t.copiados} copiado(s){t.reemplazados ? `, ${t.reemplazados} reemplazado(s)` : ''}{pasadas ? `, ${pasadas} pasado(s) a JPG` : ''}</span>
              : <span style={{ color: COLOR.copiar }}>📄 {t.copiar} para copiar{t.reemplazar ? ` · ${t.reemplazar} para reemplazar` : ''}</span>}
            <span style={{ color: COLOR.ya_esta }}>{t.ya_esta} ya estaban</span>
            <span style={{ color: COLOR.falta_en_docu }}>⚠️ {t.falta_en_docu} faltan en DOCU</span>
            {t.errores ? <span style={{ color: COLOR.error }}>❌ {t.errores} con error</span> : null}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              ocultar los que ya están completos
            </label>
            <span style={{ flex: 1 }} />
            {!data?.ejecutado ? (
              <button type="button" onClick={() => void copiar()} disabled={copiando || !hayQueHacer}
                style={{ ...btn(copiando || !hayQueHacer), background: copiando || !hayQueHacer ? 'rgba(255,255,255,0.06)' : '#0e7490', color: '#fff' }}>
                {copiando ? 'Copiando…' : `📦 Copiar ${t.copiar} documento(s)${t.reemplazar ? ` + reemplazar ${t.reemplazar}` : ''}${conv ? ` + pasar ${conv} a JPG` : ''}`}
              </button>
            ) : (
              <button type="button" onClick={revisar} style={btn(false)}>Volver a revisar</button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflow: 'auto', border: BORDER, borderRadius: 8 }}>
            {!filas.length ? (
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: 10 }}>No queda nada por copiar.</div>
            ) : filas.map((r) => (
              <div key={r.dni} style={{ padding: '6px 10px', borderBottom: BORDER, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.8rem', minWidth: 260 }}>
                  {r.apellidoNombre} <span style={{ color: '#64748b' }}>· DNI {r.dni} · {r.dependencia || '?'}</span>
                  {r.carpetaNueva ? <span style={{ color: '#60a5fa', fontSize: '0.7rem' }}> · carpeta nueva</span> : null}
                </span>
                {r.error ? (
                  <span style={{ color: COLOR.error, fontSize: '0.78rem' }}>❌ {r.error}</span>
                ) : r.docs.map((d) => (
                  <span key={d.doc} title={[d.origen && `De: ${d.origen}`, d.destino && `A: ${r.carpeta}\\${d.destino}`, d.detalle].filter(Boolean).join('\n')}
                    style={{ color: COLOR[d.estado], fontSize: '0.78rem' }}>
                    {d.doc.replace('Antecedentes ', '').replace('Planilla de compatibilidad', 'planilla')}: {TXT[d.estado]}
                    {d.estado === 'error' && d.detalle ? ` (${d.detalle})` : ''}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* Control: todo lo de las carpetas de Pase a planta tiene que ser JPG */}
          <div style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>
            <b>Control JPG:</b>{' '}
            {conv ? <span style={{ color: COLOR.copiar }}>{conv} archivo(s) se pasan a JPG (el original va a viejos). </span> : null}
            {pasadas ? <span style={{ color: COLOR.copiado }}>{pasadas} pasada(s) a JPG. </span> : null}
            {!aMano.length
              ? <span style={{ color: COLOR.copiado }}>{conv ? 'El resto está en JPG.' : '✅ Todo en JPG.'}</span>
              : <span style={{ color: COLOR.falta_en_docu }}>⚠️ {aMano.length} archivo(s) que no se pueden pasar a JPG (Word u otros):</span>}
            {aMano.length ? (
              <div style={{ marginTop: 4, maxHeight: 120, overflow: 'auto', color: '#fbbf24' }}>
                {aMano.map((x) => <div key={x.archivo}>{x.archivo}</div>)}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function btn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.06)', border: BORDER, borderRadius: 8, padding: '5px 10px',
    color: disabled ? '#475569' : '#e2e8f0', fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
  };
}
