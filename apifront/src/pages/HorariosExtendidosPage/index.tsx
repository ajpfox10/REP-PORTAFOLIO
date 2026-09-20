// src/pages/HorariosExtendidosPage/index.tsx
// Página SOLO rol 'nutricion' (+ admin): agentes que en el Excel de horarios tienen
// algún turno de MÁS de 10 h. Regla: entrada==salida = 24 h; salida<entrada (noche,
// ej. 19:00→07:00) cruza al día siguiente. Se listan solo los días con horas > 10.
// Datos: GET /horarios-extendidos.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlob } from '../../api/http';

interface TurnoLargo {
  dia: string;
  entrada: string;
  salida: string;
  horas: number;
  cruza: boolean;
}
interface AgenteRow {
  dni: number;
  apellido_nombre: string;
  regimen: string;
  planta: string;
  agrupamiento: string;
  servicio: string;
  dependencia: string;
  max_horas: number;
  turnos: TurnoLargo[];
}
interface Resp {
  ok: boolean;
  resumen: { total_padron: number; con_turno_largo: number; con_24h: number };
  dependencias: string[];
  archivo: string | null;
  agentes: AgenteRow[];
  generado: string;
  error?: string;
}

function normTxt(s: any) {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function fmtHoras(h: number) {
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

export function HorariosExtendidosPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('TODAS');
  const [solo24, setSolo24] = useState(false);
  const [expandido, setExpandido] = useState<Set<number>>(new Set());

  const cargar = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<Resp>(`/horarios-extendidos${refresh ? '?refresh=1' : ''}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando datos');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Error cargando datos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(false); }, [cargar]);

  const [descargando, setDescargando] = useState(false);
  const descargarExcel = useCallback(async () => {
    setDescargando(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (dep && dep !== 'TODAS') params.set('dependencia', dep);
      if (solo24) params.set('solo24', '1');
      const qs = params.toString();
      const blob = await apiFetchBlob(`/horarios-extendidos/export${qs ? `?${qs}` : ''}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `horarios_mas_de_10h_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Error al descargar el Excel');
    } finally {
      setDescargando(false);
    }
  }, [q, dep, solo24]);

  const filtrados = useMemo(() => {
    const rows = data?.agentes ?? [];
    const nq = normTxt(q).trim();
    return rows.filter((a) => {
      if (dep !== 'TODAS' && a.dependencia !== dep) return false;
      if (solo24 && a.max_horas < 24) return false;
      if (nq) {
        const hay = normTxt(a.apellido_nombre).includes(nq) || String(a.dni).includes(nq)
          || normTxt(a.servicio).includes(nq);
        if (!hay) return false;
      }
      return true;
    });
  }, [data, q, dep, solo24]);

  const toggle = (dni: number) => {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(dni)) next.delete(dni); else next.add(dni);
      return next;
    });
  };

  const r = data?.resumen;

  return (
    <Layout title="Turnos de más de 10 horas">
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="h2" style={{ margin: 0 }}>⏱️ Agentes con turnos de más de 10 horas</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {data?.archivo ? <>Fuente: <b>{data.archivo}</b></> : 'Fuente: —'}
              {data?.generado ? ` · Actualizado ${new Date(data.generado).toLocaleString('es-AR')}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="button" onClick={descargarExcel} disabled={descargando || loading}>
              {descargando ? 'Generando…' : '⬇️ Descargar Excel'}
            </button>
            <button className="btn" type="button" onClick={() => cargar(true)} disabled={loading}>
              {loading ? 'Cargando…' : '🔄 Actualizar'}
            </button>
          </div>
        </div>

        <div className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
          Se considera turno largo cuando dura <b>más de 10 h</b>. Si la entrada es igual a la salida el turno
          se toma de <b>24 h</b>; si la salida es anterior a la entrada (ej. 19:00→07:00) el turno cruza al día
          siguiente.
        </div>

        {r && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            {[
              { k: 'Padrón total', v: r.total_padron },
              { k: 'Con turno > 10 h', v: r.con_turno_largo },
              { k: 'Con turno de 24 h', v: r.con_24h },
            ].map((t) => (
              <div key={t.k} className="card" style={{ padding: '8px 14px', minWidth: 120, textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{t.v}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{t.k}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Buscar por apellido, nombre, DNI o servicio…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 260, flex: '1 1 260px' }}
          />
          <select className="input" value={dep} onChange={(e) => setDep(e.target.value)}>
            <option value="TODAS">Todas las dependencias</option>
            {(data?.dependencias ?? []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={solo24} onChange={(e) => setSolo24(e.target.checked)} />
            Solo turnos de 24 h
          </label>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{filtrados.length} agentes</span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ marginTop: 12, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <th style={{ padding: '10px 12px' }}>Apellido y nombre</th>
              <th style={{ padding: '10px 12px' }}>DNI</th>
              <th style={{ padding: '10px 12px' }}>Dependencia</th>
              <th style={{ padding: '10px 12px' }}>Servicio</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Días largos</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Turno más largo</th>
              <th style={{ padding: '10px 12px' }}></th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtrados.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }} className="muted">Sin resultados.</td></tr>
            )}
            {filtrados.map((a) => {
              const abierto = expandido.has(a.dni);
              return (
                <React.Fragment key={a.dni}>
                  <tr
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}
                    onClick={() => toggle(a.dni)}
                  >
                    <td style={{ padding: '9px 12px', fontWeight: 600 }}>{a.apellido_nombre}</td>
                    <td style={{ padding: '9px 12px' }}>{a.dni}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <span className="badge" style={{ background: 'rgba(59,130,246,0.18)' }}>{a.dependencia}</span>
                    </td>
                    <td style={{ padding: '9px 12px' }}>{a.servicio || '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>{a.turnos.length}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      <span className="badge" style={{ background: a.max_horas >= 24 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)' }}>
                        {fmtHoras(a.max_horas)}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>{abierto ? '▲' : '▼'}</td>
                  </tr>
                  {abierto && (
                    <tr>
                      <td colSpan={7} style={{ padding: '0 12px 10px 24px', background: 'rgba(255,255,255,0.02)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr className="muted" style={{ textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Día</th>
                              <th style={{ padding: '6px 8px' }}>Entrada</th>
                              <th style={{ padding: '6px 8px' }}>Salida</th>
                              <th style={{ padding: '6px 8px', textAlign: 'center' }}>Horas</th>
                              <th style={{ padding: '6px 8px' }}>Observación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.turnos.map((t, i) => (
                              <tr key={i}>
                                <td style={{ padding: '5px 8px' }}>{t.dia}</td>
                                <td style={{ padding: '5px 8px' }}>{t.entrada}</td>
                                <td style={{ padding: '5px 8px' }}>{t.salida}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{fmtHoras(t.horas)}</td>
                                <td style={{ padding: '5px 8px' }} className="muted">
                                  {t.horas >= 24 ? 'Entrada = salida (24 h)' : t.cruza ? 'Cruza a la madrugada' : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export default HorariosExtendidosPage;
