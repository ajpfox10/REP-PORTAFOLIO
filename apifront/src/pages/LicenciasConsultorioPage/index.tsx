// src/pages/LicenciasConsultorioPage/index.tsx
// Página SOLO jefa de consultorio: consulta de licencias de su grupo de médicos.
// Grupo = LEY 10471 (todos) + becados de profesión médica.
// Datos: GET /licencias-consultorio  (padrón DB + licencias del Excel SIAPE por DNI).
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlob } from '../../api/http';

interface LicItem {
  novedad: string;
  desde: string;
  hasta: string;
  dias: number;
  justificado: string;
}
interface AgenteRow {
  dni: number;
  apellido: string;
  nombre: string;
  ley_id: number;
  ley_nombre: string | null;
  grupo: '10471' | 'BECADO';
  ocupacion_nombre: string | null;
  servicio_nombre: string;
  licencias: LicItem[];
  dias_licencia: number;
}
interface Resp {
  ok: boolean;
  resumen: {
    total_padron: number;
    con_licencia: number;
    sin_licencia: number;
    diez_mil_471: number;
    becados: number;
  };
  archivo_siape: string | null;
  siape_error: string | null;
  agentes: AgenteRow[];
  generado: string;
  error?: string;
}

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

function normTxt(s: any) {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function LicenciasConsultorioPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [grupo, setGrupo] = useState<'TODOS' | '10471' | 'BECADO'>('TODOS');
  const [soloConLic, setSoloConLic] = useState(false);
  const [expandido, setExpandido] = useState<Set<number>>(new Set());

  const cargar = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<Resp>(`/licencias-consultorio${refresh ? '?refresh=1' : ''}`);
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
      const blob = await apiFetchBlob('/licencias-consultorio/export');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `licencias_consultorio_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Error al descargar el Excel');
    } finally {
      setDescargando(false);
    }
  }, []);

  const filtrados = useMemo(() => {
    const rows = data?.agentes ?? [];
    const nq = normTxt(q).trim();
    return rows.filter((a) => {
      if (grupo !== 'TODOS' && a.grupo !== grupo) return false;
      if (soloConLic && a.licencias.length === 0) return false;
      if (nq) {
        const hay = normTxt(`${a.apellido} ${a.nombre}`).includes(nq) || String(a.dni).includes(nq);
        if (!hay) return false;
      }
      return true;
    });
  }, [data, q, grupo, soloConLic]);

  const toggle = (dni: number) => {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(dni)) next.delete(dni); else next.add(dni);
      return next;
    });
  };

  const r = data?.resumen;

  return (
    <Layout title="Licencias de Consultorio">
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="h2" style={{ margin: 0 }}>🩺 Licencias de médicos (Ley 10471 + becados)</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {data?.archivo_siape ? <>Fuente SIAPE: <b>{data.archivo_siape}</b></> : 'Fuente SIAPE: —'}
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

        {data?.siape_error && (
          <div className="card" style={{ marginTop: 10, padding: 10, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)' }}>
            ⚠️ No se pudieron leer las licencias del Excel SIAPE: {data.siape_error}
          </div>
        )}

        {/* Resumen */}
        {r && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            {[
              { k: 'Padrón', v: r.total_padron },
              { k: 'Con licencia', v: r.con_licencia },
              { k: 'Sin licencia', v: r.sin_licencia },
              { k: 'Ley 10471', v: r.diez_mil_471 },
              { k: 'Becados médicos', v: r.becados },
            ].map((t) => (
              <div key={t.k} className="card" style={{ padding: '8px 14px', minWidth: 110, textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{t.v}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{t.k}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Buscar por apellido, nombre o DNI…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 260, flex: '1 1 260px' }}
          />
          <select className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as any)}>
            <option value="TODOS">Todos los grupos</option>
            <option value="10471">Solo Ley 10471</option>
            <option value="BECADO">Solo becados médicos</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={soloConLic} onChange={(e) => setSoloConLic(e.target.checked)} />
            Solo con licencia
          </label>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{filtrados.length} médicos</span>
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
              <th style={{ padding: '10px 12px' }}>Grupo</th>
              <th style={{ padding: '10px 12px' }}>Servicio</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Licencias</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Días</th>
              <th style={{ padding: '10px 12px' }}></th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtrados.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center' }} className="muted">Sin resultados.</td></tr>
            )}
            {filtrados.map((a) => {
              const abierto = expandido.has(a.dni);
              const tieneLic = a.licencias.length > 0;
              return (
                <React.Fragment key={a.dni}>
                  <tr
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: tieneLic ? 'pointer' : 'default' }}
                    onClick={() => tieneLic && toggle(a.dni)}
                  >
                    <td style={{ padding: '9px 12px', fontWeight: 600 }}>{a.apellido}, {a.nombre}</td>
                    <td style={{ padding: '9px 12px' }}>{a.dni}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <span className="badge" style={{ background: a.grupo === '10471' ? 'rgba(59,130,246,0.2)' : 'rgba(168,85,247,0.2)' }}>
                        {a.grupo === '10471' ? 'Ley 10471' : 'Becado'}
                      </span>
                      <div className="muted" style={{ fontSize: '0.7rem' }}>{a.ocupacion_nombre || ''}</div>
                    </td>
                    <td style={{ padding: '9px 12px' }}>{a.servicio_nombre}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>{a.licencias.length || '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>{a.dias_licencia || '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>{tieneLic ? (abierto ? '▲' : '▼') : ''}</td>
                  </tr>
                  {abierto && tieneLic && (
                    <tr>
                      <td colSpan={7} style={{ padding: '0 12px 10px 24px', background: 'rgba(255,255,255,0.02)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr className="muted" style={{ textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Novedad</th>
                              <th style={{ padding: '6px 8px' }}>Desde</th>
                              <th style={{ padding: '6px 8px' }}>Hasta</th>
                              <th style={{ padding: '6px 8px', textAlign: 'center' }}>Días</th>
                              <th style={{ padding: '6px 8px' }}>Justificado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.licencias.map((l, i) => (
                              <tr key={i}>
                                <td style={{ padding: '5px 8px' }}>{l.novedad}</td>
                                <td style={{ padding: '5px 8px' }}>{fmtFecha(l.desde)}</td>
                                <td style={{ padding: '5px 8px' }}>{fmtFecha(l.hasta)}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{l.dias || '—'}</td>
                                <td style={{ padding: '5px 8px' }}>{l.justificado || '—'}</td>
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

export default LicenciasConsultorioPage;
