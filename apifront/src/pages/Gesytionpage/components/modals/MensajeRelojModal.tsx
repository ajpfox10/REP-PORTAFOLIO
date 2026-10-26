// src/pages/Gesytionpage/components/modals/MensajeRelojModal.tsx
// Mensaje personal al reloj: aparece cuando el agente ficha, mientras esté vigente.
// La API lo encola en todos los relojes activos (mig 093 mensajes_reloj).
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../api/http';
import { useToast } from '../../../../ui/toast';
import { RelojesSelector } from '../../../../components/RelojesSelector';

const MAX = 80;

const VIGENCIAS: Array<[number, string]> = [
  [60, '1 hora'],
  [240, '4 horas'],
  [720, '12 horas'],
  [1440, '24 horas'],
  [2880, '2 días'],
  [10080, '7 días'],
];

type RelojEstado = { sn: string; reloj: string; estado: string };
type Mensaje = {
  id: number; mensaje: string; vigencia_min: number; estado: string; error: string | null;
  creado: string; creado_por: string | null; relojes: RelojEstado[];
};

interface Props {
  open: boolean;
  dni: string;
  apellido: string;
  nombre: string;
  onClose: () => void;
}

// Igual que la API: sin acentos ni ñ (el ADMS viejo los rompe).
function limpiar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
}

function colorEstado(e: string) {
  if (e === 'aceptado') return '#86efac';
  if (e.startsWith('error')) return '#fca5a5';
  return '#fcd34d';
}

export function MensajeRelojModal({ open, dni, apellido, nombre, onClose }: Props) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [vigencia, setVigencia] = useState(1440);
  const [sns, setSns] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [historial, setHistorial] = useState<Mensaje[]>([]);

  async function cargarHistorial() {
    try {
      const res = await apiFetch<{ ok: boolean; data: Mensaje[] }>(`/mensajes-reloj?dni=${dni}`);
      setHistorial(res.data || []);
    } catch {
      setHistorial([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    setTexto('');
    cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dni]);

  if (!open) return null;

  const largo = texto.length;
  const tieneAcentos = texto !== limpiar(texto);

  async function enviar() {
    if (!texto.trim()) { toast.error('Mensaje', 'Escribí el mensaje'); return; }
    if (!sns.length) { toast.error('Mensaje', 'Elegí al menos un reloj'); return; }
    setEnviando(true);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string; estado: string; relojes: RelojEstado[]; aviso?: string }>(
        '/mensajes-reloj',
        { method: 'POST', body: JSON.stringify({ dni: Number(dni), mensaje: texto, vigencia_min: vigencia, sns }) },
      );
      if (!res.ok) throw new Error(res.error || 'No se pudo encolar');
      if (res.estado === 'simulado') toast.ok('Mensaje guardado (prueba)', res.aviso || '');
      else toast.ok('Mensaje en cola', `${res.relojes.length} reloj(es). Puede tardar hasta 5 minutos en llegar.`);
      setTexto('');
      await cargarHistorial();
    } catch (e: any) {
      toast.error('No se pudo mandar el mensaje', e?.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal gp-pedido-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row gp-modal-head">
          <div>
            <div className="muted gp-muted-xs">Mensaje al reloj · DNI {dni}</div>
            <h3 className="gp-h3-0">{apellido}, {nombre}</h3>
          </div>
          <div className="row gp-row-wrap">
            <button className="btn" type="button" onClick={onClose} disabled={enviando}>Cerrar</button>
          </div>
        </div>

        <div className="sep" />

        <label className="gp-pedido-custom">
          <div className="muted">Mensaje (aparece en el reloj cuando ficha)</div>
          <textarea
            className="input"
            value={texto}
            maxLength={MAX}
            rows={3}
            onChange={(e) => setTexto(e.target.value.slice(0, MAX))}
            placeholder="Ej: Pase por RRHH al terminar el turno"
            style={{ resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }}
          />
        </label>
        <div className="row gp-row-between-wrap" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          <span className="muted">
            {tieneAcentos ? 'Los acentos y la ñ se van a quitar al mandarlo.' : 'Sin acentos ni ñ.'}
          </span>
          <span style={{ fontWeight: 700, color: largo >= MAX ? '#f87171' : largo >= MAX - 10 ? '#fbbf24' : '#94a3b8' }}>
            {largo} / {MAX}
          </span>
        </div>

        <div style={{ marginTop: 10 }}>
          <RelojesSelector value={sns} onChange={setSns} />
        </div>

        <div className="row gp-row-between-wrap gp-pedido-actions">
          <label className="gp-pedido-field">
            <div className="muted">Se muestra durante</div>
            <select className="input" value={vigencia} onChange={(e) => setVigencia(Number(e.target.value))}>
              {VIGENCIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="row gp-row-wrap">
            <button className="btn" type="button" onClick={onClose} disabled={enviando}>Cancelar</button>
            <button className="btn primary" type="button" onClick={enviar} disabled={enviando || !texto.trim() || !sns.length}>
              {enviando ? 'Enviando…' : `💬 Enviar a ${sns.length} reloj(es)`}
            </button>
          </div>
        </div>

        <div className="sep" />

        <div className="row gp-row-between-center">
          <b>Mensajes enviados</b>
          <button className="btn" type="button" onClick={cargarHistorial}>↻ Actualizar</button>
        </div>
        {!historial.length && <div className="muted" style={{ marginTop: 6 }}>Todavía no se le mandó ningún mensaje.</div>}
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 6 }}>
          {historial.map((m) => (
            <div key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '6px 0', fontSize: '0.8rem' }}>
              <div><b>{m.mensaje}</b></div>
              <div className="muted">
                {m.creado} · {m.creado_por || 'sin usuario'} · vigencia {Math.round(m.vigencia_min / 60)} h
                {m.estado === 'simulado' && ' · prueba (no se mandó)'}
                {m.estado === 'error' && ` · error: ${m.error || ''}`}
              </div>
              {!!m.relojes.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                  {m.relojes.map((r) => (
                    <span key={r.sn} className="badge" style={{ color: colorEstado(r.estado) }}>
                      {r.reloj}: {r.estado}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
