import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';

// Pestaña "SDK 6.3 (prueba)": habla con el agente-sdk-relojes que corre en otra PC con el SDK 6.3.1.37
// (sin registrar). El servidor reenvía el pedido al agente; todas las acciones son de solo lectura.

type Agente = {
  id: string;
  host: string;
  ip: string;
  puerto: number;
  sdkVersion: string;
  agenteVersion: string;
  firewall: string;
  vivo: boolean;
  segundosDesdeAviso: number;
};

type DeviceLite = { sn: string; nombre?: string | null; alias: string | null; modelo: string | null };

const API = '/fichero-biometria-lab/sdk2';

const ACCIONES: Array<[string, string, string]> = [
  ['info', 'Información', 'Firmware, arquitectura nueva, serie y contadores'],
  ['opciones', 'Opciones', 'Todas las opciones conocidas del reloj'],
  ['teclas', 'Teclas de estado', 'Botones Entrada/Salida y sus nombres'],
  ['timbres', 'Timbres', 'Horarios de timbre cargados'],
  ['conteos', 'Conteos', 'Usuarios, huellas, caras y palmas (tabla nueva)'],
  ['tablas', 'Tablas', 'Tablas internas del reloj (usuarios, configuración, mensajes)'],
  ['funciones', 'Funciones del SDK', 'Lista de funciones que trae el SDK del agente'],
];

const S: Record<string, React.CSSProperties> = {
  title: { fontSize: 15, fontWeight: 800, marginBottom: 8, color: 'var(--text)' },
  muted: { color: 'var(--muted)', fontSize: 13 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 700, color: 'var(--muted)' },
  input: { height: 38, border: '1px solid var(--border)', borderRadius: 10, padding: '0 10px', fontSize: 14, background: 'rgba(255,255,255,0.06)', color: 'var(--text)', minWidth: 0 },
  buttons: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 14 },
  button: { border: '1px solid var(--border)', background: 'rgba(255,255,255,0.08)', color: 'var(--text)', borderRadius: 10, padding: '8px 10px', textAlign: 'left', cursor: 'pointer' },
  secondary: { height: 32, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.08)', color: 'var(--text)', borderRadius: 10, padding: '0 10px', fontWeight: 700, cursor: 'pointer' },
  agent: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', marginTop: 8, fontSize: 13, cursor: 'pointer' },
  warn: { marginTop: 10, padding: 10, border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.12)', borderRadius: 10, color: '#fbbf24', fontSize: 13 },
  pre: { marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(0,0,0,0.25)', fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflow: 'auto', color: 'var(--text)' },
};

export function Sdk63Tab({ devices }: { devices: DeviceLite[] }) {
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [claveOk, setClaveOk] = useState(true);
  const [agenteId, setAgenteId] = useState('');
  const [manual, setManual] = useState('');
  const [sn, setSn] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<any>(null);

  async function cargarAgentes() {
    const res = await apiFetch<{ ok: boolean; claveConfigurada: boolean; data: Agente[] }>(`${API}/agentes`);
    setClaveOk(!!res.claveConfigurada);
    setAgentes(res.data || []);
    const vivo = (res.data || []).find(a => a.vivo);
    if (!agenteId && vivo) setAgenteId(vivo.id);
  }

  useEffect(() => {
    cargarAgentes().catch(() => undefined);
    const t = setInterval(() => cargarAgentes().catch(() => undefined), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ejecutar(accion: string) {
    if (!agenteId && !manual.trim()) { setResult({ ok: false, error: 'Elegí un agente o escribí ip:puerto' }); return; }
    if (accion !== 'funciones' && !sn) { setResult({ ok: false, error: 'Elegí un reloj' }); return; }
    setBusy(accion);
    setResult(null);
    try {
      const res = await apiFetch<any>(`${API}/accion`, {
        method: 'POST',
        body: JSON.stringify({ accion, sn, agente: manual.trim() ? '' : agenteId, destino: manual.trim() }),
      });
      setResult(res);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div style={S.title}>SDK 6.3 (prueba) — agente en otra PC</div>
      <div style={S.muted}>
        Usa el SDK 6.3.1.37 que corre en el agente (otra PC), sin tocar el SDK del servidor. Solo lectura: no cambia nada en los relojes.
      </div>

      {!claveOk && <div style={S.warn}>Falta configurar FICHERO_SDK_AGENTE_CLAVE en el .env de la API: sin eso el servidor no habla con ningún agente.</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <span style={S.label}>Agentes encontrados</span>
        <button style={S.secondary} onClick={() => cargarAgentes().catch(() => undefined)}>Actualizar</button>
      </div>
      {!agentes.length && <div style={S.warn}>Ningún agente se anunció todavía. Arrancá agente-sdk-relojes en la otra PC, o escribí su ip:puerto abajo.</div>}
      {agentes.map(a => (
        <div
          key={a.id}
          style={{ ...S.agent, borderColor: agenteId === a.id ? '#14b8a6' : 'var(--border)', opacity: a.vivo ? 1 : 0.55 }}
          onClick={() => { setAgenteId(a.id); setManual(''); }}
        >
          <span>{a.vivo ? '🟢' : '🔴'}</span>
          <b>{a.id}</b>
          <span style={S.muted}>{a.ip}:{a.puerto} · SDK {a.sdkVersion || '?'} · firewall {a.firewall || '?'} · hace {a.segundosDesdeAviso}s</span>
        </div>
      ))}

      <div style={S.row}>
        <label style={S.field}>
          <span style={S.label}>Reloj</span>
          <select style={S.input} value={sn} onChange={e => setSn(e.target.value)}>
            <option value="">Elegir reloj</option>
            {devices.map(d => <option key={d.sn} value={d.sn}>{d.nombre || d.alias || d.sn} | {d.modelo || 'sin modelo'}</option>)}
          </select>
        </label>
        <label style={S.field}>
          <span style={S.label}>O agente a mano (ip:puerto)</span>
          <input style={S.input} value={manual} onChange={e => setManual(e.target.value)} placeholder="ej. 10.115.31.50:8099" />
        </label>
      </div>

      <div style={S.buttons}>
        {ACCIONES.map(([id, label, desc]) => (
          <button key={id} style={{ ...S.button, opacity: busy && busy !== id ? 0.5 : 1 }} disabled={!!busy} onClick={() => ejecutar(id)}>
            <div style={{ fontWeight: 800 }}>{busy === id ? 'Ejecutando…' : label}</div>
            <div style={S.muted}>{desc}</div>
          </button>
        ))}
      </div>

      {result && (
        <div style={S.pre}>
          {result.ok ? '✅ OK' : `❌ ${result.error || 'Error'}`}
          {result.ms != null ? ` · ${result.ms} ms` : ''}
          {'\n\n'}
          {JSON.stringify(result.data ?? result, null, 2)}
        </div>
      )}
    </>
  );
}
