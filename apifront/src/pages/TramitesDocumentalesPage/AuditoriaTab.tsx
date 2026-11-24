import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Pestaña 🕵️ Auditoría (22/11/2026): por agente, cada archivo de su carpeta DOCU con quién lo guardó,
// dónde (carpeta), desde qué PC / equipo de escaneo y por qué vía (escáner, mail, robot, subida, movido).
// Back: GET /tramites-documentales/auditoria?tanda= | ?dni= (junta docu_auditoria, tblarchivos y la
// carpeta). Lo que está en DOCU sin ningún registro sale como "Sin registro" con la fecha del archivo.
// ─────────────────────────────────────────────────────────────────────────────

type Fila = {
  fuente: 'auditoria' | 'tblarchivos' | 'carpeta';
  dni: number; archivo: string; carpeta: string; ruta: string; documento: string | null;
  fecha: string | null; origen: string; usuario: string | null; pc: string | null;
  robot: string | null; detalle: string | null; existe: boolean;
};
type Agente = { dni: number; apellido: string; nombre: string };
type Datos = { agentes: Agente[]; rows: Fila[] };

const BORDER = '1px solid rgba(255,255,255,0.1)';
const ORIGENES: Record<string, { label: string; icon: string; color: string }> = {
  escaner: { label: 'Escáner', icon: '🖨️', color: '#60a5fa' },
  mail: { label: 'Mail', icon: '📧', color: '#a78bfa' },
  robot: { label: 'Robot', icon: '🤖', color: '#22c55e' },
  subida: { label: 'Subida', icon: '⬆️', color: '#f59e0b' },
  movido: { label: 'Movido', icon: '↪️', color: '#94a3b8' },
  carga: { label: 'Carga manual', icon: '✍️', color: '#f472b6' },
  importado: { label: 'Importado', icon: '📥', color: '#64748b' },
  alerta: { label: 'Alerta: copiado a mano', icon: '⚠️', color: '#ef4444' },
  sin_registro: { label: 'Anterior al registro', icon: '🗄️', color: '#64748b' },
};
const ROBOTS: Record<string, string> = {
  siape_legajo_digital: 'Legajo Digital SIAPE',
  siape_certificados_examen: 'Certificados apto SIAPE',
  rdam_certificados: 'RDAM',
  gmail_antecedentes: 'Antecedentes por Gmail',
  extension_rdam: 'Extensión RDAM',
  extension_cuil_anses: 'Extensión CUIL ANSES',
};

function fecha(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const sel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: BORDER, borderRadius: 6, padding: '5px 8px', fontSize: '0.8rem',
};

export function AuditoriaTab() {
  const toast = useToast();
  const [tandas, setTandas] = useState<string[]>([]);
  const [tanda, setTanda] = useState('');
  const [dni, setDni] = useState('');
  const [data, setData] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [origenes, setOrigenes] = useState<Set<string>>(new Set());
  const [usuario, setUsuario] = useState('');
  const [texto, setTexto] = useState('');
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  // Filtro por la fecha del "último" archivo de cada agente (24/11/2026).
  const [ultDesde, setUltDesde] = useState('');
  const [ultHasta, setUltHasta] = useState('');
  const [orden, setOrden] = useState<'apellido' | 'ultimo_desc' | 'ultimo_asc'>('apellido');

  useEffect(() => {
    void (async () => {
      try {
        const r = await apiFetch<{ ok: boolean; data: { tandas: string[] } }>('/tramites-documentales/tandas');
        setTandas(r.data.tandas || []);
      } catch (e: any) { toast.error('No se pudieron cargar las tandas', e?.message || 'Error'); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function consultar(q: { tanda?: string; dni?: string }) {
    const qs = q.dni ? `dni=${encodeURIComponent(q.dni)}` : `tanda=${encodeURIComponent(q.tanda || '')}`;
    setCargando(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: Datos }>(`/tramites-documentales/auditoria?${qs}`);
      setData(r.data);
      setAbiertos(new Set(r.data.agentes.length === 1 ? [r.data.agentes[0].dni] : []));
    } catch (e: any) {
      toast.error('No se pudo leer la auditoría', e?.message || 'Error');
    } finally {
      setCargando(false);
    }
  }

  const rows = data?.rows || [];
  const usuarios = useMemo(() => [...new Set(rows.map((r) => r.usuario).filter(Boolean) as string[])].sort(), [rows]);
  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return rows.filter((r) => (!origenes.size || origenes.has(r.origen))
      && (!usuario || r.usuario === usuario)
      && (!t || [r.archivo, r.carpeta, r.documento, r.pc, r.robot, r.detalle, r.usuario].some((v) => String(v || '').toLowerCase().includes(t))));
  }, [rows, origenes, usuario, texto]);
  const porDni = useMemo(() => {
    const m = new Map<number, Fila[]>();
    for (const r of filtradas) { const l = m.get(r.dni) || []; l.push(r); m.set(r.dni, l); }
    return m;
  }, [filtradas]);
  const conteo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.origen, (m.get(r.origen) || 0) + 1);
    return m;
  }, [rows]);

  function toggleOrigen(o: string) {
    setOrigenes((cur) => { const s = new Set(cur); if (s.has(o)) s.delete(o); else s.add(o); return s; });
  }
  function toggleAgente(d: number) {
    setAbiertos((cur) => { const s = new Set(cur); if (s.has(d)) s.delete(d); else s.add(d); return s; });
  }

  // Fecha (YYYY-MM-DD local) del archivo más reciente de cada agente, dentro de lo filtrado.
  const ultimoPorDni = useMemo(() => {
    const m = new Map<number, Fila>();
    for (const [d, l] of porDni) {
      let best: Fila | null = null;
      for (const r of l) {
        if (!r.fecha) continue;
        if (!best || new Date(r.fecha).getTime() > new Date(best.fecha as string).getTime()) best = r;
      }
      m.set(d, best || l[0]);
    }
    return m;
  }, [porDni]);
  function diaLocal(iso: string | null | undefined) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const filtroFecha = !!(ultDesde || ultHasta);
  const agentes = (data?.agentes || [])
    .filter((a) => porDni.has(a.dni) || (!origenes.size && !usuario && !texto.trim() && !filtroFecha))
    .filter((a) => {
      if (!filtroFecha) return true;
      const dia = diaLocal(ultimoPorDni.get(a.dni)?.fecha);
      if (!dia) return false;
      return (!ultDesde || dia >= ultDesde) && (!ultHasta || dia <= ultHasta);
    })
    .sort((x, y) => {
      if (orden === 'apellido') return 0;
      const tx = new Date(ultimoPorDni.get(x.dni)?.fecha || 0).getTime() || 0;
      const ty = new Date(ultimoPorDni.get(y.dni)?.fecha || 0).getTime() || 0;
      return orden === 'ultimo_desc' ? ty - tx : tx - ty;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
        Por agente: qué archivos tiene en <code>DOCU</code>, en qué carpeta, quién los guardó, desde qué PC o equipo
        de escaneo y por qué vía (escáner, mail, robot, subida o movido desde Trámites). Lo que está en la carpeta
        sin registro y con el nombre que ponen los robots figura como <b style={{ color: ORIGENES.robot.color }}>Robot</b>;
        si no es de un robot y es del 22/11/2026 en adelante figura como <b style={{ color: ORIGENES.alerta.color }}>⚠️ Alerta</b>
        (se copió a la carpeta por el Explorador, sin pasar por la app); lo anterior al 22/11 figura como
        <b style={{ color: ORIGENES.sin_registro.color }}> Anterior al registro</b>.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={tanda} onChange={(e) => { setTanda(e.target.value); setDni(''); if (e.target.value) void consultar({ tanda: e.target.value }); }} style={sel}>
          <option value="">— Elegir tanda —</option>
          {tandas.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>o</span>
        <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6,9}$/.test(dni.trim())) { setTanda(''); void consultar({ dni: dni.trim() }); } }}
          style={{ display: 'flex', gap: 6 }}>
          <input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))} placeholder="DNI" inputMode="numeric"
            style={{ ...sel, width: 120 }} />
          <button type="submit" disabled={!/^\d{6,9}$/.test(dni.trim())} style={{ ...sel, cursor: 'pointer', background: '#7c3aed', color: '#fff', border: 'none' }}>
            Buscar
          </button>
        </form>
        {cargando ? <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Cargando…</span> : null}
      </div>

      {data ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.entries(ORIGENES).filter(([k]) => conteo.has(k)).map(([k, o]) => {
              const on = origenes.has(k);
              return (
                <button key={k} type="button" onClick={() => toggleOrigen(k)}
                  style={{
                    border: `1px solid ${on ? o.color : 'rgba(255,255,255,0.15)'}`, background: on ? `${o.color}22` : 'transparent',
                    color: on ? '#fff' : '#cbd5e1', borderRadius: 999, padding: '3px 10px', fontSize: '0.76rem', cursor: 'pointer',
                  }}>
                  {o.icon} {o.label} <span style={{ color: o.color }}>{conteo.get(k)}</span>
                </button>
              );
            })}
            <select value={usuario} onChange={(e) => setUsuario(e.target.value)} style={sel}>
              <option value="">Todos los usuarios</option>
              {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar archivo, carpeta, PC…" style={{ ...sel, minWidth: 200 }} />
            <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Último entre</span>
            <input type="date" value={ultDesde} onChange={(e) => setUltDesde(e.target.value)} style={{ ...sel, colorScheme: 'dark' }} title="Fecha del último archivo: desde" />
            <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>y</span>
            <input type="date" value={ultHasta} onChange={(e) => setUltHasta(e.target.value)} style={{ ...sel, colorScheme: 'dark' }} title="Fecha del último archivo: hasta" />
            {filtroFecha ? (
              <button type="button" onClick={() => { setUltDesde(''); setUltHasta(''); }} style={{ ...sel, cursor: 'pointer' }} title="Quitar filtro de fecha">✕</button>
            ) : null}
            <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} style={sel}>
              <option value="apellido">Orden: apellido</option>
              <option value="ultimo_desc">Último más reciente primero</option>
              <option value="ultimo_asc">Último más viejo primero</option>
            </select>
            {filtroFecha ? <span style={{ color: '#cbd5e1', fontSize: '0.76rem' }}>{agentes.length} agente(s)</span> : null}
            <button type="button" onClick={() => setAbiertos(new Set(agentes.map((a) => a.dni)))} style={{ ...sel, cursor: 'pointer' }}>Abrir todos</button>
            <button type="button" onClick={() => setAbiertos(new Set())} style={{ ...sel, cursor: 'pointer' }}>Cerrar todos</button>
          </div>

          {!agentes.length ? (
            <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>No hay archivos que coincidan.</div>
          ) : agentes.map((a) => {
            const lista = porDni.get(a.dni) || [];
            const abierto = abiertos.has(a.dni);
            const ult = ultimoPorDni.get(a.dni) || lista[0];
            const alertas = lista.filter((r) => r.origen === 'alerta').length;
            return (
              <div key={a.dni} style={{ border: BORDER, borderRadius: 8, overflow: 'hidden' }}>
                <button type="button" onClick={() => toggleAgente(a.dni)}
                  style={{
                    width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer',
                    padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', color: '#e2e8f0',
                  }}>
                  <span style={{ width: 12 }}>{abierto ? '▾' : '▸'}</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 260 }}>
                    {a.apellido}{a.nombre ? `, ${a.nombre}` : ''} <span style={{ color: '#64748b', fontWeight: 400 }}>· DNI {a.dni}</span>
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>{lista.length} archivo(s)</span>
                  {alertas ? <span style={{ color: ORIGENES.alerta.color, fontSize: '0.76rem', fontWeight: 600 }}>⚠️ {alertas} alerta(s)</span> : null}
                  {ult ? (
                    <span style={{ color: '#64748b', fontSize: '0.74rem', marginLeft: 'auto' }}>
                      último: {fecha(ult.fecha)} {ORIGENES[ult.origen]?.icon} {ult.usuario || ROBOTS[ult.robot || ''] || ult.robot || (ult.origen === 'alerta' ? 'Copiado a mano' : '')}
                    </span>
                  ) : null}
                </button>
                {abierto ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                          {['Fecha', 'Vía', 'Carpeta', 'Archivo', 'Quién', 'PC / equipo', 'Robot', 'Detalle'].map((h) => (
                            <th key={h} style={{ padding: '6px 8px', borderTop: BORDER, borderBottom: BORDER, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map((r, i) => {
                          const o = ORIGENES[r.origen] || { label: r.origen, icon: '•', color: '#94a3b8' };
                          return (
                            <tr key={`${r.fuente}-${i}`} style={{ color: '#e2e8f0', borderBottom: BORDER }}>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{fecha(r.fecha)}</td>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: o.color }}>{o.icon} {o.label}</td>
                              <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{r.carpeta || <span style={{ color: '#64748b' }}>(raíz)</span>}</td>
                              <td style={{ padding: '5px 8px', textDecoration: r.existe ? 'none' : 'line-through', color: r.existe ? '#e2e8f0' : '#64748b' }}
                                title={r.existe ? r.ruta : `${r.ruta} — ya no está en esa ruta (movido o borrado)`}>
                                {r.archivo}
                              </td>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.usuario || <span style={{ color: '#64748b' }}>—</span>}</td>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.pc || <span style={{ color: '#64748b' }}>—</span>}</td>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.robot ? (ROBOTS[r.robot] || r.robot) : <span style={{ color: '#64748b' }}>—</span>}</td>
                              <td style={{ padding: '5px 8px', color: '#94a3b8', maxWidth: 360 }}>{r.detalle || ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
