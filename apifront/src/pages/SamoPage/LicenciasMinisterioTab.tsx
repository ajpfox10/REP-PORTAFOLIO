// src/pages/SamoPage/LicenciasMinisterioTab.tsx
// SAMO → "Licencias Ministerio": lo cargado en la Intranet del Ministerio (robot intranet_descarga_anual)
// por dependencia, una línea por agente con código + fechas dentro del mes. El admin elige qué códigos no ve SAMO.
// Solo se ven los meses que un admin habilitó con la clave fija (SAMO_CLAVE_HABILITACION del .env).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { exportToExcelSheets, exportToPdf } from '../../utils/export';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'];

type MesHab = { anio: number; mes: number; habilitado_en: string };
type Lic = { codigo: string; novedad: string; desde: string; hasta: string; desde_real: string; hasta_real: string; oculto?: boolean };
type Fila = { dni: number; apellido_nombre: string; legajo: string | null; cargo: string | null; licencias: Lic[]; dias: number };

const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const ddmmyyyy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const tramo = (l: Lic) => l.desde === l.hasta ? ddmm(l.desde) : `${ddmm(l.desde)}–${ddmm(l.hasta)}`;
const clave = (m: { anio: number; mes: number }) => `${m.anio}-${m.mes}`;
const diasLic = (l: Lic) => Math.round((Date.parse(l.hasta) - Date.parse(l.desde)) / 86400000) + 1;
// "01-ENFERMEDAD CORTO TRATAMIENTO" → "ENFERMEDAD CORTO TRATAMIENTO"
const nombreLic = (l: Lic) => {
  const n = String(l.novedad || '').trim();
  return n.startsWith(`${l.codigo}-`) ? n.slice(l.codigo.length + 1).trim() : (n || l.codigo);
};
// color estable por código, para distinguirlos de un vistazo
const colorCodigo = (c: string) => {
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 70% 45%)`, soft: `hsla(${h}, 70%, 45%, 0.12)`, borde: `hsla(${h}, 70%, 55%, 0.45)` };
};

function ChipCodigo({ l }: { l: Lic }) {
  const c = colorCodigo(l.codigo);
  return (
    <span style={{ display: 'inline-block', minWidth: 26, textAlign: 'center', padding: '1px 6px', borderRadius: 4,
                   background: c.bg, color: '#fff', fontWeight: 800, fontFamily: 'monospace', fontSize: '0.78rem' }}>
      {l.codigo}
    </span>
  );
}

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
  const [codsFiltro, setCodsFiltro] = useState<string[]>([]);   // tipos de licencia elegidos (vacío = todos)
  const [verRefs,  setVerRefs]  = useState(false);
  const [verTipos, setVerTipos] = useState(false);
  const [recarga,  setRecarga]  = useState(0);
  const [pagina,   setPagina]   = useState(0);
  const [porPag,   setPorPag]   = useState(50);

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
  }, [sel, dep, toast, recarga]);

  useEffect(() => { setCodsFiltro([]); }, [sel, dep]);
  const toggleCod = (c: string) => setCodsFiltro(a => a.includes(c) ? a.filter(x => x !== c) : [...a, c]);
  const pasaCod = (l: Lic) => !codsFiltro.length || codsFiltro.includes(l.codigo);

  // referencias: códigos que aparecen en el mes, con su nombre y cuántos agentes lo tienen
  const referencias = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string; agentes: number; dias: number; lic: Lic; oculto: boolean }>();
    for (const f of filas) {
      const vistos = new Set<string>();
      for (const l of f.licencias) {
        let r = m.get(l.codigo);
        if (!r) { r = { codigo: l.codigo, nombre: nombreLic(l), agentes: 0, dias: 0, lic: l, oculto: !!l.oculto }; m.set(l.codigo, r); }
        r.dias += diasLic(l);
        if (!vistos.has(l.codigo)) { vistos.add(l.codigo); r.agentes++; }
      }
    }
    return [...m.values()].sort((a, b) => b.agentes - a.agentes || a.codigo.localeCompare(b.codigo));
  }, [filas]);

  // filtro por tipo de licencia (sin búsqueda): es lo que baja el Excel
  const porTipo = useMemo(() =>
    codsFiltro.length ? filas.filter(f => f.licencias.some(l => codsFiltro.includes(l.codigo))) : filas,
  [filas, codsFiltro]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return porTipo.filter(f => !q || String(f.dni).includes(q) || (f.apellido_nombre || '').toLowerCase().includes(q));
  }, [porTipo, busqueda]);

  // paginado
  useEffect(() => { setPagina(0); }, [sel, dep, busqueda, codsFiltro, porPag]);
  const totalPag = Math.max(1, Math.ceil(visibles.length / porPag));
  const pag = Math.min(pagina, totalPag - 1);
  const enPagina = visibles.slice(pag * porPag, pag * porPag + porPag);

  const selMes = meses.find(m => clave(m) === sel);
  const titulo = selMes ? `${MESES[selMes.mes - 1]} ${selMes.anio}` : '';

  const exportar = (tipo: 'excel' | 'pdf') => {
    // una fila por licencia, con el nombre de la licencia y las fechas (en el mes y las reales)
    const file = `samo_licencias_ministerio_${dep.replace(/\s+/g, '')}_${sel}`
      + (codsFiltro.length ? `_${codsFiltro.join('-')}` : '');
    if (tipo === 'excel') {
      // Excel = toda la tabla del mes/dependencia (sin búsqueda), respetando el filtro de tipos de licencia
      const rows = porTipo.flatMap(f => f.licencias
        .filter(pasaCod)
        .map(l => ({
          DNI: f.dni, Legajo: f.legajo || '', 'Apellido y nombre': f.apellido_nombre, Cargo: f.cargo || '',
          Código: l.codigo, Licencia: nombreLic(l),
          'Desde (en el mes)': ddmmyyyy(l.desde), 'Hasta (en el mes)': ddmmyyyy(l.hasta), 'Días en el mes': diasLic(l),
          'Desde (real)': ddmmyyyy(l.desde_real), 'Hasta (real)': ddmmyyyy(l.hasta_real),
          ...(isAdmin ? { 'SAMO la ve': l.oculto ? 'NO' : 'SÍ' } : {}),
        })));

      // Hoja 2: grilla — agentes en filas, días del mes en columnas, el código en cada día
      const [anio, mes] = sel.split('-').map(Number);
      const diasMes = new Date(anio, mes, 0).getDate();
      const DOW = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
      // claves "01 Lu" (no numéricas puras, así JS respeta el orden de columnas)
      const colDia = Array.from({ length: diasMes }, (_, i) =>
        `${String(i + 1).padStart(2, '0')} ${DOW[new Date(anio, mes - 1, i + 1).getDay()]}`);
      const grilla = porTipo.map(f => {
        const celdas: string[][] = Array.from({ length: diasMes }, () => []);
        for (const l of f.licencias.filter(pasaCod)) {
          const d1 = Number(l.desde.slice(8, 10)), d2 = Number(l.hasta.slice(8, 10));
          const cod = l.oculto ? `(${l.codigo})` : l.codigo;   // admin: entre paréntesis = SAMO no la ve
          for (let d = d1; d <= d2; d++) if (!celdas[d - 1].includes(cod)) celdas[d - 1].push(cod);
        }
        const r: Record<string, any> = { DNI: f.dni, Legajo: f.legajo || '', 'Apellido y nombre': f.apellido_nombre, Cargo: f.cargo || '' };
        colDia.forEach((c, i) => { r[c] = celdas[i].join('/'); });
        r['Días'] = f.licencias.filter(pasaCod).filter(l => !l.oculto).reduce((s, l) => s + diasLic(l), 0);
        return r;
      });

      exportToExcelSheets(file, [
        { name: 'Licencias', rows },
        { name: 'Por día', rows: grilla, cols: [10, 9, 32, 28, ...colDia.map(() => 6), 6] },
      ]);
    } else {
      const rows = visibles.flatMap(f => f.licencias
        .filter(pasaCod)
        .map(l => ({
          DNI: f.dni, 'Apellido y nombre': f.apellido_nombre, Código: l.codigo, Licencia: nombreLic(l),
          Desde: ddmmyyyy(l.desde), Hasta: ddmmyyyy(l.hasta), Días: diasLic(l),
          ...(isAdmin ? { 'SAMO la ve': l.oculto ? 'NO' : 'SÍ' } : {}),
        })));
      exportToPdf(file, rows);
    }
  };

  return (
    <>
      {isAdmin && <HabilitarMeses meses={meses} onCambio={cargarMeses} />}
      {isAdmin && <CodigosOcultos onCambio={() => setRecarga(n => n + 1)} />}

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
              onClick={() => exportar('excel')} disabled={loading || !porTipo.length}
              title={'Hoja 1: una fila por licencia (legajo, cargo, nombre de la licencia y fechas).\n'
                + 'Hoja 2: agentes × días del mes con el código en cada día.\n'
                + 'Respeta el filtro de tipos de licencia (no la búsqueda).'}>📊 Excel</button>
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
            {referencias.length > 0 && (
              <button type="button" className="btn" style={{ fontSize: '0.75rem' }} onClick={() => setVerRefs(v => !v)}>
                📖 {verRefs ? 'Ocultar' : 'Ver'} referencias de licencias ({referencias.length})
              </button>
            )}
            {referencias.length > 0 && (
              <button type="button" className="btn" onClick={() => setVerTipos(v => !v)}
                style={{ fontSize: '0.75rem', ...(codsFiltro.length ? { background: 'rgba(124,58,237,0.3)', border: '1px solid #7c3aed' } : {}) }}>
                🏷️ Tipos de licencia: {codsFiltro.length ? `${codsFiltro.length} elegido${codsFiltro.length !== 1 ? 's' : ''}` : 'todos'} ▾
              </button>
            )}
            {codsFiltro.length > 0 && (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {codsFiltro.map(c => (
                  <span key={c} title="Quitar del filtro" style={{ cursor: 'pointer' }} onClick={() => toggleCod(c)}>
                    <ChipCodigo l={referencias.find(r => r.codigo === c)?.lic ?? ({ codigo: c } as Lic)} />
                  </span>
                ))}
                <button type="button" className="btn" style={{ fontSize: '0.72rem' }} onClick={() => setCodsFiltro([])}>✕ Limpiar</button>
              </span>
            )}
          </div>
          {verTipos && referencias.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.35)',
                          background: 'rgba(124,58,237,0.06)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '0.7rem' }}>
                  Licencias cargadas en {titulo} · {dep}. Tildá las que querés ver (sin tildar = todas).
                </span>
                <button type="button" className="btn" style={{ fontSize: '0.7rem', marginLeft: 'auto' }}
                  onClick={() => setCodsFiltro(referencias.map(r => r.codigo))}>Todas</button>
                <button type="button" className="btn" style={{ fontSize: '0.7rem' }} onClick={() => setCodsFiltro([])}>Ninguna</button>
                <button type="button" className="btn" style={{ fontSize: '0.7rem' }} onClick={() => setVerTipos(false)}>Cerrar</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                {referencias.map(r => {
                  const on = codsFiltro.includes(r.codigo);
                  return (
                    <label key={r.codigo} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                      fontSize: '0.76rem', background: on ? colorCodigo(r.codigo).soft : 'transparent',
                      border: `1px solid ${on ? colorCodigo(r.codigo).borde : 'rgba(255,255,255,0.06)'}` }}>
                      <input type="checkbox" checked={on} onChange={() => toggleCod(r.codigo)} />
                      <ChipCodigo l={r.lic} />
                      <span style={{ flex: 1, opacity: r.oculto ? 0.5 : 1 }}>{r.nombre}</span>
                      <span className="muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{r.agentes} ag.</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {verRefs && referencias.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)' }}>
              <div className="muted" style={{ fontSize: '0.7rem', marginBottom: 8 }}>
                Licencias que aparecen en {titulo} · {dep}. Hacé clic en una para ver solo esos agentes.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
                {referencias.map(r => (
                  <button key={r.codigo} type="button" onClick={() => toggleCod(r.codigo)}
                    title={`${r.agentes} agente${r.agentes !== 1 ? 's' : ''} · ${r.dias} días en el mes`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', padding: '4px 8px',
                             borderRadius: 6, color: 'inherit', fontSize: '0.76rem',
                             background: codsFiltro.includes(r.codigo) ? colorCodigo(r.codigo).soft : 'transparent',
                             border: `1px solid ${codsFiltro.includes(r.codigo) ? colorCodigo(r.codigo).borde : 'rgba(255,255,255,0.06)'}` }}>
                    <ChipCodigo l={r.lic} />
                    <span style={{ flex: 1, opacity: r.oculto ? 0.5 : 1 }}>{r.nombre}</span>
                    {r.oculto && <span style={{ fontSize: '0.65rem', color: '#f87171', whiteSpace: 'nowrap' }}>🙈 SAMO no la ve</span>}
                    <span className="muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{r.agentes} ag.</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>🔄 Cargando…</div>
          ) : !visibles.length ? (
            <div className="muted" style={{ padding: '20px 0', textAlign: 'center', fontSize: '0.82rem' }}>Sin registros.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.79rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {['DNI', 'Apellido y nombre', 'Días', 'Licencias del mes — código + fechas (pasá el mouse para ver el nombre)'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enPagina.map(f => (
                    <tr key={f.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{f.dni}</td>
                      <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{f.apellido_nombre}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{f.dias}</td>
                      <td style={{ padding: '5px 10px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {f.licencias.map((l, i) => {
                            const c = colorCodigo(l.codigo);
                            const recortada = l.desde !== l.desde_real || l.hasta !== l.hasta_real;
                            return (
                              <span key={i}
                                title={`${l.codigo} — ${nombreLic(l)}\n${diasLic(l)} día${diasLic(l) !== 1 ? 's' : ''} en el mes`
                                  + (recortada ? `\nLicencia completa: ${ddmmyyyy(l.desde_real)} al ${ddmmyyyy(l.hasta_real)}` : '')
                                  + (l.oculto ? '\n🙈 SAMO no ve esta licencia (no suma días)' : '')}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 2px', borderRadius: 6,
                                         background: c.soft, border: `1px solid ${c.borde}`, whiteSpace: 'nowrap', cursor: 'help',
                                         opacity: !pasaCod(l) || l.oculto ? 0.35 : 1,
                                         borderStyle: l.oculto ? 'dashed' : 'solid' }}>
                                <ChipCodigo l={l} />
                                <span style={{ fontFamily: 'monospace', fontSize: '0.76rem', textDecoration: l.oculto ? 'line-through' : undefined }}>
                                  {l.oculto ? '🙈' : '📅'} {tramo(l)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', padding: '10px 0' }}>
                <button type="button" className="btn" style={{ fontSize: '0.72rem' }} disabled={pag === 0} onClick={() => setPagina(0)}>«</button>
                <button type="button" className="btn" style={{ fontSize: '0.72rem' }} disabled={pag === 0} onClick={() => setPagina(pag - 1)}>‹ Anterior</button>
                <span style={{ fontSize: '0.75rem' }}>
                  Página {pag + 1} de {totalPag} · {pag * porPag + 1}–{Math.min(visibles.length, (pag + 1) * porPag)} de {visibles.length}
                </span>
                <button type="button" className="btn" style={{ fontSize: '0.72rem' }} disabled={pag >= totalPag - 1} onClick={() => setPagina(pag + 1)}>Siguiente ›</button>
                <button type="button" className="btn" style={{ fontSize: '0.72rem' }} disabled={pag >= totalPag - 1} onClick={() => setPagina(totalPag - 1)}>»</button>
                <select aria-label="Agentes por página" className="input" style={{ fontSize: '0.72rem', padding: '3px 6px', width: 'auto' }}
                  value={porPag} onChange={e => setPorPag(Number(e.target.value))}>
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} por página</option>)}
                </select>
              </div>
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
      const r = await apiFetch<any>('/samo-ministerio/meses', { method: 'POST', body: JSON.stringify({ anio, mes, clave: codigo.trim() }) });
      if (r?.robot === 'lanzado') {
        toast.ok(`${MESES[mes - 1]} ${anio} habilitado`, 'Se están bajando las licencias del Ministerio (tarda unos minutos). Fijate la fecha de última descarga.');
      } else {
        toast.error(`${MESES[mes - 1]} ${anio} habilitado, pero no se pudo lanzar el robot del Ministerio`, r?.robotError);
      }
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

// ─── Licencias que SAMO no ve (solo admin): cada tilde se guarda al instante ──
type CodOculto = { codigo: string; novedad: string | null; cantidad: number; oculto: boolean };

function CodigosOcultos({ onCambio }: { onCambio: () => void }) {
  const toast = useToast();
  const [abierto,   setAbierto]   = useState(false);
  const [lista,     setLista]     = useState<CodOculto[]>([]);
  const [filtro,    setFiltro]    = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<any>('/samo-ministerio/ocultos');
      setLista(r?.data || []);
    } catch (e: any) {
      toast.error('No se pudieron leer las licencias ocultas', e?.message);
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const ocultos = lista.filter(c => c.oculto);

  const tildar = async (codigo: string, ocultar: boolean) => {
    const anterior = lista;
    const nueva = lista.map(c => c.codigo === codigo ? { ...c, oculto: ocultar } : c);
    setLista(nueva);
    setGuardando(true);
    try {
      await apiFetch('/samo-ministerio/ocultos', {
        method: 'PUT', body: JSON.stringify({ codigos: nueva.filter(c => c.oculto).map(c => c.codigo) }),
      });
      toast.ok(ocultar ? `SAMO ya no ve el código ${codigo}` : `SAMO vuelve a ver el código ${codigo}`);
      onCambio();
    } catch (e: any) {
      setLista(anterior);
      toast.error('No se pudo guardar', e?.message);
    } finally { setGuardando(false); }
  };

  const q = filtro.trim().toLowerCase();
  const vis = q ? lista.filter(c => c.codigo.toLowerCase().includes(q) || String(c.novedad || '').toLowerCase().includes(q)) : lista;
  const nombre = (c: CodOculto) => {
    const n = String(c.novedad || '').trim();
    return n.startsWith(`${c.codigo}-`) ? n.slice(c.codigo.length + 1).trim() : (n || '(sin datos este período)');
  };

  return (
    <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, border: '1px dashed rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 700 }}>🙈 Licencias que SAMO no ve (solo admin)</span>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ocultos.length
            ? ocultos.map(c => <span key={c.codigo} title={nombre(c)}><ChipCodigo l={{ codigo: c.codigo } as Lic} /></span>)
            : <span className="muted" style={{ fontSize: '0.7rem' }}>ninguna — SAMO ve todas</span>}
        </span>
        <button type="button" className="btn" style={{ fontSize: '0.72rem', marginLeft: 'auto' }} onClick={() => setAbierto(a => !a)}>
          {abierto ? 'Cerrar' : '✏️ Elegir'}
        </button>
      </div>
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <input aria-label="Buscar código o licencia" className="input" style={{ maxWidth: 300, fontSize: '0.78rem', padding: '4px 8px' }}
              placeholder="Buscar código o licencia…" value={filtro} onChange={e => setFiltro(e.target.value)} />
            <span className="muted" style={{ fontSize: '0.7rem' }}>
              Tildá las que SAMO NO tiene que ver. Se guarda al tildar.{guardando ? ' Guardando…' : ''}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
            {vis.map(c => (
              <label key={c.codigo} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                fontSize: '0.76rem', background: c.oculto ? 'rgba(248,113,113,0.12)' : 'transparent',
                border: `1px solid ${c.oculto ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
                <input type="checkbox" checked={c.oculto} disabled={guardando} onChange={e => tildar(c.codigo, e.target.checked)} />
                <ChipCodigo l={{ codigo: c.codigo } as Lic} />
                <span style={{ flex: 1 }}>{nombre(c)}</span>
                <span className="muted" style={{ fontSize: '0.68rem' }} title="cargas en los datos del Ministerio">{c.cantidad}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
