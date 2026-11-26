import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Pestaña 🧩 Documentos por trámite (25/11/2026): qué documentos lleva cada tipo de trámite
// (Designación de agente, Renovación de extranjeros, Renovación de temporarios 10430, o uno nuevo) en
// cada ley, y qué tipo de trámite es cada tanda. Con eso se arma, por agente, la lista de carpetas
// DOCU (combo "¿Qué documento es?" de Mails recibidos). Encima corren las reglas por agente (Ético y
// Matrícula solo técnicos/profesionales en la 10430, chofer, extranjeros, Ley 14783, Ley 10592).
// Back: GET /tramites-documentales/tipos-tramite, PUT .../tipos-tramite/docs, PUT .../tipos-tramite/tanda.
// ─────────────────────────────────────────────────────────────────────────────

type Doc = { ley: string; documento: string; activo: boolean; orden: number };
type Proceso = { proceso: string; nombre: string; docs: Doc[] };
type TandaTipo = { tanda: string; agentes: number; proceso: string; elegido: boolean };
type Datos = { procesos: Proceso[]; catalogo: string[]; tandas: TandaTipo[]; leyes: string[] };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const sel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: BORDER, borderRadius: 6, padding: '5px 8px', fontSize: '0.8rem',
};
const btn: React.CSSProperties = { ...sel, cursor: 'pointer' };
const k = (s: string) => s.trim().toLowerCase();

export function DocsPorTramiteTab() {
  const toast = useToast();
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [proceso, setProceso] = useState('PASE A TRANSITORIA');
  const [nuevos, setNuevos] = useState<Proceso[]>([]);           // tipos de trámite creados acá y todavía sin guardar
  const [extra, setExtra] = useState<string[]>([]);              // documentos agregados al catálogo acá
  const [lleva, setLleva] = useState<Record<string, Set<string>>>({}); // ley → documentos (lower) que lleva
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nuevoDoc, setNuevoDoc] = useState('');

  async function cargar() {
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: Datos }>('/tramites-documentales/tipos-tramite');
      setData(r.data);
    } catch (e: any) {
      toast.error('No se pudo leer la configuración', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const procesos = useMemo(() => [...(data?.procesos || []), ...nuevos.filter((n) => !data?.procesos.some((p) => p.proceso === n.proceso))], [data, nuevos]);
  const actual = procesos.find((p) => p.proceso === proceso) || null;
  const leyes = data?.leyes || ['10430', '10471'];

  // Al cambiar de trámite (o recargar) se arma lo que lleva cada ley.
  useEffect(() => {
    const m: Record<string, Set<string>> = {};
    for (const l of leyes) m[l] = new Set((actual?.docs || []).filter((d) => d.ley === l && d.activo).map((d) => k(d.documento)));
    setLleva(m);
    setSucio(false);
  }, [actual, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filas: primero los documentos del trámite en su orden, después el resto del catálogo.
  const filas = useMemo(() => {
    const out: string[] = [];
    const vistos = new Set<string>();
    const add = (d: string) => { if (d && !vistos.has(k(d))) { vistos.add(k(d)); out.push(d); } };
    [...(actual?.docs || [])].sort((a, b) => a.orden - b.orden).forEach((d) => add(d.documento));
    (data?.catalogo || []).forEach(add);
    extra.forEach(add);
    return out;
  }, [actual, data, extra]);

  function toggle(ley: string, doc: string) {
    setLleva((c) => {
      const s = new Set(c[ley] || []);
      if (s.has(k(doc))) s.delete(k(doc)); else s.add(k(doc));
      return { ...c, [ley]: s };
    });
    setSucio(true);
  }
  function copiarDe(origen: string) {
    const o = procesos.find((p) => p.proceso === origen);
    if (!o) return;
    const m: Record<string, Set<string>> = {};
    for (const l of leyes) m[l] = new Set(o.docs.filter((d) => d.ley === l && d.activo).map((d) => k(d.documento)));
    setLleva(m);
    setSucio(true);
  }
  function crearTipo() {
    const nombre = window.prompt('Nombre del tipo de trámite nuevo (ej. RENOVACION BECAS 2027):');
    const p = String(nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!p) return;
    if (procesos.some((x) => x.proceso === p)) { setProceso(p); return; }
    setNuevos((c) => [...c, { proceso: p, nombre: p, docs: [] }]);
    setProceso(p);
  }
  function agregarDoc() {
    const d = nuevoDoc.trim();
    if (!d) return;
    if (/[<>:"\\|?*]/.test(d)) { toast.error('Nombre inválido', 'No puede tener < > : " \\ | ? * (es el nombre de la carpeta en DOCU)'); return; }
    setExtra((c) => [...c, d]);
    setNuevoDoc('');
  }

  async function guardar() {
    if (!actual) return;
    setGuardando(true);
    try {
      for (const l of leyes) {
        const documentos = filas.filter((d) => lleva[l]?.has(k(d)));
        await apiFetch('/tramites-documentales/tipos-tramite/docs', { method: 'PUT', body: JSON.stringify({ proceso: actual.proceso, ley: l, documentos }) });
      }
      toast.ok('Guardado', `${actual.nombre}: ${leyes.map((l) => `${l} lleva ${lleva[l]?.size || 0}`).join(' · ')}`);
      setNuevos((c) => c.filter((n) => n.proceso !== actual.proceso));
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error');
    } finally {
      setGuardando(false);
    }
  }

  async function tipoDeTanda(tanda: string, p: string) {
    try {
      await apiFetch('/tramites-documentales/tipos-tramite/tanda', { method: 'PUT', body: JSON.stringify({ tanda, proceso: p }) });
      toast.ok('Tanda actualizada', `${tanda} → ${procesos.find((x) => x.proceso === p)?.nombre || p}`);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo cambiar el trámite de la tanda', e?.message || 'Error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
        Qué documentos lleva cada tipo de trámite, por ley. Con esto se arma la lista de carpetas DOCU de cada agente
        (por ejemplo, el combo <b>¿Qué documento es?</b> de Mails recibidos). Además corren solas las reglas por agente:
        Ético y Matrícula solo para técnicos y profesionales en la 10430, lo de chofer solo a choferes, lo de extranjeros
        solo a extranjeros, el Anexo 1 con el tilde Ley 14783 y Discapacidad con el tilde Ley 10592.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Tipo de trámite:</span>
        {procesos.map((p) => (
          <button key={p.proceso} type="button" onClick={() => { if (!sucio || window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) setProceso(p.proceso); }}
            style={{ ...btn, borderRadius: 999, background: p.proceso === proceso ? '#7c3aed' : sel.background, color: p.proceso === proceso ? '#fff' : '#e2e8f0' }}>
            {p.nombre}{p.docs.some((d) => d.activo) ? '' : ' (sin documentos)'}
          </button>
        ))}
        <button type="button" style={btn} onClick={crearTipo}>＋ Nuevo tipo de trámite</button>
        <button type="button" style={btn} onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : '↻ Actualizar'}</button>
      </div>

      {actual ? (
        <div style={{ border: BORDER, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderBottom: BORDER }}>
            <b style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{actual.nombre}</b>
            <span style={{ color: '#64748b', fontSize: '0.72rem' }}>({actual.proceso})</span>
            <span style={{ flex: 1 }} />
            <select value="" onChange={(e) => { if (e.target.value) copiarDe(e.target.value); }} style={sel}>
              <option value="">Copiar lo que lleva otro trámite…</option>
              {procesos.filter((p) => p.proceso !== actual.proceso).map((p) => <option key={p.proceso} value={p.proceso}>{p.nombre}</option>)}
            </select>
            <input value={nuevoDoc} onChange={(e) => setNuevoDoc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') agregarDoc(); }}
              placeholder="Documento nuevo (nombre de la carpeta)" style={{ ...sel, minWidth: 240 }} />
            <button type="button" style={btn} onClick={agregarDoc}>＋ Agregar</button>
            <button type="button" onClick={() => void guardar()} disabled={!sucio || guardando}
              style={{ ...btn, background: sucio ? '#7c3aed' : undefined, color: sucio ? '#fff' : '#64748b', border: sucio ? 'none' : BORDER }}>
              {guardando ? 'Guardando…' : sucio ? '💾 Guardar' : 'Sin cambios'}
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '7px 10px', fontWeight: 500 }}>Documento / carpeta DOCU</th>
                {leyes.map((l) => (
                  <th key={l} style={{ padding: '7px 10px', fontWeight: 500, textAlign: 'center', width: 130 }}>
                    Ley {l} <span style={{ color: '#64748b' }}>({lleva[l]?.size || 0})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((d) => {
                const alguna = leyes.some((l) => lleva[l]?.has(k(d)));
                return (
                  <tr key={d} style={{ borderTop: BORDER, opacity: alguna ? 1 : 0.55 }}>
                    <td style={{ padding: '6px 10px', color: '#e2e8f0' }}>{d}</td>
                    {leyes.map((l) => {
                      const si = !!lleva[l]?.has(k(d));
                      return (
                        <td key={l} style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <label style={{ cursor: 'pointer', color: si ? '#22c55e' : '#64748b', fontSize: '0.76rem', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                            <input type="checkbox" checked={si} onChange={() => toggle(l, d)} />
                            {si ? 'Lleva' : 'No lleva'}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ border: BORDER, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '8px 10px', borderBottom: BORDER, color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 700 }}>
          Tipo de trámite de cada tanda
          <span style={{ color: '#64748b', fontWeight: 400, fontSize: '0.74rem' }}> · sin elegir: "RENOVACIÓN … TEMPORARIOS" → renovación de temporarios, "RENOVACIÓN …" → de extranjeros, el resto → designación</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <tbody>
            {(data?.tandas || []).map((t) => (
              <tr key={t.tanda} style={{ borderTop: BORDER }}>
                <td style={{ padding: '6px 10px', color: '#e2e8f0' }}>{t.tanda}</td>
                <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{t.agentes} agente(s)</td>
                <td style={{ padding: '6px 10px' }}>
                  <select value={t.proceso} onChange={(e) => void tipoDeTanda(t.tanda, e.target.value)} style={sel}>
                    {procesos.map((p) => <option key={p.proceso} value={p.proceso}>{p.nombre}</option>)}
                    {!procesos.some((p) => p.proceso === t.proceso) ? <option value={t.proceso}>{t.proceso}</option> : null}
                  </select>
                  {!t.elegido ? <span style={{ color: '#64748b', fontSize: '0.72rem', marginLeft: 6 }}>(automático por el nombre)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
