import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Device = {
  sn: string;
  nombre?: string | null;
  alias: string | null;
  modelo: string | null;
  ip: string | null;
  pushVersion: string | number | null;
  firmware: string | null;
  state: number;
  delTag: number;
  lastActivity: string | null;
};

type UserRow = {
  userid: number;
  dni: string;
  nombre: string;
  sn: string | null;
  huellas: number;
  rostros: number;
  palmas: number;
};

type CommandPreview = {
  destino: string;
  tipo: string;
  comando: string;
  detalle: string;
};

type CommandStatus = {
  id: number;
  sn: string;
  comando: string;
  creado: string;
  enviadoAlReloj: string | null;
  finalizado: string | null;
  retorno: number | null;
};

type BiometricsByDeviceRow = {
  userid: number;
  dni: string;
  nombre: string;
  sn: string;
  huellas: number;
  caras: number;
  palmas: number;
};

type BiometricsSummary = {
  total: number;
  conHuella: number;
  conCara: number;
  conPalma: number;
};

type BiometricsUpdateResult = {
  ok: boolean;
  ids: number[];
  total: number;
  usuarios: number;
  omitidos: number;
  resumen: {
    huellas: number;
    caras: number;
    palmas: number;
  };
  warnings?: string[];
  error?: string;
};

type IncludeState = {
  usuario: boolean;
  huellas: boolean;
  rostros: boolean;
  caras: boolean;
  palmas: boolean;
};

type SdkResult = { ok: boolean; error?: string; [k: string]: any };
type DeleteScope = 'todo' | 'huellas' | 'cara' | 'palma' | 'usuario';

const API = '/fichero-biometria-lab';

const initialInclude: IncludeState = {
  usuario: true,
  huellas: true,
  rostros: true,
  caras: true,
  palmas: true,
};

const S: Record<string, React.CSSProperties> = {
  shell: { width: '100%' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 },
  subtitle: { color: 'var(--muted)', fontSize: 14, maxWidth: 760 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 360px) minmax(0, 1fr)', gap: 16, alignItems: 'start' },
  panel: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.25)' },
  sectionTitle: { fontSize: 15, fontWeight: 800, marginBottom: 12, color: 'var(--text)' },
  muted: { color: 'var(--muted)', fontSize: 13 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: 700, color: 'var(--muted)' },
  input: { height: 38, border: '1px solid var(--border)', borderRadius: 10, padding: '0 10px', fontSize: 14, background: 'rgba(255,255,255,0.06)', color: 'var(--text)', minWidth: 0 },
  textarea: { border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 14, background: 'rgba(255,255,255,0.06)', color: 'var(--text)', minHeight: 76, resize: 'vertical' },
  buttonRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 },
  button: { height: 38, border: '1px solid #0f766e', background: '#0f766e', color: '#fff', borderRadius: 10, padding: '0 12px', fontWeight: 800, cursor: 'pointer' },
  secondary: { height: 38, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.08)', color: 'var(--text)', borderRadius: 10, padding: '0 12px', fontWeight: 800, cursor: 'pointer' },
  danger: { height: 38, border: '1px solid #b91c1c', background: '#b91c1c', color: '#fff', borderRadius: 10, padding: '0 12px', fontWeight: 800, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: 14 },
  tab: { border: 0, background: 'transparent', padding: '10px 12px', fontWeight: 800, color: 'var(--muted)', cursor: 'pointer', borderBottom: '3px solid transparent' },
  tabActive: { color: '#14b8a6', borderBottomColor: '#14b8a6' },
  checkGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8, marginTop: 4 },
  check: { display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', borderRadius: 10, padding: '8px 9px', fontSize: 13, background: 'rgba(255,255,255,0.05)', color: 'var(--text)' },
  tableWrap: { overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '9px 10px', background: 'rgba(255,255,255,0.04)', color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,0.10)', verticalAlign: 'top', color: 'var(--text)' },
  code: { fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  status: { display: 'inline-flex', alignItems: 'center', height: 24, borderRadius: 999, padding: '0 9px', fontSize: 12, fontWeight: 800 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 },
  miniCard: { border: '1px solid var(--border)', borderRadius: 16, padding: 12, background: 'var(--card)', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' },
  warning: { marginBottom: 8, padding: 10, border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.12)', borderRadius: 10, color: '#fbbf24' },
  userList: { marginTop: 12, maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 },
  userButton: { display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: 'var(--text)', padding: 10, cursor: 'pointer' },
  userButtonActive: { background: 'rgba(20,184,166,0.16)' },
};

function deviceName(d?: Device | null) {
  if (!d) return '';
  return `${d.nombre || d.alias || d.modelo || d.sn} - ${d.modelo || 'sin modelo'} (${d.sn})`;
}

function deviceOptionLabel(d: Device) {
  const state = Number(d.delTag) === 1 || Number(d.state) === 0 ? 'inactivo' : 'activo';
  return `${d.nombre || d.alias || d.sn} | ${d.modelo || 'sin modelo'} | ${state}`;
}

function statusLabel(row: CommandStatus) {
  if (row.finalizado) return { label: `finalizado ${row.retorno ?? 0}`, color: 'rgba(16,185,129,0.16)', text: '#86efac' };
  if (row.enviadoAlReloj) return { label: 'enviado al reloj', color: 'rgba(245,158,11,0.16)', text: '#fcd34d' };
  return { label: 'pendiente', color: 'rgba(14,165,233,0.16)', text: '#7dd3fc' };
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={S.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={S.field}>
      <span style={S.label}>{label}</span>
      {children}
    </label>
  );
}

export function FicheroBiometriaLabPage() {
  const toast = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [origenSn, setOrigenSn] = useState('');
  const [destinoSn, setDestinoSn] = useState('');
  const [dni, setDni] = useState('');
  const [include, setInclude] = useState<IncludeState>(initialInclude);
  const [tab, setTab] = useState<'transferir' | 'lectura' | 'biometria' | 'sdk' | 'mensajes' | 'comandos'>('transferir');
  const [preview, setPreview] = useState<CommandPreview[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastIds, setLastIds] = useState<number[]>([]);
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [bioSn, setBioSn] = useState('');
  const [bioQ, setBioQ] = useState('');
  const [bioRows, setBioRows] = useState<BiometricsByDeviceRow[]>([]);
  const [bioSummary, setBioSummary] = useState<BiometricsSummary | null>(null);

  const [msgSn, setMsgSn] = useState('');
  const [msgDni, setMsgDni] = useState('');
  const [msgPersonal, setMsgPersonal] = useState(true);
  const [msgText, setMsgText] = useState('');
  const [msgMinutes, setMsgMinutes] = useState(1440);
  const [msgPreview, setMsgPreview] = useState<CommandPreview[]>([]);

  const [sdkBusy, setSdkBusy] = useState(false);
  const [sdkTitle, setSdkTitle] = useState('');
  const [sdkResult, setSdkResult] = useState<SdkResult | null>(null);
  const [delScope, setDelScope] = useState<DeleteScope>('cara');

  const sourceDevice = useMemo(() => devices.find(d => d.sn === origenSn), [devices, origenSn]);
  const targetDevice = useMemo(() => devices.find(d => d.sn === destinoSn), [devices, destinoSn]);
  const deviceLabels = useMemo(() => {
    return new Map(devices.map(d => [d.sn, d.nombre || d.alias || d.sn]));
  }, [devices]);

  async function loadDevices() {
    const res = await apiFetch<{ ok: boolean; data: Device[]; error?: string }>(`${API}/dispositivos`);
    if (!res.ok) throw new Error(res.error || 'No se pudieron leer los relojes');
    const rows = res.data || [];
    setDevices(rows);
    if (!origenSn && rows[0]) setOrigenSn(rows[0].sn);
    if (!destinoSn && rows[1]) setDestinoSn(rows[1].sn);
  }

  async function searchUsers(nextQ = q) {
    const qs = new URLSearchParams();
    if (nextQ.trim()) qs.set('q', nextQ.trim());
    if (origenSn.trim()) qs.set('sn', origenSn.trim());
    const res = await apiFetch<{ ok: boolean; data: UserRow[]; error?: string }>(`${API}/usuarios?${qs.toString()}`);
    if (!res.ok) throw new Error(res.error || 'No se pudieron leer usuarios');
    setUsers(res.data || []);
  }

  async function refreshCommands(ids = lastIds, sn = destinoSn) {
    const qs = new URLSearchParams();
    if (ids.length) qs.set('ids', ids.join(','));
    else if (sn) qs.set('sn', sn);
    const res = await apiFetch<{ ok: boolean; data: CommandStatus[]; error?: string }>(`${API}/comandos?${qs.toString()}`);
    if (!res.ok) throw new Error(res.error || 'No se pudieron leer comandos');
    setCommands(res.data || []);
  }

  async function loadBiometricsByDevice() {
    if (!bioSn) {
      toast.error('Biometria por fichero', 'Elegi un fichero primero.');
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ sn: bioSn, limit: '5000' });
      if (bioQ.trim()) qs.set('q', bioQ.trim());
      const res = await apiFetch<{ ok: boolean; resumen: BiometricsSummary; data: BiometricsByDeviceRow[]; error?: string }>(`${API}/biometria-fichero?${qs.toString()}`);
      if (!res.ok) throw new Error(res.error || 'No se pudo leer biometria del fichero');
      setBioRows(res.data || []);
      setBioSummary(res.resumen || null);
      toast.ok('Biometria cargada', `${res.resumen?.total || 0} usuarios`);
    } catch (e: any) {
      toast.error('Biometria por fichero', e?.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateMissingBiometrics() {
    if (!bioSn) {
      toast.error('Actualizar faltantes', 'Elegi un fichero primero.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<BiometricsUpdateResult>(`${API}/biometria-fichero/actualizar`, {
        method: 'POST',
        body: JSON.stringify({
          sn: bioSn,
          q: bioQ,
          limit: 5000,
          soloFaltantes: true,
          incluir: {
            huellas: include.huellas,
            rostros: include.rostros,
            caras: include.caras,
            palmas: include.palmas,
          },
        }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo actualizar faltantes');
      const ids = res.ids || [];
      setWarnings(res.warnings || []);
      setLastIds(ids);
      await refreshCommands(ids);
      toast.ok('Faltantes en cola', `${res.total || 0} comandos para ${res.usuarios || 0} usuarios`);
    } catch (e: any) {
      toast.error('Actualizar faltantes', e?.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDevices().catch(e => toast.error('Error leyendo relojes', e?.message));
  }, []);

  useEffect(() => {
    if (origenSn) searchUsers('').catch(() => undefined);
  }, [origenSn]);

  function pickUser(u: UserRow) {
    setDni(u.dni);
    setMsgDni(u.dni);
  }

  async function previewTransfer() {
    setLoading(true);
    setPreview([]);
    setWarnings([]);
    try {
      const res = await apiFetch<{ ok: boolean; data: CommandPreview[]; warnings?: string[]; error?: string }>(`${API}/transferencias/preview`, {
        method: 'POST',
        body: JSON.stringify({ origenSn, destinoSn, dni, incluir: include }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo previsualizar');
      setPreview(res.data || []);
      setWarnings(res.warnings || []);
      toast.ok('Vista previa lista', `${res.data?.length || 0} comandos`);
    } catch (e: any) {
      toast.error('Transferencia', e?.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendTransfer() {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; ids: number[]; data: CommandPreview[]; warnings?: string[]; error?: string }>(`${API}/transferencias/enviar`, {
        method: 'POST',
        body: JSON.stringify({ origenSn, destinoSn, dni, incluir: include }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo encolar');
      setPreview(res.data || []);
      setWarnings(res.warnings || []);
      setLastIds(res.ids || []);
      await refreshCommands(res.ids || []);
      toast.ok('Comandos en cola', `${res.ids?.length || 0} comandos para ${deviceName(targetDevice)}`);
    } catch (e: any) {
      toast.error('No se pudo transferir', e?.message);
    } finally {
      setLoading(false);
    }
  }

  async function requestRead() {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; ids: number[]; comandos: string[]; warnings?: string[]; error?: string }>(`${API}/lectura/enviar`, {
        method: 'POST',
        body: JSON.stringify({ sn: origenSn, dni, incluir: include }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo pedir lectura');
      setWarnings(res.warnings || []);
      setLastIds(res.ids || []);
      setPreview((res.comandos || []).map((comando) => ({ destino: origenSn, tipo: 'lectura', comando, detalle: 'Pedir datos al reloj origen' })));
      await refreshCommands(res.ids || []);
      toast.ok('Lectura pedida', 'Cuando el reloj responda, vas a poder transferir lo recibido.');
    } catch (e: any) {
      toast.error('Lectura del origen', e?.message);
    } finally {
      setLoading(false);
    }
  }

  async function previewMessage() {
    try {
      const res = await apiFetch<{ ok: boolean; data: CommandPreview[]; error?: string }>(`${API}/mensajes/preview`, {
        method: 'POST',
        body: JSON.stringify({ sn: msgSn, dni: msgDni, personal: msgPersonal, contenido: msgText, minutos: msgMinutes }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo previsualizar mensaje');
      setMsgPreview(res.data || []);
      toast.ok('Mensaje listo');
    } catch (e: any) {
      toast.error('Mensaje', e?.message);
    }
  }

  async function sendMessage() {
    try {
      const res = await apiFetch<{ ok: boolean; ids: number[]; data: CommandPreview[]; error?: string }>(`${API}/mensajes/enviar`, {
        method: 'POST',
        body: JSON.stringify({ sn: msgSn, dni: msgDni, personal: msgPersonal, contenido: msgText, minutos: msgMinutes }),
      });
      if (!res.ok) throw new Error(res.error || 'No se pudo enviar mensaje');
      setMsgPreview([]);
      setMsgText('');
      setLastIds(res.ids || []);
      await refreshCommands(res.ids || []);
      toast.ok('Mensaje en cola', `${res.ids?.length || 0} comando(s)`);
    } catch (e: any) {
      toast.error('No se pudo encolar mensaje', e?.message);
    }
  }

  async function callSdk(title: string, url: string, body: any) {
    setSdkBusy(true);
    setSdkTitle(title);
    setSdkResult(null);
    try {
      const res = await apiFetch<SdkResult>(`${API}${url}`, { method: 'POST', body: JSON.stringify(body) });
      setSdkResult(res);
      if (res.ok) toast.ok(title, 'Listo');
      else toast.error(title, res.error || 'Error del SDK');
    } catch (e: any) {
      setSdkResult({ ok: false, error: e?.message || String(e) });
      toast.error(title, e?.message);
    } finally {
      setSdkBusy(false);
    }
  }

  function sdkTransfer() {
    if (!origenSn || !destinoSn || !dni) {
      toast.error('Transferir por SDK', 'Elegí origen, destino y DNI.');
      return;
    }
    callSdk('Transferir por SDK', '/sdk/transferir', { origenSn, destinoSn, dni, incluir: include });
  }

  function sdkDelete() {
    if (!destinoSn || !dni) {
      toast.error('Borrar en destino', 'Elegí destino y DNI.');
      return;
    }
    const target = deviceName(targetDevice);
    if (!window.confirm(`Vas a BORRAR "${delScope}" del PIN ${dni} en ${target}. Esta acción no se puede deshacer. ¿Seguir?`)) return;
    callSdk('Borrar en destino', '/sdk/borrar', { sn: destinoSn, dni, alcance: delScope });
  }

  const stats = useMemo(() => {
    const active = devices.filter(d => Number(d.delTag) !== 1 && Number(d.state) !== 0).length;
    return [
      ['Relojes', String(devices.length)],
      ['Activos', String(active)],
      ['Usuarios vistos', String(users.length)],
      ['Ultima cola', String(lastIds.length)],
    ];
  }, [devices, users, lastIds]);

  return (
    <Layout title="Fichero biometria y mensajes">
      <div style={S.shell}>
        <div style={S.header}>
          <div style={S.subtitle}>
            Transferencia ADMS entre relojes: usuario, huellas, rostro/cara, palma y mensajes internos del equipo. Los comandos quedan en cola hasta que cada reloj consulta.
          </div>
          <button style={S.secondary} onClick={() => loadDevices().then(() => toast.ok('Relojes actualizados')).catch(e => toast.error('Error', e?.message))}>
            Actualizar relojes
          </button>
        </div>

        <div style={S.cardGrid}>
          {stats.map(([label, value]) => (
            <div key={label} style={S.miniCard}>
              <div style={S.label}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={S.grid}>
          <aside style={S.panel}>
            <div style={S.sectionTitle}>Seleccion</div>
            <Field label="Reloj origen">
              <select style={S.input} value={origenSn} onChange={(e) => setOrigenSn(e.target.value)}>
                {devices.map(d => <option key={d.sn} value={d.sn}>{deviceOptionLabel(d)}</option>)}
              </select>
            </Field>
            <Field label="Reloj destino">
              <select style={S.input} value={destinoSn} onChange={(e) => setDestinoSn(e.target.value)}>
                {devices.map(d => <option key={d.sn} value={d.sn}>{deviceOptionLabel(d)}</option>)}
              </select>
            </Field>
            <Field label="DNI / PIN">
              <input style={S.input} value={dni} onChange={(e) => setDni(e.target.value)} placeholder="Ej: 28305607" />
            </Field>
            <div style={S.sectionTitle}>Datos a operar</div>
            <div style={S.checkGrid}>
              <CheckBox label="Usuario" checked={include.usuario} onChange={v => setInclude(p => ({ ...p, usuario: v }))} />
              <CheckBox label="Huellas" checked={include.huellas} onChange={v => setInclude(p => ({ ...p, huellas: v }))} />
              <CheckBox label="Rostro" checked={include.rostros} onChange={v => setInclude(p => ({ ...p, rostros: v }))} />
              <CheckBox label="Cara" checked={include.caras} onChange={v => setInclude(p => ({ ...p, caras: v }))} />
              <CheckBox label="Palma" checked={include.palmas} onChange={v => setInclude(p => ({ ...p, palmas: v }))} />
            </div>

            <div style={{ ...S.sectionTitle, marginTop: 16 }}>Buscar usuario</div>
            <Field label="DNI o nombre">
              <input style={S.input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchUsers()} />
            </Field>
            <button style={S.secondary} onClick={() => searchUsers().catch(e => toast.error('Busqueda', e?.message))}>Buscar</button>
            <div style={S.userList}>
              {users.map(u => (
                <button
                  key={`${u.userid}-${u.dni}`}
                  onClick={() => pickUser(u)}
                  style={{ ...S.userButton, ...(dni === u.dni ? S.userButtonActive : {}) }}
                >
                  <strong>{u.dni}</strong> {u.nombre || ''}
                  <div style={S.muted}>H:{u.huellas || 0} R:{u.rostros || 0} P:{u.palmas || 0}</div>
                </button>
              ))}
              {!users.length && <div style={{ padding: 12, ...S.muted }}>Sin usuarios para mostrar.</div>}
            </div>
          </aside>

          <main style={S.panel}>
            <div style={S.tabs}>
              {[
                ['transferir', 'Transferir'],
                ['lectura', 'Pedir lectura'],
                ['biometria', 'Biometria por fichero'],
                ['sdk', 'SDK directo'],
                ['mensajes', 'Mensajes'],
                ['comandos', 'Comandos'],
              ].map(([id, label]) => (
                <button key={id} style={{ ...S.tab, ...(tab === id ? S.tabActive : {}) }} onClick={() => setTab(id as any)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'transferir' && (
              <>
                <div style={S.sectionTitle}>Transferencia origen-servidor-destino</div>
                <div style={S.muted}>Origen: {deviceName(sourceDevice)}. Destino: {deviceName(targetDevice)}.</div>
                <div style={S.buttonRow}>
                  <button style={S.secondary} disabled={loading} onClick={previewTransfer}>Previsualizar comandos</button>
                  <button style={S.button} disabled={loading} onClick={sendTransfer}>Encolar transferencia</button>
                  <button style={S.secondary} onClick={() => refreshCommands().catch(e => toast.error('Comandos', e?.message))}>Ver cola</button>
                </div>
                <PreviewTable rows={preview} warnings={warnings} deviceLabels={deviceLabels} />
              </>
            )}

            {tab === 'lectura' && (
              <>
                <div style={S.sectionTitle}>Pedir datos al reloj origen</div>
                <div style={S.muted}>Usalo si falta huella, rostro/cara o palma en el servidor. El reloj sube los datos cuando procese los comandos.</div>
                <div style={S.buttonRow}>
                  <button style={S.button} disabled={loading} onClick={requestRead}>Pedir USERINFO/FINGERTMP/BIODATA</button>
                  <button style={S.secondary} onClick={() => refreshCommands([], bioSn).catch(e => toast.error('Comandos', e?.message))}>Ver estado</button>
                </div>
                <PreviewTable rows={preview} warnings={warnings} deviceLabels={deviceLabels} />
              </>
            )}

            {tab === 'biometria' && (
              <>
                <div style={S.sectionTitle}>Quien tiene huella, cara y palma por fichero</div>
                <div style={S.row}>
                  <Field label="Fichero">
                    <select style={S.input} value={bioSn} onChange={(e) => setBioSn(e.target.value)}>
                      <option value="">Elegir fichero</option>
                      {devices.map(d => <option key={d.sn} value={d.sn}>{deviceOptionLabel(d)}</option>)}
                    </select>
                  </Field>
                  <Field label="Filtrar DNI o nombre">
                    <input style={S.input} value={bioQ} onChange={(e) => setBioQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadBiometricsByDevice()} placeholder="Opcional" />
                  </Field>
                </div>
                <div style={S.buttonRow}>
                  <button style={S.button} disabled={loading} onClick={loadBiometricsByDevice}>Ver biometria</button>
                  <button style={S.secondary} disabled={loading} onClick={updateMissingBiometrics}>Actualizar faltantes</button>
                  <button style={S.secondary} onClick={() => refreshCommands().catch(e => toast.error('Comandos', e?.message))}>Ver estado</button>
                </div>
                {bioSummary && (
                  <div style={{ ...S.cardGrid, marginTop: 16 }}>
                    <div style={S.miniCard}><div style={S.label}>Usuarios</div><div style={{ fontSize: 22, fontWeight: 900 }}>{bioSummary.total}</div></div>
                    <div style={S.miniCard}><div style={S.label}>Con huella</div><div style={{ fontSize: 22, fontWeight: 900 }}>{bioSummary.conHuella}</div></div>
                    <div style={S.miniCard}><div style={S.label}>Con cara</div><div style={{ fontSize: 22, fontWeight: 900 }}>{bioSummary.conCara}</div></div>
                    <div style={S.miniCard}><div style={S.label}>Con palma</div><div style={{ fontSize: 22, fontWeight: 900 }}>{bioSummary.conPalma}</div></div>
                  </div>
                )}
                {warnings.map(w => <div key={w} style={S.warning}>{w}</div>)}
                <BiometricsTable rows={bioRows} />
              </>
            )}

            {tab === 'sdk' && (
              <>
                <div style={S.sectionTitle}>SDK directo (zkemkeeper 32 bits)</div>
                <div style={S.muted}>
                  Habla directo con el reloj por TCP 4370, sin pasar por el ADMS viejo. Origen: {deviceName(sourceDevice)}. Destino: {deviceName(targetDevice)}. PIN: {dni || '—'}.
                </div>

                <div style={{ ...S.sectionTitle, marginTop: 16, fontSize: 13 }}>Diagnóstico contra el reloj real</div>
                <div style={S.muted}>Prueba identidad, capacidades y si el firmware deja leer cara/huella/biodata para el PIN. Ideal para validar antes de trasladar.</div>
                <div style={S.buttonRow}>
                  <button style={S.button} disabled={sdkBusy || !origenSn} onClick={() => callSdk('Diagnóstico origen', '/sdk/diagnostico', { sn: origenSn, dni })}>Diagnosticar origen</button>
                  <button style={S.secondary} disabled={sdkBusy || !destinoSn} onClick={() => callSdk('Diagnóstico destino', '/sdk/diagnostico', { sn: destinoSn, dni })}>Diagnosticar destino</button>
                </div>

                <div style={{ ...S.sectionTitle, marginTop: 16, fontSize: 13 }}>Consultar reloj</div>
                <div style={S.buttonRow}>
                  <button style={S.secondary} disabled={sdkBusy || !origenSn} onClick={() => callSdk('Info origen', '/sdk/info', { sn: origenSn })}>Info + capacidades (origen)</button>
                  <button style={S.secondary} disabled={sdkBusy || !destinoSn} onClick={() => callSdk('Info destino', '/sdk/info', { sn: destinoSn })}>Info + capacidades (destino)</button>
                  <button style={S.secondary} disabled={sdkBusy || !origenSn || !dni} onClick={() => callSdk('Contar en origen', '/sdk/contar', { sn: origenSn, dni })}>Contar biometría (origen)</button>
                  <button style={S.secondary} disabled={sdkBusy || !destinoSn || !dni} onClick={() => callSdk('Contar en destino', '/sdk/contar', { sn: destinoSn, dni })}>Contar biometría (destino)</button>
                  <button style={S.secondary} disabled={sdkBusy || !origenSn || !dni} onClick={() => callSdk('Usuario en origen', '/sdk/usuario', { sn: origenSn, dni })}>Leer usuario (origen)</button>
                </div>

                <div style={{ ...S.sectionTitle, marginTop: 16, fontSize: 13 }}>Trasladar por SDK</div>
                <div style={S.muted}>Usa lo tildado en "Datos a operar": usuario, huellas, rostro/cara y palma, todo por SDK directo.</div>
                <div style={S.buttonRow}>
                  <button style={S.button} disabled={sdkBusy} onClick={sdkTransfer}>Transferir origen → destino por SDK</button>
                </div>

                <div style={{ ...S.sectionTitle, marginTop: 16, fontSize: 13, color: '#fca5a5' }}>Borrar en destino (peligroso)</div>
                <div style={S.buttonRow}>
                  <select style={{ ...S.input, maxWidth: 180 }} value={delScope} onChange={(e) => setDelScope(e.target.value as DeleteScope)}>
                    <option value="cara">Solo cara</option>
                    <option value="palma">Solo palma</option>
                    <option value="huellas">Solo huellas</option>
                    <option value="usuario">Usuario (todo)</option>
                    <option value="todo">Todo (huella+cara+palma+usuario)</option>
                  </select>
                  <button style={S.danger} disabled={sdkBusy || !destinoSn || !dni} onClick={sdkDelete}>Borrar en destino</button>
                </div>

                <SdkResultView title={sdkTitle} busy={sdkBusy} result={sdkResult} />
              </>
            )}

            {tab === 'mensajes' && (
              <>
                <div style={S.sectionTitle}>Mensajes internos del reloj</div>
                <div style={S.row}>
                  <Field label="Reloj">
                    <select style={S.input} value={msgSn} onChange={(e) => setMsgSn(e.target.value)}>
                      <option value="">Elegir fichero</option>
                      {devices.map(d => <option key={d.sn} value={d.sn}>{deviceOptionLabel(d)}</option>)}
                    </select>
                  </Field>
                  <Field label="DNI / PIN para mensaje personal">
                    <input style={S.input} value={msgDni} onChange={(e) => setMsgDni(e.target.value)} placeholder="Vacio si es publico" />
                  </Field>
                </div>
                <div style={S.row}>
                  <Field label="Tipo">
                    <select style={S.input} value={msgPersonal ? 'personal' : 'publico'} onChange={(e) => setMsgPersonal(e.target.value === 'personal')}>
                      <option value="personal">Personal al fichar</option>
                      <option value="publico">Publico</option>
                    </select>
                  </Field>
                  <Field label="Minutos valido">
                    <input style={S.input} type="number" min={0} max={65535} value={msgMinutes} onChange={(e) => setMsgMinutes(Number(e.target.value))} />
                  </Field>
                </div>
                <Field label="Mensaje">
                  <textarea style={S.textarea} value={msgText} onChange={(e) => setMsgText(e.target.value)} maxLength={60} placeholder="Ej: Pase por RRHH al finalizar su turno" />
                </Field>
                <div style={S.muted}>{msgText.length}/60 caracteres</div>
                <div style={S.buttonRow}>
                  <button style={S.secondary} onClick={previewMessage}>Previsualizar mensaje</button>
                  <button style={S.button} onClick={sendMessage}>Encolar mensaje</button>
                </div>
                <PreviewTable rows={msgPreview} warnings={[]} deviceLabels={deviceLabels} />
              </>
            )}

            {tab === 'comandos' && (
              <>
                <div style={S.sectionTitle}>Estado de comandos</div>
                <div style={S.buttonRow}>
                  <button style={S.secondary} onClick={() => refreshCommands().catch(e => toast.error('Comandos', e?.message))}>Actualizar</button>
                  <button style={S.secondary} onClick={() => { setLastIds([]); refreshCommands([]).catch(e => toast.error('Comandos', e?.message)); }}>Ver ultimos del destino</button>
                </div>
                <CommandTable rows={commands} deviceLabels={deviceLabels} />
              </>
            )}
          </main>
        </div>
      </div>
    </Layout>
  );
}

function PreviewTable({ rows, warnings, deviceLabels }: { rows: CommandPreview[]; warnings: string[]; deviceLabels: Map<string, string> }) {
  return (
    <div style={{ marginTop: 16 }}>
      {warnings.map(w => <div key={w} style={S.warning}>{w}</div>)}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Tipo</th>
              <th style={S.th}>Destino</th>
              <th style={S.th}>Detalle</th>
              <th style={S.th}>Comando</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.destino}-${r.tipo}-${idx}`}>
                <td style={S.td}>{r.tipo}</td>
                <td style={S.td}>{deviceLabels.get(r.destino) || r.destino}</td>
                <td style={S.td}>{r.detalle}</td>
                <td style={{ ...S.td, ...S.code }}>{r.comando}</td>
              </tr>
            ))}
            {!rows.length && <tr><td style={S.td} colSpan={4}>Sin comandos para mostrar.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommandTable({ rows, deviceLabels }: { rows: CommandStatus[]; deviceLabels: Map<string, string> }) {
  return (
    <div style={{ ...S.tableWrap, marginTop: 16 }}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>ID</th>
            <th style={S.th}>Reloj</th>
            <th style={S.th}>Estado</th>
            <th style={S.th}>Creado</th>
            <th style={S.th}>Comando</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const st = statusLabel(r);
            return (
              <tr key={r.id}>
                <td style={S.td}>{r.id}</td>
                <td style={S.td}>{deviceLabels.get(r.sn) || r.sn}</td>
                <td style={S.td}><span style={{ ...S.status, background: st.color, color: st.text }}>{st.label}</span></td>
                <td style={S.td}>{r.creado}</td>
                <td style={{ ...S.td, ...S.code }}>{r.comando}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td style={S.td} colSpan={5}>Sin comandos para mostrar.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SdkResultView({ title, busy, result }: { title: string; busy: boolean; result: SdkResult | null }) {
  if (busy) {
    return <div style={{ ...S.warning, marginTop: 16, borderColor: 'rgba(59,130,246,0.45)', background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>Ejecutando SDK contra el reloj… (puede tardar unos segundos)</div>;
  }
  if (!result) return null;
  const okColor = result.ok ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)';
  const okText = result.ok ? '#86efac' : '#fca5a5';
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ ...S.status, background: okColor, color: okText }}>{result.ok ? 'OK' : 'ERROR'}</span>
        <strong>{title}</strong>
      </div>
      {result.error && <div style={S.warning}>{result.error}</div>}
      <div style={{ ...S.tableWrap, padding: 12 }}>
        <pre style={{ ...S.code, margin: 0, maxHeight: 420, overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre>
      </div>
    </div>
  );
}

function BiometricsTable({ rows }: { rows: BiometricsByDeviceRow[] }) {
  const yesNo = (value: number) => Number(value || 0) > 0 ? 'Si' : 'No';
  return (
    <div style={{ ...S.tableWrap, marginTop: 16 }}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>DNI</th>
            <th style={S.th}>Nombre</th>
            <th style={S.th}>Huella</th>
            <th style={S.th}>Cara</th>
            <th style={S.th}>Palma</th>
            <th style={S.th}>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.userid}-${r.dni}`}>
              <td style={S.td}><strong>{r.dni}</strong></td>
              <td style={S.td}>{r.nombre || '-'}</td>
              <td style={S.td}>{yesNo(r.huellas)}</td>
              <td style={S.td}>{yesNo(r.caras)}</td>
              <td style={S.td}>{yesNo(r.palmas)}</td>
              <td style={S.td}>H:{r.huellas || 0} C:{r.caras || 0} P:{r.palmas || 0}</td>
            </tr>
          ))}
          {!rows.length && <tr><td style={S.td} colSpan={6}>Sin datos para mostrar.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
