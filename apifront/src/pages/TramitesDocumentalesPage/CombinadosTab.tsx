// src/pages/TramitesDocumentalesPage/CombinadosTab.tsx
// Pestaña "Combinados": todos los PDF guardados con "Guardar combinado"
// (DOCU\<DNI>\Tramite de nombramiento\*.pdf) con su estado en GDEBA.
// Desde acá se lanza el robot que los sube como Informe Gráfico (IFGRA) y los
// envía a firmar al usuario GDEBA elegido (🧪 prueba = 1 archivo, frena antes de Aceptar).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchBlob } from '../../api/http';
import { useToast } from '../../ui/toast';

type Estado = 'PENDIENTE' | 'ENVIADA_FIRMA' | 'FIRMADA' | 'ERROR';
type Row = {
  dni: number; archivo: string; nombreArchivo: string; bytes: number; modificado: string;
  apellidoNombre: string; estado: Estado; firmante: string | null; gdebaNumero: string | null;
  gdebaError: string | null; enviadaAt: string | null;
  firmadaAt: string | null; archivoFirmado: string | null;
};

const ESTADOS: Record<Estado, { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente', color: '#64748b' },
  ENVIADA_FIRMA: { label: 'Enviada a firmar', color: '#2563eb' },
  FIRMADA: { label: 'Firmada', color: '#16a34a' },
  ERROR: { label: 'Error', color: '#dc2626' },
};
const LS_FIRMANTE = 'tramites.combinados.firmante';

function leerLS(k: string): string { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function grabarLS(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* noop */ } }
function fechaCorta(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function CombinadosTab() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [carpeta, setCarpeta] = useState('');
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState<Estado | 'TODOS'>('TODOS');
  const [buscar, setBuscar] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [firmante, setFirmante] = useState(() => leerLS(LS_FIRMANTE));
  const [lanzando, setLanzando] = useState(false);

  const cargar = useCallback(async (rescan = false) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: Row[]; carpeta: string } }>(
        `/tramites-documentales/combinados${rescan ? '?rescan=1' : ''}`);
      setRows(res.data.rows);
      setCarpeta(res.data.carpeta);
      setSel((prev) => new Set([...prev].filter((a) => res.data.rows.some((r) => r.archivo === a))));
    } catch (e: any) {
      toast.error('No se pudieron listar los combinados', e?.message || 'Error');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void cargar(); }, [cargar]);

  const conteo = useMemo(() => {
    const c: Record<string, number> = { TODOS: rows.length };
    for (const r of rows) c[r.estado] = (c[r.estado] || 0) + 1;
    return c;
  }, [rows]);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return rows.filter((r) => (filtro === 'TODOS' || r.estado === filtro)
      && (!q || r.apellidoNombre.toLowerCase().includes(q) || String(r.dni).includes(q) || r.nombreArchivo.toLowerCase().includes(q)
        || (r.gdebaNumero || '').toLowerCase().includes(q) || (r.archivoFirmado || '').toLowerCase().includes(q)));
  }, [rows, filtro, buscar]);

  const enviables = (r: Row) => r.estado === 'PENDIENTE' || r.estado === 'ERROR';
  const todosSel = visibles.filter(enviables).length > 0 && visibles.filter(enviables).every((r) => sel.has(r.archivo));

  function toggle(a: string) {
    setSel((prev) => { const n = new Set(prev); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  }
  function toggleTodos() {
    setSel(todosSel ? new Set() : new Set(visibles.filter(enviables).map((r) => r.archivo)));
  }

  async function bajarFirmados() {
    setLanzando(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { buscar: number } }>('/tramites-documentales/combinados/bajar-firmados', {
        method: 'POST', body: JSON.stringify({}),
      });
      toast.ok('Robot lanzado', `Busca en GDEBA ${res.data.buscar} combinado(s) enviados a firmar y baja los firmados`);
    } catch (e: any) {
      toast.error('No se pudo lanzar el robot', e?.message || 'Error');
    } finally { setLanzando(false); }
  }

  async function ver(r: Row, firmado = false) {
    const w = window.open('', '_blank');
    try {
      const archivo = firmado && r.archivoFirmado ? r.archivoFirmado : r.archivo;
      const blob = await apiFetchBlob(`/tramites-documentales/combinados/pdf?archivo=${encodeURIComponent(archivo)}`);
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e: any) {
      w?.close();
      toast.error('No se pudo abrir el PDF', e?.message || 'Error');
    }
  }

  async function cambiarEstado(r: Row, estado: Estado) {
    let gdebaNumero: string | undefined;
    if (estado === 'FIRMADA') {
      const n = window.prompt('Número de GDEBA del documento firmado (opcional):', r.gdebaNumero || '');
      if (n === null) return;
      gdebaNumero = n.trim();
    }
    try {
      await apiFetch('/tramites-documentales/combinados/estado', {
        method: 'PUT', body: JSON.stringify({ archivo: r.archivo, estado, gdebaNumero }),
      });
      await cargar();
    } catch (e: any) { toast.error('No se pudo cambiar el estado', e?.message || 'Error'); }
  }

  // El robot los hace de a uno: si uno falla queda en Error (con el motivo) y sigue con el
  // próximo. Los que fallaron se relanzan con ▶ en la fila o con "Reintentar errores".
  async function lanzar(prueba: boolean, soloEstos?: string[]) {
    const archivos = soloEstos ?? rows.filter((r) => sel.has(r.archivo) && enviables(r)).map((r) => r.archivo);
    if (!archivos.length) { toast.error('Elegí al menos un combinado pendiente', ''); return; }
    const f = firmante.trim().toUpperCase();
    if (!f) { toast.error('Falta el usuario GDEBA del firmante', 'Es el usuario de GDEBA (no el nombre)'); return; }
    if (!prueba && !window.confirm(`Se van a SUBIR a GDEBA y ENVIAR A FIRMAR a ${f} ${archivos.length} combinado(s), de a uno. ¿Seguro?`)) return;
    grabarLS(LS_FIRMANTE, f);
    setLanzando(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { archivos: number; como: string } }>('/tramites-documentales/combinados/gdeba', {
        method: 'POST', body: JSON.stringify({ archivos, prueba, firmanteUsuario: f }),
      });
      toast.ok(prueba ? 'Robot lanzado en modo prueba' : 'Robot lanzado',
        `${res.data.archivos} archivo(s) · se abre Chrome en el servidor${prueba ? ' · frena antes de Aceptar' : ''}`);
    } catch (e: any) {
      toast.error('No se pudo lanzar el robot', e?.message || 'Error');
    } finally { setLanzando(false); }
  }

  const chip: React.CSSProperties = { padding: '5px 12px', borderRadius: 999, fontSize: '0.76rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)' };
  const btn = (bg: string, off: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.8rem',
    background: off ? 'rgba(255,255,255,0.08)' : bg, color: off ? '#64748b' : '#fff', cursor: off ? 'default' : 'pointer',
  });
  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.1)' };
  const td: React.CSSProperties = { padding: '7px 8px', color: '#e2e8f0', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' };
  const nSel = rows.filter((r) => sel.has(r.archivo) && enviables(r)).length;
  const conError = rows.filter((r) => r.estado === 'ERROR').map((r) => r.archivo);
  const nEnviadas = rows.filter((r) => r.estado === 'ENVIADA_FIRMA').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Barra: filtros + robot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
        {(['TODOS', 'PENDIENTE', 'ENVIADA_FIRMA', 'FIRMADA', 'ERROR'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            style={{ ...chip, background: filtro === k ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: filtro === k ? '#fff' : '#cbd5e1' }}>
            {k === 'TODOS' ? 'Todos' : ESTADOS[k].label} <span style={{ opacity: 0.7 }}>({conteo[k] || 0})</span>
          </button>
        ))}
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar agente / DNI…"
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '0.8rem', width: 200 }} />
        <button type="button" onClick={() => void cargar()} style={{ ...chip, background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
        <button type="button" disabled={loading} onClick={() => void cargar(true)} style={{ ...chip, background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}
          title="Recorre todas las carpetas de DOCU (tarda ~30 s) y suma los combinados que no estaban anotados">
          🔍 Buscar en disco
        </button>
        <div style={{ flex: 1 }} />
        <label style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Firmante (usuario GDEBA)</label>
        <input value={firmante} onChange={(e) => setFirmante(e.target.value.toUpperCase())} placeholder="USUARIO"
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '0.8rem', width: 150 }} />
        <button type="button" disabled={lanzando || !nSel} onClick={() => void lanzar(true)} style={btn('#a16207', lanzando || !nSel)}
          title="Sube 1 combinado como IFGRA, elige el firmante y frena ANTES de Aceptar (no envía nada)">
          🧪 Probar con 1
        </button>
        <button type="button" disabled={lanzando || !nSel} onClick={() => void lanzar(false)} style={btn('#0f766e', lanzando || !nSel)}>
          🚀 Enviar a firmar ({nSel})
        </button>
        <button type="button" disabled={lanzando || !nEnviadas} onClick={() => void bajarFirmados()} style={btn('#1d4ed8', lanzando || !nEnviadas)}
          title="Busca en GDEBA los enviados a firmar y baja los ya firmados a la misma carpeta (no cambia nada en GDEBA)">
          ⬇ Bajar firmados ({nEnviadas})
        </button>
        {conError.length > 0 && (
          <button type="button" disabled={lanzando} onClick={() => void lanzar(false, conError)} style={btn('#b91c1c', lanzando)}
            title="Vuelve a mandar al robot todos los que quedaron en Error">
            ↻ Reintentar errores ({conError.length})
          </button>
        )}
      </div>

      <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
        PDF de <code>{carpeta || 'DOCU'}\&lt;DNI&gt;\Tramite de nombramiento\</code> · se suben a GDEBA como Informe Gráfico (IFGRA), repartición DPTRH.
      </div>

      <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 30 }}><input type="checkbox" checked={todosSel} onChange={toggleTodos} title="Elegir todos los pendientes visibles" /></th>
              <th style={th}>Agente</th>
              <th style={th}>DNI</th>
              <th style={th}>Archivo</th>
              <th style={th}>Guardado</th>
              <th style={th}>Estado GDEBA</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => (
              <tr key={r.archivo} style={{ background: sel.has(r.archivo) ? 'rgba(124,58,237,0.12)' : 'transparent' }}>
                <td style={td}>
                  <input type="checkbox" checked={sel.has(r.archivo)} disabled={!enviables(r)} onChange={() => toggle(r.archivo)} />
                </td>
                <td style={{ ...td, fontWeight: 600 }}>{r.apellidoNombre}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{r.dni}</td>
                <td style={{ ...td, color: '#cbd5e1' }}>
                  {r.nombreArchivo} <span style={{ color: '#64748b', fontSize: '0.72rem' }}>· {(r.bytes / 1024 / 1024).toFixed(1)} MB</span>
                </td>
                <td style={{ ...td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fechaCorta(r.modificado)}</td>
                <td style={td}>
                  <select value={r.estado} onChange={(e) => void cambiarEstado(r, e.target.value as Estado)}
                    style={{ background: ESTADOS[r.estado].color, color: '#fff', border: 'none', borderRadius: 6, padding: '3px 6px', fontSize: '0.74rem', fontWeight: 700 }}>
                    {(Object.keys(ESTADOS) as Estado[]).map((k) => <option key={k} value={k}>{ESTADOS[k].label}</option>)}
                  </select>
                  {r.gdebaNumero && <div style={{ color: '#86efac', fontSize: '0.72rem', marginTop: 2 }}>{r.gdebaNumero}{r.firmadaAt ? ` · ${fechaCorta(r.firmadaAt)}` : ''}</div>}
                  {r.estado === 'ENVIADA_FIRMA' && r.firmante && <div style={{ color: '#93c5fd', fontSize: '0.72rem', marginTop: 2 }}>a {r.firmante} · {fechaCorta(r.enviadaAt)}</div>}
                  {r.estado === 'ERROR' && r.gdebaError && <div style={{ color: '#fca5a5', fontSize: '0.72rem', marginTop: 2, maxWidth: 320 }}>{r.gdebaError}</div>}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {enviables(r) && (
                    <button type="button" disabled={lanzando} onClick={() => void lanzar(false, [r.archivo])}
                      title={r.estado === 'ERROR' ? 'Reintentar este' : 'Enviar a firmar solo este'}
                      style={{ background: r.estado === 'ERROR' ? '#b91c1c' : '#0f766e', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '3px 10px', fontSize: '0.76rem', marginRight: 6 }}>
                      {r.estado === 'ERROR' ? '↻ Reintentar' : '▶ Enviar'}
                    </button>
                  )}
                  {r.archivoFirmado && (
                    <button type="button" onClick={() => void ver(r, true)} title={r.archivoFirmado.split('/').pop()}
                      style={{ background: '#166534', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '3px 10px', fontSize: '0.76rem', marginRight: 6 }}>
                      📄 Firmado
                    </button>
                  )}
                  <button type="button" onClick={() => void ver(r)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer', padding: '3px 10px', fontSize: '0.76rem' }}>
                    👁 Ver
                  </button>
                </td>
              </tr>
            ))}
            {!visibles.length && (
              <tr><td colSpan={7} style={{ ...td, color: '#64748b', textAlign: 'center', padding: 20 }}>
                {loading ? 'Cargando…' : rows.length ? 'Nada con ese filtro.' : 'No hay combinados anotados. Usá 🔍 Buscar en disco para levantar los ya guardados.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
