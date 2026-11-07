// src/pages/TramitesDocumentalesPage/BajarAntecedentesMail.tsx
// Botón "Bajar antecedentes del mail": lanza ya el robot gmail_antecedentes (el mismo que
// corre solo todos los días a las 18:00) y espera su corrida. Deja los certificados de
// antecedentes penales en DOCU\<dni>\Certificado ant. Nacionales | Provinciales.
// Panel "Recibidos": últimos adjuntos procesados (script_run_items) con el formato en que
// vino cada uno (PDF / JPG / PNG); el robot lo guarda en `novedad` = "Antecedentes <tipo> · <formato>".
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

const ROBOT = 'gmail_antecedentes';

type Item = { id: number; dni: string | null; nombre: string | null; novedad: string | null; estado: string; detalle: string | null; creado_at: string };

const FORMATO_COLOR: Record<string, { bg: string; fg: string }> = {
  PDF: { bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5' },
  JPG: { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
  PNG: { bg: 'rgba(34,197,94,0.15)', fg: '#86efac' },
  FOTO: { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd' },
};

function partes(it: Item) {
  // "Antecedentes nacional · PNG" -> tipo 'nacional', formato 'PNG'
  const [t, f] = String(it.novedad || '').split(' · ');
  const tipo = t.replace(/^Antecedentes\s*/i, '').trim();
  return { tipo: tipo === '?' ? 'sin identificar' : tipo, formato: (f || '').trim() || '—' };
}

function fechaCorta(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function BajarAntecedentesMail() {
  const toast = useToast();
  const [robot, setRobot] = useState<{ fase: 'idle' | 'corriendo' | 'ok' | 'error'; msg?: string }>({ fase: 'idle' });
  const [items, setItems] = useState<Item[]>([]);
  const [verPanel, setVerPanel] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void cargarItems();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  async function cargarItems() {
    try {
      const r = await apiFetch<{ ok: boolean; data: Item[] }>(`/script-runs/items?script=${ROBOT}&limit=40`);
      setItems(r.data || []);
    } catch { /* sin permiso o sin datos: el panel queda vacío */ }
  }

  async function ultimaCorrida() {
    const r = await apiFetch<{ ok: boolean; data: any[] }>(`/script-runs/historial?script=${ROBOT}&limit=1`);
    return r.data?.[0] ?? null;
  }

  async function lanzar() {
    if (robot.fase === 'corriendo') return;
    try {
      const previa = await ultimaCorrida();
      const idPrevio = previa?.id ?? 0;
      await apiFetch(`/script-runs/ejecutar/${ROBOT}`, { method: 'POST' });
      setRobot({ fase: 'corriendo' });
      const inicio = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const u = await ultimaCorrida();
          if (u && u.id > idPrevio) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            if (u.estado === 'ok') {
              const motivo = String(u.motivo || '');
              const nada = /sin procesar:\s*0\b/i.test(motivo);
              const m = motivo.match(/OK:\s*(\d+)\s*certificado\(s\)[^,|]*,\s*(\d+)\s*sin identificar/i);
              const msg = nada ? 'No hay mails nuevos en la casilla'
                : m ? `${m[1]} certificado(s) a DOCU${Number(m[2]) ? ` · ${m[2]} sin identificar` : ''}` : 'Listo';
              setRobot({ fase: 'ok', msg });
              toast.ok('Antecedentes del mail', msg);
              await cargarItems();
              if (!nada) setVerPanel(true);
            } else {
              setRobot({ fase: 'error', msg: u.motivo || 'Error' });
              toast.error('El robot terminó con error', u.motivo || 'Ver página Robots');
            }
          } else if (Date.now() - inicio > 20 * 60 * 1000) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setRobot({ fase: 'error', msg: 'Pasaron 20 min sin terminar — ver página Robots' });
          }
        } catch { /* reintenta en el próximo tick */ }
      }, 10000);
    } catch (e: any) {
      setRobot({ fase: 'error', msg: e?.message || 'No se pudo lanzar' });
      toast.error('No se pudo lanzar el robot', e?.message || 'Error');
    }
  }

  const btn: React.CSSProperties = { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.6)', color: '#e9d5ff', fontSize: '0.75rem' };

  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4, position: 'relative' }}>
      {robot.fase !== 'idle' && (
        <span style={{ fontSize: '0.75rem', color: robot.fase === 'ok' ? '#4ade80' : robot.fase === 'error' ? '#fca5a5' : '#facc15' }}>
          {robot.fase === 'corriendo' ? '⏳ Revisando el mail…'
            : robot.fase === 'ok' ? `✅ ${robot.msg}` : `❌ ${robot.msg}`}
        </span>
      )}
      <button type="button" onClick={() => setVerPanel(v => !v)}
        title="Últimos certificados que llegaron por mail, con el formato en que vino cada uno"
        style={{ ...btn, background: verPanel ? 'rgba(124,58,237,0.3)' : 'transparent', cursor: 'pointer' }}>
        📋 Recibidos
      </button>
      <button type="button" onClick={() => void lanzar()} disabled={robot.fase === 'corriendo'}
        title="Baja ya los certificados de antecedentes penales de recepciondeantecedentesrrhhkm@gmail.com a DOCU (también corre solo todos los días a las 18:00). Toma PDF y fotos JPG/PNG."
        style={{ ...btn, background: robot.fase === 'corriendo' ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.3)', cursor: robot.fase === 'corriendo' ? 'wait' : 'pointer' }}>
        {robot.fase === 'corriendo' ? '⏳ Corriendo…' : '📧 Bajar antecedentes del mail'}
      </button>

      {verPanel && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50, width: 'min(720px, 92vw)', maxHeight: 420, overflow: 'auto',
          background: '#0f172a', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: '0.8rem', color: '#e9d5ff' }}>Antecedentes recibidos por mail</b>
            <button type="button" onClick={() => setVerPanel(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Todavía no llegó ninguno.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px' }}>Bajado</th>
                  <th style={{ padding: '4px 6px' }}>Agente</th>
                  <th style={{ padding: '4px 6px' }}>DNI</th>
                  <th style={{ padding: '4px 6px' }}>Tipo</th>
                  <th style={{ padding: '4px 6px' }}>Formato</th>
                  <th style={{ padding: '4px 6px' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const { tipo, formato } = partes(it);
                  const c = FORMATO_COLOR[formato] || { bg: 'rgba(148,163,184,0.12)', fg: '#cbd5e1' };
                  return (
                    <tr key={it.id} title={it.detalle || ''} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0' }}>
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{fechaCorta(it.creado_at)}</td>
                      <td style={{ padding: '4px 6px' }}>{it.nombre || '—'}</td>
                      <td style={{ padding: '4px 6px' }}>{it.dni || '—'}</td>
                      <td style={{ padding: '4px 6px', textTransform: 'capitalize' }}>{tipo}</td>
                      <td style={{ padding: '4px 6px' }}>
                        <span style={{ padding: '1px 8px', borderRadius: 6, background: c.bg, color: c.fg, fontWeight: 700 }}>{formato}</span>
                      </td>
                      <td style={{ padding: '4px 6px', color: it.estado === 'ok' ? '#4ade80' : it.estado === 'error' ? '#fca5a5' : '#facc15' }}>
                        {it.estado === 'ok' ? '✅ en DOCU' : it.estado === 'error' ? '❌ error' : '⚠️ revisar'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
