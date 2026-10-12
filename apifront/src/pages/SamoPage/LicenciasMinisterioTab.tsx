// src/pages/SamoPage/LicenciasMinisterioTab.tsx
// SAMO → "Licencias Ministerio": lo cargado en la Intranet del Ministerio (robot intranet_descarga_anual)
// por dependencia, una línea por agente con código + fechas dentro del mes. Todo menos 34-FC.
// Solo se ven los meses que un admin habilitó con la clave fija (SAMO_CLAVE_HABILITACION del .env).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf } from '../../utils/export';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'];

type MesHab = { anio: number; mes: number; habilitado_en: string };
type Lic = { codigo: string; novedad: string; desde: string; hasta: string; desde_real: string; hasta_real: string };
type Fila = { dni: number; apellido_nombre: string; legajo: string | null; cargo: string | null; licencias: Lic[]; dias: number };

const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const ddmmyyyy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const tramo = (l: Lic) => l.desde === l.hasta ? ddmm(l.desde) : `${ddmm(l.desde)}–${ddmm(l.hasta)}`;
const linea = (f: Fila) => f.licencias.map(l => `${l.codigo} (${tramo(l)})`).join(' · ');
const clave = (m: { anio: number; mes: number }) => `${m.anio}-${m.mes}`;

export function LicenciasMinisterioTab() {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const isAdmin = hasPerm('usuarios:write') || hasPerm('crud:*:*');

  const [meses,    setMeses]    = useState<MesHab[]>([]);
  const [sel,      setSel]      = useState('');
  const [dep,      setDep]      = useState('HOSPITAL');
  const [filas,    setFilas]    = useState<Fila[]>([]);
  const [meta,     setMeta]     = useState<{ descargado_en: string | null } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const cargarMeses = useCallback(async () => {
    try {
      const r = await apiFetch<any>('/samo-ministerio/meses');
      const data: MesHab[] = r?.data || [];
      setMeses(data);
      setSel(prev => (prev && data.some(m => clave(m) === prev)) ? prev : (data[0] ? clave(data[0]) : ''));
    } catch (e: any) {
      toast.error('No se pudieron leer los meses habilitados', e?.message);
    }
  }, [toast]);

  useEffect(() => { cargarMeses(); }, [cargarMeses]);

  useEffect(() => {
    if (!sel) { setFilas([]); setMeta(null); return; }
    const [anio, mes] = sel.split('-');
    let vivo = true;
    setLoading(true);
    apiFetch<any>(`/samo-ministerio/licencias?anio=${anio}&mes=${mes}&dep=${encodeURIComponent(dep)}`)
      .then(r => { if (vivo) { setFilas(r?.data || []); setMeta(r?.meta || null); } })
      .catch((e: any) => { if (vivo) { setFilas([]); setMeta(null); toast.error('Error al cargar licencias del Ministerio', e?.message); } })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [sel, dep, toast]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter(f => String(f.dni).includes(q) || (f.apellido_nombre || '').toLowerCase().includes(q));
  }, [filas, busqueda]);

  const selMes = meses.find(m => clave(m) === sel);
  const titulo = selMes ? `${MESES[selMes.mes - 1]} ${selMes.anio}` : '';

  const exportar = (tipo: 'excel' | 'pdf') => {
    const rows = visibles.map(f => ({
      DNI: f.dni, 'Apellido y nombre': f.apellido_nombre, Legajo: f.legajo || '', Días: f.dias, Licencias: linea(f),
    }));
    const file = `samo_licencias_ministerio_${dep.replace(/\s+/g, '')}_${sel}`;
    if (tipo === 'excel') exportToExcel(file, rows);
    else exportToPdf(file, rows);
  };

  return (
    <>
      {isAdmin && <HabilitarMeses meses={meses} onCambio={cargarMeses} />}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {DEPENDENCIAS.map(d => (
            <button key={d} type="button" className="btn" onClick={() => setDep(d)} style={{
              fontSize: '0.75rem', padding: '4px 12px',
              background: dep === d ? 'rgba(124,58,237,0.3)' : undefined,
              border: dep === d ? '1px solid #7c3aed' : undefined, fontWeight: dep === d ? 700 : 400,
            }}>{d}</button>
          ))}
        </div>
        {meses.length > 0 && (
          <select aria-label="Mes habilitado" className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
            value={sel} onChange={e => { setSel(e.target.value); setBusqueda(''); }}>
            {meses.map(m => <option key={clave(m)} value={clave(m)}>{MESES[m.mes - 1]} {m.anio}</option>)}
          </select>
        )}
        {sel && !loading && (
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {filas.length} agente{filas.length !== 1 ? 's' : ''} con licencias en {titulo}
            {meta?.descargado_en && <> · datos del Ministerio al {new Date(meta.descargado_en).toLocaleString('es-AR')}</>}
          </span>
        )}
        {sel && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn" style={{ fontSize: '0.72rem', background: '#16a34a', color: '#fff' }}
              onClick={() => exportar('excel')} disabled={loading || !visibles.length}>📊 Excel</button>
            <button className="btn" style={{ fontSize: '0.72rem', background: '#dc2626', color: '#fff' }}
              onClick={() => exportar('pdf')} disabled={loading || !visibles.length}>📕 PDF</button>
          </div>
        )}
      </div>

      {!meses.length ? (
        <div className="muted" style={{ padding: '28px 0', textAlign: 'center', fontSize: '0.83rem' }}>
          🔒 Todavía no hay meses habilitados. Un administrador tiene que habilitar el mes para poder verlo.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <input aria-label="Buscar por DNI o apellido" className="input" style={{ flex: 1, maxWidth: 340, fontSize: '0.83rem' }}
              placeholder="Buscar por DNI / apellido…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {busqueda && <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => setBusqueda('')}>✕</button>}
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>🔄 Cargando…</div>
          ) : !visibles.length ? (
            <div className="muted" style={{ padding: '20px 0', textAlign: 'center', fontSize: '0.82rem' }}>Sin registros.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.79rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {['DNI', 'Apellido y nombre', 'Días', 'Licencias del mes (código y fechas)'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(f => (
                    <tr key={f.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{f.dni}</td>
                      <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{f.apellido_nombre}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{f.dias}</td>
                      <td style={{ padding: '5px 10px' }}>
                        {f.licencias.map((l, i) => (
                          <span key={i} title={`${l.novedad} — ${ddmmyyyy(l.desde_real)} al ${ddmmyyyy(l.hasta_real)}`}
                            style={{ display: 'inline-block', marginRight: 6, marginBottom: 2, padding: '1px 7px', borderRadius: 5,
                                     background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', whiteSpace: 'nowrap' }}>
                            <strong style={{ color: '#c4b5fd' }}>{l.codigo}</strong> {tramo(l)}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─── Bloque de habilitación (solo admin) ──────────────────────────────────────
function HabilitarMeses({ meses, onCambio }: { meses: MesHab[]; onCambio: () => void }) {
  const toast = useToast();
  const hoy = new Date();
  const [anio,    setAnio]    = useState(hoy.getFullYear());
  const [mes,     setMes]     = useState(hoy.getMonth() + 1);
  const [codigo,  setCodigo]  = useState('');
  const [verClave, setVerClave] = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);

  const habilitar = async () => {
    if (!codigo.trim()) { toast.error('Falta la clave'); return; }
    setBusy(true);
    try {
      await apiFetch('/samo-ministerio/meses', { method: 'POST', body: JSON.stringify({ anio, mes, clave: codigo.trim() }) });
      toast.ok(`${MESES[mes - 1]} ${anio} habilitado`);
      setCodigo('');
      onCambio();
    } catch (e: any) {
      toast.error('No se pudo habilitar', e?.message);
    } finally { setBusy(false); }
  };

  const deshabilitar = async (m: MesHab) => {
    if (!window.confirm(`¿Deshabilitar ${MESES[m.mes - 1]} ${m.anio}? SAMO deja de verlo.`)) return;
    try {
      await apiFetch(`/samo-ministerio/meses/${m.anio}/${m.mes}`, { method: 'DELETE' });
      onCambio();
    } catch (e: any) {
      toast.error('No se pudo deshabilitar', e?.message);
    }
  };

  const mostrarClave = async () => {
    if (verClave) { setVerClave(null); return; }
    try {
      const r = await apiFetch<any>('/samo-ministerio/clave');
      setVerClave(r?.clave || '');
    } catch (e: any) {
      toast.error('No se pudo leer la clave', e?.message);
    }
  };

  return (
    <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, border: '1px dashed rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)' }}>
      <div style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}>🔐 Habilitar mes (solo admin)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Mes a habilitar" className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
          value={mes} onChange={e => setMes(Number(e.target.value))}>
          {MESES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <input aria-label="Año a habilitar" type="number" className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 80 }}
          value={anio} onChange={e => setAnio(Number(e.target.value))} />
        <input aria-label="Clave de habilitación" type="password" className="input" style={{ fontSize: '0.78rem', padding: '4px 8px', width: 160 }}
          placeholder="Clave" value={codigo} onChange={e => setCodigo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') habilitar(); }} />
        <button className="btn" style={{ fontSize: '0.75rem', background: '#7c3aed', color: '#fff' }} onClick={habilitar} disabled={busy}>
          {busy ? 'Habilitando…' : '✔ Habilitar'}
        </button>
        <button className="btn" style={{ fontSize: '0.72rem' }} onClick={mostrarClave}>
          {verClave ? '🙈 Ocultar clave' : '👁 Ver clave'}
        </button>
        {verClave !== null && <code style={{ fontSize: '0.8rem', color: '#fbbf24' }}>{verClave || '(sin clave en .env)'}</code>}
      </div>
      {meses.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {meses.map(m => (
            <span key={clave(m)} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
              {MESES[m.mes - 1]} {m.anio}
              <button type="button" aria-label={`Deshabilitar ${MESES[m.mes - 1]} ${m.anio}`} onClick={() => deshabilitar(m)}
                style={{ marginLeft: 6, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
