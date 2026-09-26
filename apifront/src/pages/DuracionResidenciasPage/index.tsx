// src/pages/DuracionResidenciasPage/index.tsx
// Duracion de residencias: catalogo (residencia + cantidad de anios) y control
// del corte anual (31/08 por defecto, configurable por .env en el backend).
//
// El anio de residencia se calcula por antiguedad (fecha de inicio / ingreso).
// Al corte, el que cumplio los anios de su residencia queda "a dar de baja" y
// el banner del dashboard insiste hasta que se lo da de baja.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Residencia = {
  id: number;
  nombre: string;
  anios: number;
  activa: number;
  observaciones: string | null;
  residentes: number;
};

type EstadoResidente = 'CONTINUA' | 'DAR_DE_BAJA' | 'SIN_RESIDENCIA' | 'SIN_FECHA';

type ResidenteFila = {
  dni: number;
  apellido: string;
  nombre: string;
  ocupacion_nombre: string | null;
  servicio_nombre: string | null;
  fecha_ingreso: string | null;
  fecha_inicio: string | null;
  residencia_id: number | null;
  residencia_nombre: string | null;
  anios_residencia: number | null;
  anios_cumplidos: number | null;
  anio_en_curso: number | null;
  estado: EstadoResidente;
  baja_estado: 'PENDIENTE' | 'BAJA' | 'NO_CORRESPONDE' | null;
  baja_fecha: string | null;
  baja_observaciones: string | null;
  baja_resuelto_por: string | null;
};

type Corte = { ciclo: number; fechaCorte: string; hoy: string; avisoDias: number };

const ESTADO_UI: Record<EstadoResidente, { label: string; color: string; bg: string }> = {
  CONTINUA:       { label: 'Continúa',            color: '#86efac', bg: 'rgba(34,197,94,0.14)' },
  DAR_DE_BAJA:    { label: 'Dar de baja',         color: '#fca5a5', bg: 'rgba(239,68,68,0.16)' },
  SIN_RESIDENCIA: { label: 'Sin residencia',      color: '#fcd34d', bg: 'rgba(234,179,8,0.14)' },
  SIN_FECHA:      { label: 'Sin fecha de inicio', color: '#fcd34d', bg: 'rgba(234,179,8,0.14)' },
};

function fmtFecha(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

function personaLabel(r: ResidenteFila) {
  return [r.apellido, r.nombre].filter(Boolean).join(', ');
}

export function DuracionResidenciasPage() {
  const toast = useToast();

  const [residencias, setResidencias] = useState<Residencia[]>([]);
  const [residentes, setResidentes] = useState<ResidenteFila[]>([]);
  const [corte, setCorte] = useState<Corte | null>(null);
  const [totales, setTotales] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'TODOS' | EstadoResidente>('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [accionDni, setAccionDni] = useState<number | null>(null);

  // alta de residencia
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoAnios, setNuevoAnios] = useState('4');

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, res] = await Promise.all([
        apiFetch<any>('/residencias'),
        apiFetch<any>('/residencias/residentes'),
      ]);
      setResidencias(Array.isArray(cat?.data) ? cat.data : []);
      setResidentes(Array.isArray(res?.data) ? res.data : []);
      setCorte(res?.corte || cat?.corte || null);
      setTotales(res?.totales || null);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarCampo = async (r: Residencia, cambios: Partial<Residencia>, aviso?: string) => {
    try {
      await apiFetch(`/residencias/${r.id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
      if (aviso) toast.ok(aviso);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error');
      await cargar();
    }
  };

  const guardarAnios = async (r: Residencia, anios: number) => {
    if (!Number.isFinite(anios) || anios < 1 || anios > 10) {
      toast.error('Años inválidos', 'Tiene que ser un número entre 1 y 10');
      await cargar();
      return;
    }
    await guardarCampo(r, { anios }, `${r.nombre}: ${anios} años`);
  };

  const crearResidencia = async () => {
    const nombre = nuevoNombre.trim();
    const anios = Number(nuevoAnios);
    if (!nombre) { toast.error('Falta el nombre de la residencia'); return; }
    try {
      await apiFetch('/residencias', { method: 'POST', body: JSON.stringify({ nombre, anios }) });
      setNuevoNombre('');
      setNuevoAnios('4');
      toast.ok('Residencia creada');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo crear', e?.message || 'Error');
    }
  };

  const asignar = async (r: ResidenteFila, residenciaId: string) => {
    try {
      await apiFetch(`/residencias/asignacion/${r.dni}`, {
        method: 'PUT',
        body: JSON.stringify({ residencia_id: residenciaId ? Number(residenciaId) : null }),
      });
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo asignar la residencia', e?.message || 'Error');
    }
  };

  const darDeBaja = async (r: ResidenteFila) => {
    const fecha = window.prompt(
      `Dar de baja a ${personaLabel(r)}.\nFecha de baja (AAAA-MM-DD):`,
      corte?.fechaCorte || '',
    );
    if (!fecha) return;
    setAccionDni(r.dni);
    try {
      await apiFetch(`/residencias/baja/${r.dni}`, {
        method: 'POST',
        body: JSON.stringify({ fecha_baja: fecha }),
      });
      toast.ok(`${personaLabel(r)} dado de baja`);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo dar de baja', e?.message || 'Error');
    } finally {
      setAccionDni(null);
    }
  };

  const noCorresponde = async (r: ResidenteFila) => {
    const obs = window.prompt(`¿Por qué no corresponde dar de baja a ${personaLabel(r)}?`, '');
    if (!obs || obs.trim().length < 5) {
      if (obs !== null) toast.error('Hay que justificarlo');
      return;
    }
    setAccionDni(r.dni);
    try {
      await apiFetch(`/residencias/no-corresponde/${r.dni}`, {
        method: 'POST',
        body: JSON.stringify({ observaciones: obs.trim() }),
      });
      toast.ok('Excepción registrada');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar', e?.message || 'Error');
    } finally {
      setAccionDni(null);
    }
  };

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return residentes.filter((r) => {
      if (filtro !== 'TODOS' && r.estado !== filtro) return false;
      if (!q) return true;
      return (
        personaLabel(r).toLowerCase().includes(q) ||
        String(r.dni).includes(q) ||
        String(r.residencia_nombre || '').toLowerCase().includes(q) ||
        String(r.servicio_nombre || '').toLowerCase().includes(q)
      );
    });
  }, [residentes, filtro, busqueda]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: '.78rem', opacity: .75, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: '.86rem', borderTop: '1px solid rgba(255,255,255,0.06)' };

  return (
    <Layout title="Duración de residencias" showBack>
      <div style={{ display: 'grid', gap: 16 }}>

        {/* Corte */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800 }}>Corte {corte?.ciclo ?? '—'}</div>
              <div style={{ opacity: .75, fontSize: '.84rem' }}>
                Se evalúa al {fmtFecha(corte?.fechaCorte)}
                {corte?.avisoDias ? ` · avisa ${corte.avisoDias} días antes` : ''}
                {' · configurable en el .env (RESIDENCIAS_CORTE_MMDD)'}
              </div>
            </div>
            <button className="btn" type="button" onClick={cargar} disabled={loading}>
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
          </div>
          {totales && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {[
                ['Residentes', totales.residentes],
                ['Continúan', totales.continuan],
                ['A dar de baja', totales.darDeBaja],
                ['Dados de baja', totales.dadosDeBaja],
                ['Sin residencia', totales.sinResidencia],
                ['Sin fecha', totales.sinFecha],
              ].map(([label, valor]) => (
                <div key={String(label)} style={{
                  padding: '8px 12px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ fontSize: '.72rem', opacity: .7 }}>{label}</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{String(valor)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="card" style={{ padding: 12, borderLeft: '4px solid #ef4444' }}>{error}</div>
        )}

        {/* Catalogo: residencia + cantidad de anios */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Residencias y duración</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Residencia</th>
                  <th style={th}>Años</th>
                  <th style={th}>Residentes</th>
                  <th style={th}>Observaciones</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {residencias.map((r) => (
                  <tr key={r.id} style={{ opacity: r.activa ? 1 : .5 }}>
                    <td style={td}>
                      <input
                        defaultValue={r.nombre}
                        style={{ minWidth: 200 }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== r.nombre) guardarCampo(r, { nombre: v }, 'Residencia renombrada');
                        }}
                      />
                    </td>
                    <td style={td}>
                      <input
                        type="number" min={1} max={10} defaultValue={r.anios}
                        style={{ width: 64 }}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== r.anios) guardarAnios(r, v);
                        }}
                      />
                    </td>
                    <td style={td}>{r.residentes}</td>
                    <td style={td}>
                      <input
                        defaultValue={r.observaciones || ''}
                        placeholder="Observaciones"
                        style={{ minWidth: 200 }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.observaciones || '')) guardarCampo(r, { observaciones: v || null } as any);
                        }}
                      />
                    </td>
                    <td style={td}>
                      {r.activa ? (
                        <button
                          className="btn" type="button"
                          onClick={async () => {
                            if (!window.confirm(`¿Desactivar la residencia ${r.nombre}?`)) return;
                            await apiFetch(`/residencias/${r.id}`, { method: 'DELETE' });
                            await cargar();
                          }}
                        >Desactivar</button>
                      ) : (
                        <button
                          className="btn" type="button"
                          onClick={async () => {
                            await apiFetch(`/residencias/${r.id}`, { method: 'PATCH', body: JSON.stringify({ activa: true }) });
                            await cargar();
                          }}
                        >Reactivar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Nueva residencia" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} style={{ minWidth: 220 }}
            />
            <input
              type="number" min={1} max={10} value={nuevoAnios}
              onChange={(e) => setNuevoAnios(e.target.value)} style={{ width: 80 }}
            />
            <button className="btn" type="button" onClick={crearResidencia}>+ Agregar</button>
          </div>
        </div>

        {/* Residentes al corte */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 800 }}>Residentes al corte</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)}>
                <option value="TODOS">Todos</option>
                <option value="DAR_DE_BAJA">A dar de baja</option>
                <option value="CONTINUA">Continúan</option>
                <option value="SIN_RESIDENCIA">Sin residencia</option>
                <option value="SIN_FECHA">Sin fecha de inicio</option>
              </select>
              <input
                placeholder="Buscar por nombre, DNI o servicio"
                value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                style={{ minWidth: 240 }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Agente</th>
                  <th style={th}>DNI</th>
                  <th style={th}>Residencia</th>
                  <th style={th}>Inicio</th>
                  <th style={th}>Años cumplidos</th>
                  <th style={th}>Duración</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r) => {
                  const ui = ESTADO_UI[r.estado];
                  return (
                    <tr key={r.dni}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{personaLabel(r)}</div>
                        <div style={{ opacity: .6, fontSize: '.76rem' }}>{r.servicio_nombre || '—'}</div>
                      </td>
                      <td style={td}>{r.dni}</td>
                      <td style={td}>
                        <select
                          value={r.residencia_id ?? ''}
                          onChange={(e) => asignar(r, e.target.value)}
                        >
                          <option value="">— sin residencia —</option>
                          {residencias.filter((x) => x.activa || x.id === r.residencia_id).map((x) => (
                            <option key={x.id} value={x.id}>{x.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>
                        {fmtFecha(r.fecha_inicio || r.fecha_ingreso)}
                        {!r.fecha_inicio && r.fecha_ingreso && (
                          <span style={{ opacity: .55, fontSize: '.72rem' }}> (ingreso)</span>
                        )}
                      </td>
                      <td style={td}>
                        {r.anios_cumplidos == null ? '—' : r.anios_cumplidos}
                        {r.estado === 'CONTINUA' && r.anio_en_curso != null && (
                          <span style={{ opacity: .6, fontSize: '.74rem' }}> · cursa {r.anio_en_curso}°</span>
                        )}
                      </td>
                      <td style={td}>{r.anios_residencia ?? '—'}</td>
                      <td style={td}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: '.74rem',
                          background: ui.bg, color: ui.color, whiteSpace: 'nowrap',
                        }}>
                          {r.baja_estado === 'BAJA' ? 'Dado de baja' : r.baja_estado === 'NO_CORRESPONDE' ? 'No corresponde' : ui.label}
                        </span>
                        {r.baja_estado === 'BAJA' && (
                          <div style={{ opacity: .6, fontSize: '.72rem' }}>{fmtFecha(r.baja_fecha)}</div>
                        )}
                        {r.baja_estado === 'NO_CORRESPONDE' && r.baja_observaciones && (
                          <div style={{ opacity: .6, fontSize: '.72rem' }}>{r.baja_observaciones}</div>
                        )}
                      </td>
                      <td style={td}>
                        {r.estado === 'DAR_DE_BAJA' && r.baja_estado !== 'BAJA' && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              className="btn" type="button"
                              disabled={accionDni === r.dni}
                              onClick={() => darDeBaja(r)}
                            >Dar de baja</button>
                            {r.baja_estado !== 'NO_CORRESPONDE' && (
                              <button
                                className="btn" type="button"
                                disabled={accionDni === r.dni}
                                onClick={() => noCorresponde(r)}
                              >No corresponde</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!filtrados.length && (
                  <tr><td style={{ ...td, opacity: .6 }} colSpan={8}>Sin resultados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default DuracionResidenciasPage;
